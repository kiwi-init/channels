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
import { Directory, onClientFrame, RoomDb, type Sql } from "../src/relay/room.ts";
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
    Layer.succeed(Directory, { list: async () => [], reserve: async () => true, release: async () => {} }),
  ),
);

describe("the room remembers each sender's send ids", () => {
  test("a repeat gets the first seq and time back; another sender's same id, or one past the memory, is new", () => {
    const mem = new Database(":memory:");
    const db = new RoomDb(sqlOf(mem), "c".repeat(32));
    db.init();
    const cid = "send-id-000000000001";
    expect(db.claimSend("alice", cid, 5, 100)).toBeNull();
    expect(db.claimSend("alice", cid, 6, 200)).toEqual({ seq: 5, ts: 100 });
    expect(db.claimSend("bob", cid, 6, 200)).toBeNull();
    db.pruneSends(150);
    expect(db.claimSend("alice", cid, 7, 300)).toBeNull();
    expect(db.claimSend("bob", cid, 8, 300)).toEqual({ seq: 6, ts: 200 });
    mem.close();
  });

  test("a room from before send ids gets their table when it opens", () => {
    const mem = new Database(":memory:");
    const db = new RoomDb(sqlOf(mem), "d".repeat(32));
    db.init();
    mem.run("DROP TABLE sends");
    db.migrate();
    expect(db.claimSend("alice", "send-id-000000000002", 1, 1)).toBeNull();
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
