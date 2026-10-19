import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Limit {
  what: string;
  at: string[];
  budget: number;
  gate: number | null;
  nightly?: boolean;
}

const args = process.argv.slice(2);
const nightly = args.includes("--nightly");
const comment = args.includes("--comment");
const runs = args.filter((a) => !a.startsWith("--"));
if (!runs.length) {
  console.error("usage: bun scripts/perf-check.ts [--nightly] run1.json [run2.json ...]");
  process.exit(2);
}

const limits = JSON.parse(readFileSync(resolve(import.meta.dir, "perf-budgets.json"), "utf8")) as Record<string, Limit>;
const reports = runs.map((f) => JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>);

function pick(report: Record<string, unknown>, at: string[]): number | null {
  const [first, ...rest] = at;
  const key = first === "typing" ? Object.keys(report).find((k) => k.startsWith("typing while")) : first;
  let v: unknown = key ? report[key] : undefined;
  for (const k of rest) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const rows: string[] = [];
const over: string[] = [];
const short: string[] = [];
for (const [name, l] of Object.entries(limits)) {
  if (l.nightly && !nightly) continue;
  const seen = reports.map((r) => pick(r, l.at)).filter((v): v is number => v !== null);
  if (!seen.length) {
    over.push(`${l.what}: not measured`);
    rows.push(`| ${l.what} | not measured | ${l.gate ?? "none yet"} | ${l.budget} |`);
    continue;
  }
  const m = Math.round(median(seen) * 10) / 10;
  rows.push(`| ${l.what} | ${m} | ${l.gate ?? "none yet"} | ${l.budget} |`);
  if (l.gate !== null && m > l.gate) over.push(`${l.what}: ${m}, over its gate ${l.gate} (${name})`);
  if (l.gate === null || l.gate > l.budget) short.push(`${l.what}: gate ${l.gate ?? "none"}, 0.20 budget ${l.budget}`);
}

const lines = [
  `**perf-scale, median of ${reports.length} run${reports.length === 1 ? "" : "s"}${nightly ? " with the soak" : ""}**`,
  "",
  "| What | Median | Gate | 0.20 budget |",
  "|---|---|---|---|",
  ...rows,
  ...(short.length ? ["", `Not yet at the 0.20 budget (${short.length}):`, ...short.map((s) => `- ${s}`)] : []),
  ...(over.length ? ["", "Over a gate:", ...over.map((s) => `- ${s}`)] : []),
];
const text = lines.join("\n");
console.log(text);
if (comment) await upsert(text);
process.exit(over.length ? 1 : 0);

async function upsert(body: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = Number(process.env.PR_NUMBER);
  if (!token || !repo || !Number.isSafeInteger(pr) || pr <= 0) return;
  const marker = "<!-- perf-scale -->";
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`https://api.github.com${path}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" } });
  const listed = await api(`/repos/${repo}/issues/${pr}/comments?per_page=100`);
  const mine = listed.ok ? ((await listed.json()) as { id: number; body: string }[]).find((c) => c.body.startsWith(marker)) : undefined;
  const full = JSON.stringify({ body: `${marker}\n${body}` });
  const res = mine ? await api(`/repos/${repo}/issues/comments/${mine.id}`, { method: "PATCH", body: full }) : await api(`/repos/${repo}/issues/${pr}/comments`, { method: "POST", body: full });
  if (!res.ok) console.error(`couldn't post the perf comment: ${res.status}`);
}
