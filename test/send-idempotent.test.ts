import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Layer from "effect/Layer";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { GithubApp, GithubPush, githubPushFrom } from "../src/relay/github-app.ts";
import { Human } from "../src/relay/human.ts";
import { OPEN_POLICY, Policy } from "../src/relay/policy.ts";
import { Directory, forgetRoom, onClientFrame, RoomDb, type Sql } from "../src/relay/room.ts";
import { makeRelay, runRoomSync } from "../src/relay/route.ts";

setDefaultTimeout(30_000);

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "kiwi-send-once-"));
  made.push(d);
  return d;
};

const sqlOf = (db: Database): Sql => ({
  run: (q, ...p) => void db.query(q).run(...p),
  all: <T>(q: string, ...p: (string | number | null)[]) => db.query(q).all(...p) as T[],
});

const relayCtx = makeRelay(
  Layer.mergeAll(
    Layer.succeed(Human, null),
    Layer.succeed(GithubApp, null),
    Layer.succeed(GithubPush, githubPushFrom()),
    Layer.succeed(Policy, OPEN_POLICY),
    Layer.succeed(Directory, {
      list: async () => [],
      reserve: async () => true,
      release: async () => {},
      person: async () => ({ plan: "free" as const, blocked: false }),
      seen: async () => {},
      lease: async () => ({ grant: 0, plan: "free" as const, limit: null, remaining: null, blocked: false }),
    }),
  ),
);

describe("the room remembers each sender's send ids", () => {
  const stored = (db: RoomDb, seq: number, ts: number, sender: string, cid: string) => db.insert(seq, ts, "iv", "ct", 1, { sender, cid, since: ts - 100 });

  test("a repeat gets the first seq and time back; another sender's same id, or one past the memory, is new", () => {
    const mem = new Database(":memory:");
    const db = new RoomDb(sqlOf(mem), "c".repeat(32));
    db.init();
    const cid = "send-id-000000000001";
    expect(db.priorSend("alice", cid, 0)).toBeNull();
    stored(db, 5, 100, "alice", cid);
    expect(db.priorSend("alice", cid, 100)).toEqual({ seq: 5, ts: 100 });
    expect(db.priorSend("bob", cid, 100)).toBeNull();
    stored(db, 6, 200, "bob", cid);
    expect(db.priorSend("alice", cid, 150)).toBeNull();
    expect(db.priorSend("bob", cid, 150)).toEqual({ seq: 6, ts: 200 });
    mem.close();
  });

  test("the memory lives on the message rows: a fresh connection finds the send ids of the last hour and no others", () => {
    const mem = new Database(":memory:");
    const db = new RoomDb(sqlOf(mem), "e".repeat(32));
    db.init();
    for (let i = 1; i <= 600; i++) stored(db, i, i * 10, "alice", `send-id-${String(i).padStart(12, "0")}`);
    forgetRoom(db.sql);
    const again = new RoomDb(sqlOf(mem), "e".repeat(32));
    expect(again.priorSend("alice", "send-id-000000000600", 5000)).toEqual({ seq: 600, ts: 6000 });
    expect(again.priorSend("alice", "send-id-000000000500", 5000)).toEqual({ seq: 500, ts: 5000 });
    expect(again.priorSend("alice", "send-id-000000000499", 5000)).toBeNull();
    expect(mem.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sends'").get()).toEqual({ n: 0 });
    mem.close();
  });

  test("a room from before keeps the send ids its old table held, and the table goes", () => {
    const mem = new Database(":memory:");
    const sql = sqlOf(mem);
    const db = new RoomDb(sql, "d".repeat(32));
    db.init();
    mem.run("DROP TABLE msgs");
    mem.run("CREATE TABLE msgs (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, e INTEGER NOT NULL)");
    mem.run("CREATE TABLE sends (sender TEXT NOT NULL, cid TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (sender, cid))");
    mem.run("INSERT INTO msgs (seq, ts, iv, ct, e) VALUES (1, 100, 'iv', 'ct', 1), (2, 200, 'iv', 'ct', 1)");
    mem.run("INSERT INTO sends VALUES ('alice', 'send-id-000000000002', 2, 200)");
    forgetRoom(sql);
    const opened = new RoomDb(sql, "d".repeat(32));
    opened.migrate();
    expect(opened.priorSend("alice", "send-id-000000000002", 150)).toEqual({ seq: 2, ts: 200 });
    expect(opened.priorSend("alice", "send-id-000000000001", 0)).toBeNull();
    expect(mem.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sends'").get()).toEqual({ n: 0 });
    mem.close();
  });
});

describe("a send repeated with its send id is stored once (#783)", () => {
  let owner: Identity;
  let access: ConstructorParameters<typeof Channel>[0];
  let relay: string;
  let server: ReturnType<typeof startRelay>;
  const dataDir = scratch();

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    relay = server.url.origin;
    owner = await generateIdentity("once");
    access = (await Channel.create(relay, owner, { name: "once", kind: "human" }, [])).access;
  });
  afterAll(() => server.stop(true));

  test("a 503 after the room stored the message: the client sends it again with the same id and gets the first seq, and the channel has it once", async () => {
    const cids: string[] = [];
    let failed = false;
    const proxy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        const url = new URL(req.url);
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
        const upstream = await fetch(relay + url.pathname + url.search, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) });
        if (req.method !== "POST" || !url.pathname.endsWith("/messages")) return upstream;
        cids.push((JSON.parse(body ?? "{}") as { cid?: string }).cid ?? "");
        if (failed) return upstream;
        failed = true;
        await upstream.text();
        return Response.json({ error: "the channel is busy or restarting, and this may have gone through: look before you send it again" }, { status: 503 });
      },
    });
    try {
      const ch = new Channel(access, proxy.url.origin, owner);
      const seq = await ch.send("only once, please");
      expect(cids).toHaveLength(2);
      expect(cids[0]).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(cids[1]).toBe(cids[0]);
      const { messages } = await new Channel(access, relay, owner).history(0);
      const copies = messages.filter((m) => m.body === "only once, please");
      expect(copies.map((m) => m.seq)).toEqual([seq]);
    } finally {
      proxy.stop(true);
    }
  });

  test("over a socket, the same frame id or a new one: a repeated send id gets the first seq, without a second broadcast", () => {
    const file = new Database(join(dataDir, `${access.roomId}.sqlite`));
    try {
      const frame = (id: string, cid: string) => JSON.stringify({ t: "send", id, iv: "aXZpdml2aXZpdml2", ct: "Y3Z2", e: 0, cid });
      const sent = (raw: string) => runRoomSync(relayCtx, new RoomDb(sqlOf(file), access.roomId), onClientFrame(raw, owner.pk));
      const first = sent(frame("f1", "socket-send-00000001"));
      const again = sent(frame("f2", "socket-send-00000001"));
      const ack = (fx: { reply?: string | string[] }) => JSON.parse(String(fx.reply)) as { t: string; seq: number; ts: number };
      expect(ack(again)).toMatchObject({ t: "ack", seq: ack(first).seq, ts: ack(first).ts });
      expect(first.broadcast ?? first.others).toBeDefined();
      expect(again.broadcast).toBeUndefined();
      expect(again.others).toBeUndefined();
      expect(ack(sent(frame("f3", "socket-send-00000002"))).seq).toBe(ack(first).seq + 1);
      const refused = sent(frame("f4", "not ok"));
      expect(JSON.parse(String(refused.reply))).toMatchObject({ t: "err", error: "bad send id", id: "f4" });
    } finally {
      file.close();
    }
  });
});
