import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

type Speed = "@1x" | "@4x";

interface Limit {
  what: string;
  at: string[];
  per?: Speed;
  inPage?: string[];
  budget: number;
  gate: number | null;
  nightly?: boolean;
}

type Range = [number, number];

interface Budgets {
  reference: Record<Speed, number>;
  calibration: Record<Speed | "ratio", Range>;
  limits: Record<string, Limit>;
}

const args = process.argv.slice(2);
const nightly = args.includes("--nightly");
const comment = args.includes("--comment");
const runs = args.filter((a) => !a.startsWith("--"));
if (!runs.length) {
  console.error("usage: bun scripts/perf-check.ts [--nightly] run1.json [run2.json ...]");
  process.exit(2);
}

const { reference, calibration: bounds, limits } = JSON.parse(readFileSync(resolve(import.meta.dir, "perf-budgets.json"), "utf8")) as Budgets;
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

const inside = (v: number, [lo, hi]: Range) => v >= lo && v <= hi;

function calibrationOf(report: Record<string, unknown>): Record<Speed, number> | string {
  const c1 = pick(report, ["@1x", "calibrationMs"]);
  const c4 = pick(report, ["@4x", "calibrationMs"]);
  if (c1 === null || c4 === null) return "it has no calibration";
  if (!inside(c1, bounds["@1x"])) return `its @1x calibration ${c1} ms is outside ${bounds["@1x"].join("-")}`;
  if (!inside(c4, bounds["@4x"])) return `its @4x calibration ${c4} ms is outside ${bounds["@4x"].join("-")}`;
  const ratio = Math.round((c4 / c1) * 100) / 100;
  if (!inside(ratio, bounds.ratio)) return `its @4x/@1x calibration ratio ${ratio} is outside ${bounds.ratio.join("-")}`;
  return { "@1x": c1, "@4x": c4 };
}

function scaled(report: Record<string, unknown>, l: Limit, calibration: Record<Speed, number> | string): number | null {
  const v = pick(report, l.at);
  if (v === null || !l.per) return v;
  if (typeof calibration === "string") return null;
  const factor = reference[l.per] / calibration[l.per];
  if (!l.inPage) return v * factor;
  const inPage = pick(report, l.inPage);
  return inPage !== null && inPage >= 0 && inPage <= v ? v - inPage + inPage * factor : null;
}

const round = (n: number) => Math.round(n * 10) / 10;
const calibrations = (["@1x", "@4x"] as const).map((s) => {
  const seen = reports.map((r) => pick(r, [s, "calibrationMs"])).filter((v): v is number => v !== null);
  return `${s} ${seen.length ? seen.join(", ") : "none"} ms (reference ${reference[s]})`;
});

const calibrated = reports.map(calibrationOf);
const leftOut = calibrated.flatMap((c, i) => (typeof c === "string" ? [`${basename(runs[i]!)}: ${c}`] : []));
const usable = calibrated.length - leftOut.length;
const needed = Math.min(2, reports.length);

const rows: string[] = [];
const over: string[] = [];
const short: string[] = [];
const partial: string[] = [];
for (const [name, l] of Object.entries(limits)) {
  if (l.nightly && !nightly) continue;
  const measured = reports.map((r) => pick(r, l.at)).filter((v): v is number => v !== null);
  const each = reports.map((r, i) => scaled(r, l, calibrated[i]!));
  for (const [i, v] of each.entries()) if (v === null && typeof calibrated[i] !== "string") partial.push(`${l.what}: ${basename(runs[i]!)} has no usable value`);
  const seen = each.filter((v): v is number => v !== null);
  if (!seen.length || (l.per && seen.length < needed)) {
    over.push(`${l.what}: not measured${seen.length ? ` (${seen.length} of ${reports.length} runs can be scaled, ${needed} needed)` : ""}`);
    rows.push(`| ${l.what} | not measured | | ${l.gate ?? "none yet"} | ${l.budget} |`);
    continue;
  }
  const m = round(median(seen));
  rows.push(`| ${l.what} | ${round(median(measured))} | ${l.per ? m : ""} | ${l.gate ?? "none yet"} | ${l.budget} |`);
  if (l.gate !== null && m > l.gate) over.push(`${l.what}: ${m}, over its gate ${l.gate} (${name})`);
  if (l.gate === null || l.gate > l.budget) short.push(`${l.what}: gate ${l.gate ?? "none"}, 0.20 budget ${l.budget}`);
}

const lines = [
  `**perf-scale, median of ${reports.length} run${reports.length === 1 ? "" : "s"}${nightly ? " with the soak" : ""}**`,
  "",
  `Timings are scaled to the reference runner by each run's CPU calibration before the gates: ${calibrations.join("; ")}.`,
  "",
  "| What | Measured | Scaled | Gate | 0.20 budget |",
  "|---|---|---|---|---|",
  ...rows,
  ...(leftOut.length ? ["", `Left out of the scaled timings (${usable} of ${reports.length} runs kept):`, ...leftOut.map((s) => `- ${s}`)] : []),
  ...(partial.length ? ["", "Left out of one timing:", ...partial.map((s) => `- ${s}`)] : []),
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
