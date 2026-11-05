import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { b64url } from "@kiwi/core/crypto.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { Roster } from "@kiwi/core/state.ts";

import { bunSearchWorker, SearchHost } from "../src/search-host.ts";
import type { FoldInputs } from "../src/search-types.ts";

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const MESSAGES = arg("messages", 8_000);
const LIVE = arg("live", 200);
const IDLE_MS = arg("idle", 1_000);
const PAGE = 2_000;
const QUERIES = ["relay", "deploy", "report", "kiwi", "agent build", "ta", "fix test"];

let seed = 0x9e3779b9;
const random = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const letters = "abcdefghijklmnopqrstuvwxyz";
const vocabulary = [
  ...QUERIES.flatMap((q) => q.split(" ")),
  ...Array.from({ length: 8_000 }, () => Array.from({ length: 3 + Math.floor(random() * 8) }, () => letters[Math.floor(random() * 26)]).join("")),
];
const word = (): string => vocabulary[Math.floor(vocabulary.length * random() ** 3)]!;
const body = (): string => Array.from({ length: random() < 0.2 ? 60 + Math.floor(random() * 240) : 5 + Math.floor(random() * 25) }, word).join(" ");
const members = ["jow", "win", "olivia", "nova"];
const roster: Roster = members.map((name, i) => ({ name, pk: `pk-${name}`, owner: i === 0, at: 0, active: true, kind: i < 2 ? "human" : "agent" }));
const inputs: FoldInputs = { roster, roomsFloor: null, guardFloor: null, now: 0 };
const line = (seq: number): Message => {
  const from = members[seq % members.length]!;
  return { v: 1, id: `m${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "msg", body: body(), ts: seq, rts: seq } as Message;
};

const mb = (bytes: number): string => (bytes / 1_048_576).toFixed(1);

function footprint(): string {
  if (process.platform !== "darwin") return "-";
  const out = Bun.spawnSync(["footprint", String(process.pid)]).stdout.toString();
  const m = /Footprint: ([\d.]+) (KB|MB|GB)/.exec(out);
  if (!m) return "-";
  const n = Number(m[1]);
  return (m[2] === "GB" ? n * 1024 : m[2] === "KB" ? n / 1024 : n).toFixed(1);
}

const rows: string[][] = [["phase", "wall ms", "cpu ms", "rss MB", "peak rss MB", "footprint MB"]];
async function phase<T>(name: string, work: () => Promise<T>): Promise<T> {
  let peak = process.memoryUsage().rss;
  const sample = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 20);
  const cpu = process.cpuUsage();
  const t0 = performance.now();
  const out = await work();
  const wall = performance.now() - t0;
  const used = process.cpuUsage(cpu);
  clearInterval(sample);
  Bun.gc(true);
  const rss = process.memoryUsage().rss;
  rows.push([name, wall.toFixed(0), ((used.user + used.system) / 1000).toFixed(0), mb(rss), mb(Math.max(peak, rss)), footprint()]);
  return out;
}

const dir = mkdtempSync(path.join(tmpdir(), "kiwi-search-memory-"));
try {
  const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, "..", "src", "search-worker.ts")], target: "bun" });
  const out = built.outputs[0];
  if (!built.success || !out) throw new Error(`the search worker didn't bundle: ${built.logs.join("\n")}`);
  const worker = path.join(dir, "search.js");
  writeFileSync(worker, await out.text());
  const at = { file: path.join(dir, "search", "c.idx"), key: b64url(crypto.getRandomValues(new Uint8Array(32))), roomId: "f".repeat(32) };
  const host = new SearchHost(() => bunSearchWorker(worker), IDLE_MS);
  const all = Array.from({ length: MESSAGES + LIVE }, (_, i) => line(i + 1));
  Bun.gc(true);
  rows.push(["start", "", "", mb(process.memoryUsage().rss), "", footprint()]);

  await phase(`backfill ${MESSAGES}`, async () => {
    await host.open("c", at);
    for (let from = 1; from <= MESSAGES; from += PAGE) {
      await host.feed("c", [], inputs, 1);
      await host.feed("c", all.slice(from - 1, Math.min(from - 1 + PAGE, MESSAGES)), inputs, from);
    }
  });
  await phase(`live ${LIVE}`, async () => {
    for (let seq = MESSAGES + 1; seq <= MESSAGES + LIVE; seq++) {
      await host.feed("c", [], inputs, 1);
      await host.feed("c", [all[seq - 1]!], inputs, seq);
    }
  });
  const head = MESSAGES + LIVE;
  const answers = await phase("warm search x7", async () => Promise.all(QUERIES.map((q) => host.search("c", q, ["general"], 500, head))));
  const counts = answers.map((a) => a.hits.length);
  const digest = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(answers.map((a) => a.hits)))
    .digest("hex")
    .slice(0, 16);
  await phase(`idle ${IDLE_MS + 500} ms`, () => Bun.sleep(IDLE_MS + 500));
  const cold = await phase("cold search", () => host.search("c", "relay", ["general"], 500, head));
  const colds: number[] = [];
  for (let i = 0; i < 5; i++) {
    await Bun.sleep(IDLE_MS + 500);
    const t0 = performance.now();
    await host.search("c", QUERIES[i]!, ["general"], 500, head);
    colds.push(performance.now() - t0);
  }
  await phase(`idle again ${IDLE_MS + 500} ms`, () => Bun.sleep(IDLE_MS + 500));
  const last = head + 20;
  for (let seq = head + 1; seq <= last; seq++) await host.feed("c", [line(seq)], inputs, seq);
  await phase("quit with 20 unsaved", () => host.close());
  const again = new SearchHost(() => bunSearchWorker(worker), IDLE_MS);
  const reopened = await again.open("c", at);
  again.stop();
  const file = readdirSync(path.dirname(at.file)).find((f) => f.endsWith(".idx"));
  const size = file ? statSync(path.join(path.dirname(at.file), file)).size : 0;
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  for (const r of rows) console.log(r.map((v, c) => (c ? v.padStart(widths[c]!) : v.padEnd(widths[c]!))).join("  "));
  console.log(`index file ${mb(size)} MB; cold search ${cold.state} with ${cold.hits.length} hits; next cold searches ${colds.map((c) => c.toFixed(0)).join(", ")} ms`);
  console.log(`hits per query ${counts.join(",")}, results ${digest}; after quit the index reopens through ${reopened} of ${last}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
