import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Layer from "effect/Layer";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { Envelope } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { Human } from "../src/relay/human.ts";
import { GithubApp, GithubPush, githubPushFrom } from "../src/relay/github-app.ts";
import { OPEN_POLICY, Policy } from "../src/relay/policy.ts";
import { Directory, msgFrame, RoomDb, welcomeFrames, type Sql, type SqlParam } from "../src/relay/room.ts";
import { makeRelay, runRoomSync } from "../src/relay/route.ts";

setDefaultTimeout(60_000);

const BUDGET = { storedPerCiphertextChar: 0.8 } as const;
const K = 90;

const CT_CHARS = "CASE WHEN typeof(ct) = 'blob' THEN (LENGTH(ct) * 4 + 2) / 3 ELSE LENGTH(ct) END";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-budget-blob-"));
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
let roomId = "";
let owner: Identity | undefined;
let firstCrafted = 0;
type Kind = "blob" | "text";
const crafted: { iv: string; ct: string }[] = [];
const storedAs: { iv: Kind; ct: Kind }[] = [];

const craft = (iv: string, ct: string, ivAs: Kind, ctAs: Kind): void => {
  crafted.push({ iv, ct });
  storedAs.push({ iv: ivAs, ct: ctAs });
};

const relayCtx = makeRelay(
  Layer.mergeAll(
    Layer.succeed(Human, null),
    Layer.succeed(GithubApp, null),
    Layer.succeed(GithubPush, githubPushFrom()),
    Layer.succeed(Policy, OPEN_POLICY),
    Layer.succeed(Directory, { list: async () => [], reserve: async () => true, release: async () => {} }),
  ),
);

const sqlOf = (db: Database): Sql => ({
  run: (q, ...p) => void db.query(q).run(...p),
  all: <T>(q: string, ...p: SqlParam[]) => db.query(q).all(...p) as T[],
});

const random = (n: number): string => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function call(method: string, path: string, body = ""): Promise<Response> {
  const auth = await signRequest(owner!, roomId, method, path, body);
  return fetch(new URL(`/v1/rooms/${roomId}${path}`, relay), {
    method,
    body: method === "GET" ? undefined : body,
    headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
  });
}

const line = (i: number): string => {
  const words = ["build", "passed", "on", "main", "deploying", "the", "relay", "now", "tests", "are", "green", "review", "please"];
  const len = [12, 40, 80, 160, 300, 600, 1200][i % 7]!;
  let s = `#${i}`;
  for (let w = 0; s.length < len; w++) s += ` ${words[(i + w) % words.length]}`;
  return s;
};

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  owner = await generateIdentity("boss");
  const { access } = await Channel.create(relay, owner, { name: "boss" });
  roomId = access.roomId;
  const ch = new Channel(access, relay, owner);
  for (let i = 0; i < K; i++) await ch.send(line(i));

  for (const n of [1, 2, 3, 16, 17, 18, 100, 1000]) craft(random(12), random(n), "blob", "blob");
  for (const ct of ["YR", "Y3Z", "Y3Y=", "a+b/", "ab cd", "é-ü", "x"]) craft("not base64!", ct, "text", "text");
  craft(random(12), "YR", "blob", "text");
  craft(random(12), "a+b/", "blob", "text");
  craft("not base64!", random(16), "text", "blob");
  craft("Y3Z", random(17), "text", "blob");
  for (const m of crafted) {
    const res = await call("POST", "/messages", JSON.stringify({ ...m, e: 0 }));
    expect(res.status).toBe(200);
    const { seq } = (await res.json()) as { seq: number };
    firstCrafted ||= seq;
  }
});

afterAll(() => {
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("message ciphertext stored as bytes", () => {
  test("the relay stores at least 20% fewer ciphertext bytes, and quotas still count base64 characters", () => {
    const db = new Database(join(dataDir, `${roomId}.sqlite`), { readonly: true });
    const real = `FROM msgs WHERE seq < ${firstCrafted}`;
    const stored = (db.query(`SELECT SUM(LENGTH(CAST(ct AS BLOB))) AS n ${real}`).get() as { n: number }).n;
    const storedIv = (db.query(`SELECT SUM(LENGTH(CAST(iv AS BLOB))) AS n ${real}`).get() as { n: number }).n;
    const chars = (db.query(`SELECT SUM(${CT_CHARS}) AS n ${real}`).get() as { n: number }).n;
    const blobs = (db.query(`SELECT COUNT(*) AS n ${real} AND typeof(ct) = 'blob' AND typeof(iv) = 'blob'`).get() as { n: number }).n;
    const total = (db.query(`SELECT SUM(${CT_CHARS}) AS n FROM msgs`).get() as { n: number }).n;
    const usage = JSON.parse((db.query("SELECT v FROM meta WHERE k = 'usage'").get() as { v: string }).v) as { bytes: number };
    const rows = db.query(`SELECT iv, ct ${real}`).all() as { iv: string | Uint8Array; ct: string | Uint8Array }[];
    db.close();

    const pages = (blob: boolean): number => {
      const mem = new Database(":memory:");
      mem.run("CREATE TABLE msgs (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, e INTEGER NOT NULL)");
      const put = mem.query("INSERT INTO msgs (ts, iv, ct, e) VALUES (0, ?, ?, 0)");
      for (const r of rows) {
        const iv = typeof r.iv === "string" ? r.iv : blob ? r.iv : b64url(r.iv);
        const ct = typeof r.ct === "string" ? r.ct : blob ? r.ct : b64url(r.ct);
        put.run(iv, ct);
      }
      const n = (mem.query("PRAGMA page_count").get() as { page_count: number }).page_count;
      mem.close();
      return n;
    };
    const before = pages(false);
    const after = pages(true);

    console.log(`${K} messages: ct ${chars} base64 chars -> ${stored} stored bytes (${((1 - stored / chars) * 100).toFixed(1)}% less); iv ${K * 16} -> ${storedIv}`);
    console.log(`msgs table pages: ${before} as text -> ${after} as bytes`);
    expect(blobs).toBe(K);
    expect(stored / chars).toBeLessThanOrEqual(BUDGET.storedPerCiphertextChar);
    expect(after).toBeLessThan(before);
    expect(usage.bytes).toBe(total);
  });

  test("GET /messages returns exactly what was sent, as bytes or kept as text", async () => {
    const res = await call("GET", `/messages?since=${firstCrafted - 1}`);
    const { messages } = (await res.json()) as { messages: Envelope[] };
    expect(messages.map((m) => ({ iv: m.iv, ct: m.ct }))).toEqual(crafted);
    const db = new Database(join(dataDir, `${roomId}.sqlite`), { readonly: true });
    const kinds = db.query(`SELECT typeof(iv) AS iv, typeof(ct) AS ct FROM msgs WHERE seq >= ? ORDER BY seq`).all(firstCrafted) as { iv: string; ct: string }[];
    db.close();
    expect(kinds).toEqual(storedAs);
  });

  test("a socket's backlog frames are byte-identical to the frames broadcast when sent", async () => {
    const res = await call("GET", `/messages?since=${firstCrafted - 1}`);
    const { messages } = (await res.json()) as { messages: Envelope[] };
    const db = new Database(join(dataDir, `${roomId}.sqlite`), { readonly: true });
    const frames = runRoomSync(relayCtx, new RoomDb(sqlOf(db), roomId), welcomeFrames(firstCrafted - 1));
    db.close();
    expect(frames.slice(0, crafted.length)).toEqual(messages.map((m, i) => msgFrame({ seq: m.seq, ts: m.ts, ...crafted[i]!, e: 0 })));
  });

  test("a room mixing old text rows and new byte rows reads and counts both", () => {
    const mem = new Database(":memory:");
    const db = new RoomDb(sqlOf(mem), "b".repeat(32));
    db.init();
    const old = [random(30), random(31), "legacy text", random(700)];
    const fresh = [random(29), random(500), "Y3Y=", random(1)];
    old.forEach((ct, i) => mem.run("INSERT INTO msgs (seq, ts, iv, ct, e) VALUES (?, 0, ?, ?, 0)", [i + 1, "aXZpdml2aXZpdml2", ct]));
    fresh.forEach((ct, i) => db.insert(old.length + i + 1, 0, "aXZpdml2aXZpdml2", ct, 0));
    const all = [...old, ...fresh];
    expect(db.since(0)).toEqual(all.map((ct, i) => ({ seq: i + 1, ts: 0, iv: "aXZpdml2aXZpdml2", ct, e: 0 })));
    expect((mem.query("SELECT typeof(ct) AS t FROM msgs ORDER BY seq").all() as { t: string }[]).map((r) => r.t)).toEqual(["text", "text", "text", "text", "blob", "blob", "text", "blob"]);
    const chars = (xs: string[]): number => xs.reduce((n, s) => n + s.length, 0);
    expect(db.storedBytes()).toBe(chars(all));
    expect(db.dropOldest(chars(all.slice(0, 5)))).toBe(chars(all.slice(0, 5)));
    expect(db.since(0).map((m) => m.ct)).toEqual(all.slice(5));
    mem.close();
  });
});
