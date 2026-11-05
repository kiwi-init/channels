import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Layer from "effect/Layer";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { DOC_COMPACT, DOC_COMPACT_UPDATES, DOC_PRUNE_IDLE_MS, MAX_DOC_THREADS, WS_PROTOCOL, type ServerFrame } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { GithubApp, GithubPush, githubPushFrom } from "../src/relay/github-app.ts";
import { Human } from "../src/relay/human.ts";
import { DOC_UPDATES_PER_MINUTE } from "../src/relay/room/limits.ts";
import { OPEN_POLICY, Policy } from "../src/relay/policy.ts";
import { Directory, onClientFrame, RoomDb, type Effects, type SocketView, type Sql } from "../src/relay/room.ts";
import { makeRelay, runRoomSync } from "../src/relay/route.ts";

setDefaultTimeout(30_000);

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "kiwi-doc-relay-"));
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
    Layer.succeed(Policy, { ...OPEN_POLICY, noRateLimits: true }),
    Layer.succeed(Directory, { list: async () => [], reserve: async () => true, release: async () => {} }),
  ),
);

const TH = "thread-aaaaaaaaaaaaaaa";
const TH2 = "thread-bbbbbbbbbbbbbbb";
const IV = "aXZpdml2aXZpdml2";

const replies = (fx: Effects): ServerFrame[] => [fx.reply ?? []].flat().map((f) => JSON.parse(f) as ServerFrame);
const only = (fx: Effects): ServerFrame => {
  const all = replies(fx);
  expect(all).toHaveLength(1);
  return all[0]!;
};

describe("the relay stores and relays sealed doc updates (T491)", () => {
  let owner: Identity;
  let access: ConstructorParameters<typeof Channel>[0];
  let relay: string;
  let server: ReturnType<typeof startRelay>;
  const dataDir = scratch();

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    relay = server.url.origin;
    owner = await generateIdentity("docs");
    access = (await Channel.create(relay, owner, { name: "docs", kind: "human" }, [])).access;
  });
  afterAll(() => server.stop(true));

  const withRoom = <T>(run: (sent: (frame: object, view?: SocketView, sender?: string) => Effects, mem: Database) => T): T => {
    const file = new Database(join(dataDir, `${access.roomId}.sqlite`));
    try {
      return run((f, view, sender = owner.pk) => runRoomSync(relayCtx, new RoomDb(sqlOf(file), access.roomId), onClientFrame(JSON.stringify(f), sender, true, view)), file);
    } finally {
      file.close();
    }
  };

  test("updates get a per-thread dseq, go to the thread's followers, and come back as backlog after since", () =>
    withRoom((sent) => {
      const first = sent({ t: "doc", id: "d1", th: TH, iv: IV, ct: "dXBkYXRlLTE", e: 0 });
      expect(only(first)).toMatchObject({ t: "ack", id: "d1", seq: 1 });
      expect(JSON.parse(first.doc!.frame)).toMatchObject({ t: "doc", th: TH, dseq: 1, iv: IV, ct: "dXBkYXRlLTE", e: 0 });
      expect(first.broadcast).toBeUndefined();
      expect(first.others).toBeUndefined();
      expect(only(sent({ t: "doc", id: "d2", th: TH, iv: IV, ct: "dXBkYXRlLTI", e: 0 }))).toMatchObject({ t: "ack", seq: 2 });
      expect(only(sent({ t: "doc", id: "d3", th: TH2, iv: IV, ct: "b3RoZXI", e: 0 }))).toMatchObject({ t: "ack", seq: 1 });

      const sub = sent({ t: "doc.sub", th: TH, since: 0 });
      expect(sub.follow).toEqual({ th: TH, on: true });
      expect(replies(sub).map((f) => (f.t === "doc" ? f.dseq : f.t))).toEqual([1, 2, "doc.ready"]);
      expect(replies(sub).at(-1)).toEqual({ t: "doc.ready", th: TH, head: 2 });
      expect(replies(sent({ t: "doc.sub", th: TH, since: 1 })).map((f) => (f.t === "doc" ? f.dseq : f.t))).toEqual([2, "doc.ready"]);
      expect(sent({ t: "doc.unsub", th: TH })).toEqual({ follow: { th: TH, on: false } });
    }));

  test("a snapshot replaces the updates it covers; backlog sends it first, then what came after", () =>
    withRoom((sent, mem) => {
      expect(only(sent({ t: "doc.snap", id: "s0", th: TH, upto: 3, iv: IV, ct: "c25hcA", e: 0 }))).toMatchObject({ t: "err", id: "s0", th: TH, tag: "Conflict" });
      const snapped = sent({ t: "doc.snap", id: "s1", th: TH, upto: 2, iv: IV, ct: "c25hcC0y", e: 0 });
      expect(only(snapped)).toMatchObject({ t: "ack", id: "s1", seq: 2 });
      expect(JSON.parse(snapped.doc!.frame)).toMatchObject({ t: "doc", th: TH, dseq: 2, iv: IV, ct: "c25hcC0y", e: 0, snap: true });
      expect(mem.query("SELECT COUNT(*) AS n FROM docs WHERE th = ?").get(TH)).toEqual({ n: 0 });
      expect(mem.query("SELECT COUNT(*) AS n FROM docs WHERE th = ?").get(TH2)).toEqual({ n: 1 });
      expect(only(sent({ t: "doc.snap", id: "s2", th: TH, upto: 2, iv: IV, ct: "c25hcA", e: 0 }))).toMatchObject({ t: "err", tag: "Conflict" });
      expect(only(sent({ t: "doc", id: "d4", th: TH, iv: IV, ct: "dXBkYXRlLTM", e: 0 }))).toMatchObject({ t: "ack", seq: 3 });

      const fresh = replies(sent({ t: "doc.sub", th: TH, since: 0 }));
      expect(fresh[0]).toMatchObject({ t: "doc", th: TH, dseq: 2, ct: "c25hcC0y", snap: true });
      expect(fresh.slice(1)).toEqual([expect.objectContaining({ t: "doc", dseq: 3, ct: "dXBkYXRlLTM" }), { t: "doc.ready", th: TH, head: 3 }]);
      expect(replies(sent({ t: "doc.sub", th: TH, since: 2 })).map((f) => (f.t === "doc" ? f.dseq : f.t))).toEqual([3, "doc.ready"]);
    }));

  test("refused: a bad thread id, a stale epoch, a read-only member, a watch socket, and a socket past its thread cap", () =>
    withRoom((sent, mem) => {
      expect(only(sent({ t: "doc", id: "x1", th: "not a thread", iv: IV, ct: "eA", e: 0 }))).toMatchObject({ t: "err", tag: "BadRequest" });
      expect(only(sent({ t: "doc", id: "x2", th: TH, iv: IV, ct: "eA", e: 7 }))).toMatchObject({ t: "err", id: "x2", tag: "Conflict" });
      expect(only(sent({ t: "doc", th: TH, iv: IV, ct: "eA", e: 0 }))).toMatchObject({ t: "err", tag: "BadRequest" });

      const reader = "r".repeat(43);
      mem.query("INSERT INTO members (pk, xpk, rec, rec_e, since, read_only) VALUES (?, 'x', 'r', 0, 0, 1)").run(reader);
      expect(only(sent({ t: "doc", id: "x3", th: TH, iv: IV, ct: "eA", e: 0 }, undefined, reader))).toMatchObject({ t: "err", tag: "ReadOnly" });
      expect(replies(sent({ t: "doc.sub", th: TH, since: 0 }, undefined, reader)).at(-1)).toMatchObject({ t: "doc.ready" });

      expect(only(sent({ t: "doc.sub", th: TH, since: 0 }, { docs: new Set(), watch: true }))).toMatchObject({ t: "err", error: "a watch socket only follows the head" });

      const full = new Set(Array.from({ length: MAX_DOC_THREADS }, (_, i) => `full-${String(i).padStart(17, "0")}`));
      expect(only(sent({ t: "doc.sub", th: TH, since: 0 }, { docs: full, watch: false }))).toMatchObject({ t: "err", tag: "TooMany" });
      expect(replies(sent({ t: "doc.sub", th: [...full][0], since: 0 }, { docs: full, watch: false })).at(-1)).toMatchObject({ t: "doc.ready" });
    }));

  test("a refused update or snapshot still counts against the minute's updates, so a client looping on refusals is slowed down (T1426)", () =>
    withRoom((_, mem) => {
      const limited = makeRelay(
        Layer.mergeAll(
          Layer.succeed(Human, null),
          Layer.succeed(GithubApp, null),
          Layer.succeed(GithubPush, githubPushFrom()),
          Layer.succeed(Policy, OPEN_POLICY),
          Layer.succeed(Directory, { list: async () => [], reserve: async () => true, release: async () => {} }),
        ),
      );
      const looper = "l".repeat(43);
      mem.query("INSERT INTO members (pk, xpk, rec, rec_e, since, read_only) VALUES (?, 'x', 'r', 0, 0, 0)").run(looper);
      const sent = (f: object) => only(runRoomSync(limited, new RoomDb(sqlOf(mem), access.roomId), onClientFrame(JSON.stringify(f), looper, true)));
      for (let i = 0; i < DOC_UPDATES_PER_MINUTE / 2; i++) expect(sent({ t: "doc", id: `r${i}`, th: TH, iv: IV, ct: "eA", e: 7 })).toMatchObject({ t: "err", tag: "Conflict" });
      for (let i = 0; i < DOC_UPDATES_PER_MINUTE / 2; i++) expect(sent({ t: "doc.snap", id: `q${i}`, th: TH, upto: 0, iv: IV, ct: "eA", e: 0 })).toMatchObject({ t: "err", tag: "Conflict" });
      expect(sent({ t: "doc", id: "late", th: TH, iv: IV, ct: "eA", e: 0 })).toMatchObject({ t: "err", tag: "TooMany" });
    }));

  test("past the soft limit the ack asks for a snapshot; past the hard limit the update is refused until one comes", () =>
    withRoom((sent) => {
      const th = "thread-ccccccccccccccc";
      let last: ServerFrame | undefined;
      for (let i = 1; i <= DOC_COMPACT_UPDATES; i++) last = only(sent({ t: "doc", id: `c${i}`, th, iv: IV, ct: "eA", e: 0 }));
      expect(last).toMatchObject({ t: "ack", seq: DOC_COMPACT_UPDATES, compact: true });

      const big = "A".repeat(512 * 1024);
      const fill = (n: number) => only(sent({ t: "doc", id: `b${n}`, th, iv: IV, ct: big, e: 0 }));
      expect(fill(1)).toMatchObject({ t: "ack" });
      expect(fill(2)).toMatchObject({ t: "err", th, tag: "TooLarge", error: DOC_COMPACT });
      expect(only(sent({ t: "doc.snap", id: "cs", th, upto: DOC_COMPACT_UPDATES + 1, iv: IV, ct: "c25hcA", e: 0 }))).toMatchObject({ t: "ack" });
      expect(fill(3)).toMatchObject({ t: "ack", seq: DOC_COMPACT_UPDATES + 2 });
    }));

  test("the owner lists the docs and prunes only the ones idle for a week; anyone else is refused (T1430)", async () => {
    const IDLE = "idleidleidleidleidle01";
    const BUSY = "busybusybusybusybusy01";
    withRoom((sent, mem) => {
      for (const th of [IDLE, BUSY]) expect(only(sent({ t: "doc", id: `w-${th}`, th, iv: IV, ct: "d29yZA", e: 0 }))).toMatchObject({ t: "ack" });
      mem.query("UPDATE docs SET ts = ? WHERE th = ?").run(Date.now() - DOC_PRUNE_IDLE_MS - 1000, IDLE);
    });
    const ch = new Channel(access, relay, owner);
    const listed = await ch.docList();
    expect(listed.filter((d) => d.th === IDLE || d.th === BUSY)).toEqual([
      expect.objectContaining({ th: BUSY, n: 1, bytes: 6, upto: 0 }),
      expect.objectContaining({ th: IDLE, n: 1, bytes: 6, upto: 0 }),
    ]);
    expect(await ch.pruneDocs([IDLE, BUSY, "nonenonenonenonenone01"])).toEqual({ dropped: [IDLE], kept: [BUSY], freed: 6 });
    expect((await ch.docList()).map((d) => d.th)).not.toContain(IDLE);
    withRoom((sent) => expect(replies(sent({ t: "doc.sub", th: IDLE, since: 0 }))).toEqual([{ t: "doc.ready", th: IDLE, head: 0 }]));

    const stranger = await generateIdentity("stranger");
    for (const [method, path, body] of [
      ["GET", "/docs", ""],
      ["POST", "/docs/prune", JSON.stringify({ th: [BUSY] })],
    ] as const) {
      const res = await fetch(`${relay}/v1/rooms/${access.roomId}${path}`, {
        method,
        headers: { authorization: `Bearer ${await signRequest(stranger, access.roomId, method, path, body)}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body } : {}),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect(await ch.pruneDocs(["bad"]).catch((e: unknown) => String(e))).toContain("doc ids");
    expect((await ch.docList()).map((d) => d.th)).toContain(BUSY);
  });

  test("over real sockets: a follower gets the update live, the sender and a socket that didn't follow don't", async () => {
    const open = async () => {
      const u = new URL(`/v1/rooms/${access.roomId}/ws?since=0`, relay);
      u.protocol = "ws:";
      const ws = new WebSocket(u, [WS_PROTOCOL, await signRequest(owner, access.roomId, "GET", "/ws")]);
      const got: ServerFrame[] = [];
      ws.onmessage = (m) => got.push(JSON.parse(String(m.data)) as ServerFrame);
      await new Promise<void>((ok, fail) => ((ws.onopen = () => ok()), (ws.onerror = () => fail(new Error("the socket didn't open")))));
      return { ws, got };
    };
    const until = async (got: ServerFrame[], ok: (f: ServerFrame) => boolean) => {
      for (let i = 0; i < 200 && !got.some(ok); i++) await Bun.sleep(10);
      return got.find(ok);
    };
    const th = "thread-ddddddddddddddd";
    const [writer, follower, bystander] = await Promise.all([open(), open(), open()]);
    try {
      follower.ws.send(JSON.stringify({ t: "doc.sub", th, since: 0 }));
      expect(await until(follower.got, (f) => f.t === "doc.ready")).toEqual({ t: "doc.ready", th, head: 0 });
      writer.ws.send(JSON.stringify({ t: "doc.sub", th, since: 0 }));
      await until(writer.got, (f) => f.t === "doc.ready");
      writer.ws.send(JSON.stringify({ t: "doc", id: "live1", th, iv: IV, ct: "bGl2ZQ", e: 0 }));
      expect(await until(writer.got, (f) => f.t === "ack")).toMatchObject({ t: "ack", id: "live1", seq: 1 });
      expect(await until(follower.got, (f) => f.t === "doc")).toMatchObject({ t: "doc", th, dseq: 1, ct: "bGl2ZQ" });
      follower.ws.send(JSON.stringify({ t: "doc.unsub", th }));
      await Bun.sleep(50);
      writer.ws.send(JSON.stringify({ t: "doc", id: "live2", th, iv: IV, ct: "bGl2ZTI", e: 0 }));
      await until(writer.got, (f) => f.t === "ack" && f.id === "live2");
      await Bun.sleep(50);
      expect(follower.got.filter((f) => f.t === "doc")).toHaveLength(1);
      expect(writer.got.filter((f) => f.t === "doc")).toHaveLength(0);
      expect(bystander.got.filter((f) => f.t === "doc")).toHaveLength(0);
    } finally {
      for (const s of [writer, follower, bystander]) s.ws.close();
    }
  });
});
