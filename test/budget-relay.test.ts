import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Layer from "effect/Layer";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { Human } from "../src/relay/human.ts";
import { GithubApp, GithubPush, githubPushFrom } from "../src/relay/github-app.ts";
import { OPEN_POLICY, Policy } from "../src/relay/policy.ts";
import { Directory, forgetRoom, onClientFrame, remove, RoomDb, setCanPost, welcomeFrames, type Effects, type Sql } from "../src/relay/room.ts";
import { makeRelay, runRoom, runRoomSync, type Relay } from "../src/relay/route.ts";
import { checked } from "./check.ts";

setDefaultTimeout(60_000);

const BUDGET = {
  sendReads: 0,
  sendWrites: 2,
  markReads: 0,
  markWrites: 1,
  welcomeReads: 2,
} as const;

interface Tally {
  reads: number;
  rows: number;
  writes: number;
}

function counted(db: Database): { sql: Sql; tally: Tally; reset: () => Tally } {
  const tally: Tally = { reads: 0, rows: 0, writes: 0 };
  const sql: Sql = {
    run: (q, ...p) => {
      tally.writes++;
      db.query(q).run(...p);
    },
    all: <T>(q: string, ...p: (string | number | null)[]) => {
      const rows = db.query(q).all(...p) as T[];
      tally.reads++;
      tally.rows += rows.length;
      return rows;
    },
  };
  const reset = (): Tally => {
    const was = { ...tally };
    tally.reads = 0;
    tally.rows = 0;
    tally.writes = 0;
    return was;
  };
  return { sql, tally, reset };
}

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-budget-"));
let server: ReturnType<typeof startRelay> | undefined;
let roomId = "";
let members: string[] = [];
let file: Database | undefined;

const relayCtx: Relay = makeRelay(
  Layer.mergeAll(
    Layer.succeed(Human, null),
    Layer.succeed(GithubApp, null),
    Layer.succeed(GithubPush, githubPushFrom()),
    Layer.succeed(Policy, OPEN_POLICY),
    Layer.succeed(Directory, { list: async () => [], reserve: async () => true, release: async () => {} }),
  ),
);

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  const owner = await generateIdentity("boss");
  const { code, access } = await Channel.create(relay, owner, { name: "boss" });
  const ownerCh = new Channel(access, relay, owner);
  const agents = [await generateIdentity("a0"), await generateIdentity("a1")];
  for (const a of agents) {
    const req = await Channel.requestJoin(relay, code, a, { name: a.name });
    await ownerCh.approve((await checked(ownerCh, relay, code, [{ id: a, requestId: req.requestId }])).find((r) => r.id === req.requestId)!);
  }
  roomId = access.roomId;
  members = [owner.pk, ...agents.map((a) => a.pk)];
  server.stop(true);
  file = new Database(join(dataDir, `${roomId}.sqlite`));
});

afterAll(() => {
  file?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let n = 0;
const send = (sql: Sql, pk: string): Effects => {
  const fx = runRoomSync(relayCtx, new RoomDb(sql, roomId), onClientFrame(JSON.stringify({ t: "send", id: `m${++n}`, iv: "aXZpdml2aXZpdml2", ct: "Y3".repeat(200), e: 0 }), pk));
  expect(fx.reply).toContain('"t":"ack"');
  return fx;
};

describe("relay storage budget, per operation on a warm room", () => {
  test("a stored message", () => {
    const { sql, reset } = counted(file!);
    for (const pk of members) send(sql, pk);
    reset();
    const times = 40;
    for (let i = 0; i < times; i++) send(sql, members[i % members.length]!);
    const t = reset();
    console.log(`send: ${t.reads / times} reads (${t.rows / times} rows), ${t.writes / times} writes per message`);
    expect(t.reads / times).toBeLessThanOrEqual(BUDGET.sendReads);
    expect(t.writes / times).toBeLessThanOrEqual(BUDGET.sendWrites);
  });

  test("a read mark that moves forward", () => {
    const { sql, reset } = counted(file!);
    send(sql, members[0]!);
    const head = runRoomSync(relayCtx, new RoomDb(sql, roomId), welcomeFrames(1 << 30)).length;
    expect(head).toBe(2);
    const mark = (pk: string) => {
      const fx = runRoomSync(relayCtx, new RoomDb(sql, roomId), onClientFrame(JSON.stringify({ t: "read", seq: n }), pk));
      expect(fx.readers?.[0]).toContain('"t":"read"');
    };
    for (const pk of members) mark(pk);
    send(sql, members[0]!);
    reset();
    for (const pk of members) mark(pk);
    const t = reset();
    console.log(`read mark: ${t.reads / members.length} reads (${t.rows / members.length} rows), ${t.writes / members.length} writes per mark`);
    expect(t.reads / members.length).toBeLessThanOrEqual(BUDGET.markReads);
    expect(t.writes / members.length).toBeLessThanOrEqual(BUDGET.markWrites);
  });

  test("a socket that connects up to date", () => {
    const { sql, reset } = counted(file!);
    send(sql, members[0]!);
    reset();
    const frames = runRoomSync(relayCtx, new RoomDb(sql, roomId), welcomeFrames(n));
    expect(frames.at(-1)).toContain('"t":"ready"');
    const t = reset();
    console.log(`welcome: ${t.reads} reads (${t.rows} rows), ${t.writes} writes`);
    expect(t.reads).toBeLessThanOrEqual(BUDGET.welcomeReads);
  });
});

describe("a warm room stays right", () => {
  test("who may post, as soon as the owner changes it", async () => {
    const { sql } = counted(file!);
    const pk = members[2]!;
    send(sql, pk);
    await runRoom(relayCtx, new RoomDb(sql, roomId), setCanPost(pk, false));
    const refused = runRoomSync(relayCtx, new RoomDb(sql, roomId), onClientFrame(JSON.stringify({ t: "send", id: "ro", iv: "aXZpdml2aXZpdml2", ct: "Y3Y3", e: 0 }), pk));
    expect(refused.reply).toContain("only read");
    await runRoom(relayCtx, new RoomDb(sql, roomId), setCanPost(pk, true));
    send(sql, pk);
  });

  test("who is a member, as soon as one is removed", async () => {
    const { sql } = counted(file!);
    const pk = members[1]!;
    const db = new RoomDb(sql, roomId);
    expect(db.isMember(pk)).toBe(true);
    runRoomSync(relayCtx, db, onClientFrame(JSON.stringify({ t: "read", seq: 1 }), pk));
    await runRoom(relayCtx, db, remove(pk, "owner"));
    expect(new RoomDb(sql, roomId).isMember(pk)).toBe(false);
    expect(new RoomDb(sql, roomId).readThrough(pk)).toBe(0);
  });

  test("message numbers keep going on a fresh handle and after the oldest are dropped", () => {
    const warm = counted(file!).sql;
    send(warm, members[0]!);
    const head = new RoomDb(warm, roomId).head();
    const db = new RoomDb(counted(file!).sql, roomId);
    expect(db.head()).toBe(head);
    const freed = db.dropOldest(1);
    expect(freed).toBeGreaterThan(0);
    expect(db.since(0)[0]!.seq).toBe(2);
    const fx = send(counted(file!).sql, members[0]!);
    expect(fx.reply).toContain(`"seq":${head + 1}`);
  });

  test("a message that needs every older one dropped still gets the next number", () => {
    const scratch = new Database(":memory:");
    const { sql } = counted(scratch);
    const legacy = new RoomDb(sql, "e".repeat(32));
    scratch.run("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    scratch.run("CREATE TABLE msgs (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, e INTEGER NOT NULL)");
    scratch.run("INSERT INTO msgs (seq, ts, iv, ct, e) VALUES (7, 0, 'iv', 'old', 0)");
    const cold = new RoomDb(counted(scratch).sql, legacy.roomId);
    const seq = cold.head() + 1;
    cold.dropOldest(1);
    expect(cold.since(0)).toEqual([]);
    cold.insert(seq, 0, "iv", "new", 0);
    expect(cold.since(0).map((m) => m.seq)).toEqual([8]);
    scratch.close();
  });

  test("a closed room is forgotten", () => {
    const scratch = new Database(":memory:");
    const { sql } = counted(scratch);
    const db = new RoomDb(sql, "f".repeat(32));
    expect(db.exists()).toBe(false);
    db.init();
    expect(new RoomDb(sql, "f".repeat(32)).exists()).toBe(true);
    for (const t of ["meta", "msgs", "members", "keys", "requests", "reads"]) scratch.run(`DROP TABLE ${t}`);
    forgetRoom(sql);
    expect(new RoomDb(sql, "f".repeat(32)).exists()).toBe(false);
    scratch.close();
  });
});
