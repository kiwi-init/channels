import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Channel } from "../src/client.ts";
import { fromB64url, MAX_UNPACKED, newChannelKey, newRoomId, open, PACK_FROM, b64url } from "../src/crypto.ts";
import { generateIdentity, sign } from "../src/identity.ts";
import { PROTOCOL_VERSION, type Event } from "../src/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const BUDGET = {
  status: 1.5,
  task: 1.6,
  json: 4,
  long: 2.2,
} as const;

type Item = { body: string; ev?: Event; to?: string[] };
type Kind = "status" | "task" | "json" | "oneLiner";

const fence = "```";

const status = (n: number, file: string): string =>
  [
    `## Status update ${n}: ${file}`,
    "",
    `Finished the refactor of \`${file}\`. All tests in \`test/${file.replace(/\.ts$/, "")}.test.ts\` pass locally (412 pass, 0 fail, 3 skip).`,
    "",
    "### What changed",
    "",
    `- Moved the retry loop out of \`callRelay\` into \`withRetry\`, so every caller gets the same backoff.`,
    "- The 409 path now refreshes the keys once and resends, instead of failing the whole send.",
    "- Dropped the unused `legacyHead` helper and its two call sites.",
    "",
    `${fence}ts`,
    "export const withRetry = <A, E, R>(effect: Effect.Effect<A, E, R>, opts: RetryOptions = {}): Effect.Effect<A, E, R> =>",
    "  effect.pipe(",
    "    Effect.retry({",
    "      schedule: Schedule.exponential(opts.base ?? 200).pipe(Schedule.jittered, Schedule.compose(Schedule.recurs(opts.times ?? 4))),",
    "      while: (err) => err instanceof RelayError && (err.status === 429 || err.status >= 500),",
    "    }),",
    "  );",
    fence,
    "",
    "### Test output",
    "",
    fence,
    `bun test v1.4.2 (${n}a1b2c3d)`,
    `test/${file.replace(/\.ts$/, "")}.test.ts:`,
    "(pass) retries a 503 four times with backoff [812.33ms]",
    "(pass) gives up on a 403 at once [4.12ms]",
    "(pass) refreshes keys on a 409 and resends once [61.70ms]",
    "(pass) does not retry a 400 [3.98ms]",
    "",
    " 412 pass",
    " 3 skip",
    " 0 fail",
    ` 1873 expect() calls`,
    `Ran 415 tests across 61 files. [${41 + n}.87s]`,
    fence,
    "",
    "### Next",
    "",
    "1. Wire `withRetry` into the daemon's reconnect path.",
    "2. Ask the reviewer to look at the jitter bounds.",
    "3. Open the PR once CI is green.",
  ].join("\n");

const taskText = [
  "# Task: make the history cache survive a key rotation",
  "",
  "## Context",
  "",
  "The app keeps every opened message in an IndexedDB cache sealed with the channel key of its epoch. When the owner removes a member the key rotates, and members that were offline during the rotation fetch the new wrapped key on their next look. Today the cache keys rows by `seq` only, so a client that cached messages under epoch 3 and then reads epoch 4 rows can mix them up when the relay trims the log and a `since` cursor goes past the trim point.",
  "",
  "## What to do",
  "",
  "1. Key cached rows by `(roomId, epoch, seq)` and migrate existing rows on first open (version 2 of the store).",
  "2. When `history(since)` returns a head lower than the newest cached seq, treat the cache as stale: drop rows above the head and refetch.",
  "3. Never re-seal a cached row under a newer key; a row stays sealed under the key of the epoch it arrived in.",
  "4. Add tests in `web/src/lib/history.test.ts` for: a rotation while offline, a trimmed log, a relay that rolls back its head, and a cache written by the previous version.",
  "",
  "## Acceptance",
  "",
  "- Opening a channel after a rotation shows the same messages as a fresh client, in the same order, with no duplicates.",
  "- A relay that serves a lower head than before cannot make the app hide cached messages without saying so: show the existing \"history was reset\" notice.",
  "- No new network requests on a warm open (check with the traffic proxy in `test/traffic.ts`).",
  "- `bun scripts/ci-tests.ts core` and `cd web && bunx tsc -b && bun oxlint src` pass.",
  "",
  "## Out of scope",
  "",
  "- Compressing the cache.",
  "- Changing how the key process seals rows (see T49).",
  "",
  "## Notes",
  "",
  "The migration must not block first paint: run it after the conversation renders, and keep reading version 1 rows until it finishes. If the migration fails half way, the next open retries it from the start; rows already moved are idempotent because the new key includes the epoch.",
].join("\n");

const ciJson = JSON.stringify(
  {
    run: 18234,
    branch: "perf/compress",
    sha: "51c8938a4f0e2d1b7c6a9e8f0d1c2b3a4e5f6a7b",
    jobs: ["web / lint", "web / types", "relay / test", "relay / budget", "cli / flows-a", "cli / flows-b", "repo / knip", "repo / comments"].map((name, i) => ({
      name,
      status: "completed",
      conclusion: i === 3 ? "failure" : "success",
      startedAt: `2026-10-16T12:0${i}:11Z`,
      completedAt: `2026-10-16T12:0${i + 1}:47Z`,
      steps: [
        { name: "checkout", conclusion: "success", seconds: 2 },
        { name: "setup bun", conclusion: "success", seconds: 6 },
        { name: "install", conclusion: "success", seconds: 11 },
        { name: name.split(" / ")[1], conclusion: i === 3 ? "failure" : "success", seconds: 40 + i * 7 },
      ],
    })),
  },
  null,
  2,
);

const card: Event = {
  op: "card",
  os: "macos",
  arch: "arm64",
  harness: "claude-code",
  model: "claude-opus-5-5",
  cpu: "12 cores · Apple M3 Pro",
  memory: "36 GB",
  tools: ["bun", "node", "docker", "git", "gh", "xcode", "cargo", "rustc", "python3", "uv", "go", "make", "cmake", "ffmpeg", "sqlite3", "wrangler", "jq", "ripgrep"],
  repo: "ojowwalker77/channels",
  branch: "perf/compress",
  note: "Works on the relay and the client library. Can run the desktop app and the web UI locally; no access to production Cloudflare.",
};

const corpus: Record<Kind, Item[]> = {
  status: [status(1, "client.ts"), status(2, "daemon.ts"), status(3, "relay/room.ts")].map((body) => ({ body })),
  task: [{ body: "make the history cache survive a key rotation", ev: { op: "task.add", title: "make the history cache survive a key rotation", detail: taskText, review: "*" } }, { body: taskText }],
  json: [{ body: `CI run 18234 on perf/compress:\n\n${fence}json\n${ciJson}\n${fence}` }, { body: "card", ev: card }],
  oneLiner: ["on it", "done, see #42", "LGTM", "pushed 51c8938 to perf/compress", "@lead can you approve T7?"].map((body) => ({ body })),
};

const typicalEvents: Item[] = [
  { body: "hello", ev: { op: "hello", role: "reviewer", about: "reviews relay changes" } },
  { body: "card", ev: card },
  { body: "card", ev: { op: "card", os: "linux", arch: "x64", harness: "codex", model: "gpt-5-codex", tools: ["bun", "git"] } },
  { body: "added task: fix the reconnect backoff", ev: { op: "task.add", title: "fix the reconnect backoff", owner: "otter-gentle" } },
  { body: "added task: cache the info call", ev: { op: "task.add", title: "cache the info call", detail: "kiwi send fetches GET /info six times; fetch it once per process and reuse it.", review: "*" } },
  { body: "claimed T7", ev: { op: "task.claim", task: 7 } },
  { body: "T7 doing", ev: { op: "task.update", task: 7, state: "doing" } },
  { body: "T7 review at 51c8938", ev: { op: "task.update", task: 7, state: "review", at: "51c8938a4f0e2d1b7c6a9e8f0d1c2b3a4e5f6a7b", note: "ready for review" } },
  { body: "T7 approved", ev: { op: "task.update", task: 7, verdict: "approved", round: 1, at: "51c8938a4f0e2d1b7c6a9e8f0d1c2b3a4e5f6a7b" } },
  { body: "T7 done", ev: { op: "task.update", task: 7, state: "done", note: "merged in #219" } },
  { body: "fact build=green", ev: { op: "fact.set", key: "build", value: "green", ttl: 3600 } },
  { body: "fact deleted", ev: { op: "fact.del", key: "build" } },
  { body: "made otter-gentle coordinator", ev: { op: "role.set", member: "otter-gentle", role: "coordinator", about: "routes work between people and agents" } },
  { body: "👍", ev: { op: "react", seq: 41, emoji: "👍" } },
  { body: "👀", ev: { op: "react", seq: 42, emoji: "👀" } },
  { body: "coordinator-only on (strict)", ev: { op: "mode.set", coordinatorOnly: true, strict: true } },
  { body: "made the room #relay", ev: { op: "room.create", id: "4f1e2d3c4b5a6978", name: "relay" } },
  { body: "set what fox-quiet may do: tasks, facts", ev: { op: "scope.set", member: "fox-quiet", pk: "x8Kq1u2V3w4X5y6Z7a8B9c0D1e2F3g4H5i6J7k8L9m0", scopes: ["tasks", "facts"] } },
  { body: "charter: Get onemouse working end to end", ev: { op: "charter.set", text: "Get onemouse working end to end between a Mac and a PC. This repo only; nothing in production; ask before adding dependencies." } },
  { body: "on hold: checking who asked for a production push", ev: { op: "hold.set", on: true, note: "checking who asked for a production push" } },
];

const bytes = (s: string) => new TextEncoder().encode(s).byteLength;

async function legacyOpen(key: string, roomId: string, iv: string, ct: string): Promise<unknown> {
  try {
    const k = await crypto.subtle.importKey("raw", fromB64url(key), "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv), additionalData: new TextEncoder().encode(roomId) }, k, fromB64url(ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

async function rawSeal(key: string, roomId: string, plain: Uint8Array<ArrayBuffer>): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey("raw", fromB64url(key), "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(roomId) }, k, plain);
  return { iv: b64url(iv), ct: b64url(new Uint8Array(ct)) };
}

async function packed(json: Uint8Array<ArrayBuffer>, marker = 0): Promise<Uint8Array<ArrayBuffer>> {
  const z = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const out = new Uint8Array(z.byteLength + 1);
  out[0] = marker;
  out.set(z, 1);
  return out;
}

type Posted = { iv: string; ct: string; e: number };

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-budget-compress-"));
const posted: Posted[] = [];
let server: ReturnType<typeof startRelay> | undefined;
let capture: ReturnType<typeof Bun.serve> | undefined;
let s: OwnerSetup;
let agent: Channel;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const target = server.url.origin;
  capture = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
      if (req.method === "POST" && url.pathname.endsWith("/messages") && body) posted.push(JSON.parse(body) as Posted);
      const res = await fetch(target + url.pathname + url.search, { method: req.method, headers: req.headers, body });
      const headers = new Headers(res.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(res.status === 204 || res.status === 304 ? null : await res.arrayBuffer(), { status: res.status, headers });
    },
  });
  s = await setupChannel(`http://127.0.0.1:${capture.port}`);
  agent = (await joinAgent(s, "otter-gentle", await pairComputer(s.person))).ch;
});

afterAll(() => {
  void capture?.stop(true);
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function sendAll(ch: Channel, items: Item[]): Promise<{ seqs: number[]; sent: Posted[] }> {
  const from = posted.length;
  const seqs: number[] = [];
  for (const it of items) seqs.push(await ch.send(it.body, { ...(it.ev ? { kind: "event" as const, ev: it.ev } : {}), ...(it.to ? { to: it.to } : {}) }));
  return { seqs, sent: posted.slice(from) };
}

const ctTotal = (sent: Posted[]) => sent.reduce((n, p) => n + p.ct.length, 0);

describe("compressed message payloads", () => {
  const off: Partial<Record<Kind, { seqs: number[]; sent: Posted[] }>> = {};
  const on: Partial<Record<Kind, { seqs: number[]; sent: Posted[] }>> = {};
  const kinds = Object.keys(corpus) as Kind[];

  test("a channel that never opted in sends plain JSON every 0.14 reader parses", async () => {
    expect(await agent.compress()).toBe(false);
    for (const k of kinds) off[k] = await sendAll(agent, corpus[k]);
    const key = s.access.keys["0"]!;
    for (const k of kinds) for (const p of off[k]!.sent) expect(await legacyOpen(key, s.roomId, p.iv, p.ct)).not.toBeNull();
  });

  test("a sender that has not read the owner's opt-in keeps sending plain JSON", async () => {
    const late = (await joinAgent(s, "fox-quiet", await pairComputer(s.person))).ch;
    await s.ownerCh.setCompress(true);
    const { sent } = await sendAll(late, corpus.status.slice(0, 1));
    expect(await legacyOpen(s.access.keys["0"]!, s.roomId, sent[0]!.iv, sent[0]!.ct)).not.toBeNull();
  });

  test("once the owner opts in, long messages shrink and every new reader gets identical payloads", async () => {
    expect(await agent.compress()).toBe(true);
    for (const k of kinds) on[k] = await sendAll(agent, corpus[k]);
    const { messages } = await s.ownerCh.history(0);
    const bySeq = new Map(messages.map((m) => [m.seq, m]));
    for (const k of kinds) {
      for (let i = 0; i < corpus[k].length; i++) {
        const a = bySeq.get(off[k]!.seqs[i]!)!;
        const b = bySeq.get(on[k]!.seqs[i]!)!;
        expect(b.sigOk).toBe(true);
        expect(b.body).toBe(a.body);
        expect(b.ev).toEqual(a.ev);
        expect(b.body).toBe(corpus[k][i]!.body);
      }
    }
    const rows: string[] = [];
    let offLong = 0;
    let onLong = 0;
    for (const k of kinds) {
      const before = ctTotal(off[k]!.sent);
      const after = ctTotal(on[k]!.sent);
      rows.push(`  ${k.padEnd(9)} n=${corpus[k].length}  ct ${String(before).padStart(6)} -> ${String(after).padStart(6)} chars  x${(before / after).toFixed(2)}`);
      if (k !== "oneLiner") {
        offLong += before;
        onLong += after;
      }
    }
    rows.push(`  long kinds total  ct ${offLong} -> ${onLong} chars  x${(offLong / onLong).toFixed(2)}`);
    console.log(`ciphertext per kind, compression off -> on:\n${rows.join("\n")}`);
    const ratio = (k: Kind) => ctTotal(off[k]!.sent) / ctTotal(on[k]!.sent);
    expect(ratio("status")).toBeGreaterThanOrEqual(BUDGET.status);
    expect(ratio("task")).toBeGreaterThanOrEqual(BUDGET.task);
    expect(ratio("json")).toBeGreaterThanOrEqual(BUDGET.json);
    expect(offLong / onLong).toBeGreaterThanOrEqual(BUDGET.long);
    expect(on.oneLiner!.sent.map((p) => p.ct.length)).toEqual(off.oneLiner!.sent.map((p) => p.ct.length));
  });

  test("an opted-in channel's long messages are what a 0.14 reader would drop, its short ones are not", async () => {
    const key = s.access.keys["0"]!;
    for (const p of on.status!.sent) expect(await legacyOpen(key, s.roomId, p.iv, p.ct)).toBeNull();
    for (const p of on.oneLiner!.sent) expect(await legacyOpen(key, s.roomId, p.iv, p.ct)).not.toBeNull();
  });

  test("the owner can turn it off again", async () => {
    await s.ownerCh.setCompress(false);
    expect(await agent.compress()).toBe(false);
    const { sent } = await sendAll(agent, corpus.status.slice(0, 1));
    expect(await legacyOpen(s.access.keys["0"]!, s.roomId, sent[0]!.iv, sent[0]!.ct)).not.toBeNull();
  });

  test("only the owner sets it", async () => {
    await expect(agent.setCompress(true)).rejects.toThrow("only the channel owner can do that");
  });
});

describe("unpacking limits", () => {
  const key = newChannelKey();
  const roomId = newRoomId();

  test("a payload that inflates past the cap is unreadable", async () => {
    const bomb = new TextEncoder().encode(JSON.stringify({ body: " ".repeat(MAX_UNPACKED + 1) }));
    const z = await packed(bomb);
    console.log(`bomb: ${bomb.byteLength} bytes deflate to ${z.byteLength}`);
    const sealed = await rawSeal(key, roomId, z);
    expect(await open(key, roomId, sealed.iv, sealed.ct)).toBeNull();
  });

  test("just under the cap still opens", async () => {
    const body = "a".repeat(MAX_UNPACKED - 64);
    const sealed = await rawSeal(key, roomId, await packed(new TextEncoder().encode(JSON.stringify({ body }))));
    expect(await open(key, roomId, sealed.iv, sealed.ct)).toEqual({ body });
  });

  test("corrupt deflate data is unreadable, not a crash", async () => {
    const sealed = await rawSeal(key, roomId, Uint8Array.of(0, 0xff, 0xfe, 0xfd, 0x12, 0x34));
    expect(await open(key, roomId, sealed.iv, sealed.ct)).toBeNull();
  });
});

test("how many typical events are below the packing threshold", async () => {
  const id = await generateIdentity("otter-gentle");
  const sizes: number[] = [];
  for (const it of typicalEvents) {
    const signed = await sign(id, { v: PROTOCOL_VERSION, id: crypto.randomUUID(), from: id.name, kind: "event" as const, body: it.body, ev: it.ev!, ts: Date.now() });
    sizes.push(bytes(JSON.stringify(signed)));
  }
  const small = sizes.filter((n) => n < PACK_FROM).length;
  const sorted = [...sizes].sort((a, b) => a - b);
  console.log(
    `typical events: ${small}/${sizes.length} (${Math.round((100 * small) / sizes.length)}%) are under ${PACK_FROM} bytes and never packed; sizes min ${sorted[0]} median ${sorted[Math.floor(sorted.length / 2)]} max ${sorted.at(-1)}`,
  );
  expect(small).toBeGreaterThan(0);
});
