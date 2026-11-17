import { existsSync, readFileSync } from "node:fs";
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
  source?: "feel" | "desktop-eb";
}

type Range = [number, number];

interface Budgets {
  reference: Record<Speed, number>;
  calibration: Record<Speed | "ratio", Range>;
  limits: Record<string, Limit>;
}

const { reference, calibration: bounds, limits } = JSON.parse(readFileSync(resolve(import.meta.dir, "perf-budgets.json"), "utf8")) as Budgets;
const isFeel = (r: Record<string, unknown>) => "rttMs" in r;

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

export function perfCheck(runs: readonly string[], nightly = false): { code: 0 | 1; text: string } {
  const read = runs.map((f) => ({ file: f, report: JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown> }));
  const feels = read.filter((r) => isFeel(r.report)).map((r) => r.report);
  const scaleRuns = read.filter((r) => !isFeel(r.report));
  const files = scaleRuns.map((r) => r.file);
  const reports = scaleRuns.map((r) => r.report);
  const calibrations = (["@1x", "@4x"] as const).map((s) => {
    const seen = reports.map((r) => pick(r, [s, "calibrationMs"])).filter((v): v is number => v !== null);
    return `${s} ${seen.length ? seen.join(", ") : "none"} ms (reference ${reference[s]})`;
  });

  const calibrated = reports.map(calibrationOf);
  const leftOut = calibrated.flatMap((c, i) => (typeof c === "string" ? [`${basename(files[i]!)}: ${c}`] : []));
  const usable = calibrated.length - leftOut.length;
  const needed = Math.min(2, reports.length);

  const rows: string[] = [];
  const over: string[] = [];
  const short: string[] = [];
  const partial: string[] = [];
  for (const [name, l] of Object.entries(limits)) {
    if ((l.nightly && !nightly) || l.source === "desktop-eb") continue;
    if (l.source === "feel") {
      if (!feels.length) continue;
      const seen = feels.map((r) => pick(r, l.at)).filter((v): v is number => v !== null);
      if (!seen.length) {
        over.push(`${l.what}: not measured (${feels.length} perf-feel run${feels.length === 1 ? "" : "s"})`);
        rows.push(`| ${l.what} | not measured | | ${l.gate ?? "none yet"} | ${l.budget} |`);
        continue;
      }
      const m = Math.round(median(seen) * 1000) / 1000;
      rows.push(`| ${l.what} | ${m} | | ${l.gate ?? "none yet"} | ${l.budget} |`);
      if (l.gate !== null && m > l.gate) over.push(`${l.what}: ${m}, over its gate ${l.gate} (${name})`);
      if (l.gate === null || l.gate > l.budget) short.push(`${l.what}: gate ${l.gate ?? "none"}, 0.20 budget ${l.budget}`);
      continue;
    }
    const measured = reports.map((r) => pick(r, l.at)).filter((v): v is number => v !== null);
    const each = reports.map((r, i) => scaled(r, l, calibrated[i]!));
    for (const [i, v] of each.entries()) if (v === null && typeof calibrated[i] !== "string") partial.push(`${l.what}: ${basename(files[i]!)} has no usable value`);
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
    `**perf-scale, median of ${reports.length} run${reports.length === 1 ? "" : "s"}${nightly ? " with the soak" : ""}${feels.length ? `; perf-feel, median of ${feels.length}` : ""}**`,
    "",
    `Timings are scaled to the reference runner by each run's CPU calibration before the gates: ${calibrations.join("; ")}.${feels.length ? " perf-feel's rows aren't: they wait mostly on the relay's round trip, or count layout shift and screens." : ""}`,
    "",
    "| What | Measured | Scaled | Gate | 0.20 budget |",
    "|---|---|---|---|---|",
    ...rows,
    ...(leftOut.length ? ["", `Left out of the scaled timings (${usable} of ${reports.length} runs kept):`, ...leftOut.map((s) => `- ${s}`)] : []),
    ...(partial.length ? ["", "Left out of one timing:", ...partial.map((s) => `- ${s}`)] : []),
    ...(short.length ? ["", `Not yet at the 0.20 budget (${short.length}):`, ...short.map((s) => `- ${s}`)] : []),
    ...(over.length ? ["", "Over a gate:", ...over.map((s) => `- ${s}`)] : []),
  ];
  return { code: over.length ? 1 : 0, text: lines.join("\n") };
}

export const REGRESSION = { ratio: 1.15, ms: 10 } as const;
const PAIRED_RUNS = 4;
const PAIRED_USABLE = 3;
type Side = "base" | "head";
const SIDES: readonly Side[] = ["base", "head"];

export function pairedCheck(runs: readonly string[], failedRuns: readonly string[] = []): { code: 0 | 1; text: string } {
  const problems: string[] = failedRuns.map((r) => `${r}: the run failed, so no verdict can rest on it`);
  const sides: Record<Side, { file: string; report: Record<string, unknown>; calibration: Record<Speed, number> | string }[]> = { base: [], head: [] };
  for (const file of runs) {
    const report = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const control = report.control;
    const named = /-(base|head)\.json$/.exec(basename(file))?.[1];
    if ((control !== "base" && control !== "head") || control !== named) {
      problems.push(`${basename(file)}: its control is ${String(control)}, its name says ${named ?? "nothing"}`);
      continue;
    }
    sides[control].push({ file, report, calibration: calibrationOf(report) });
  }
  const apps: Record<Side, string[]> = { base: [], head: [] };
  for (const side of SIDES) {
    if (sides[side].length !== PAIRED_RUNS) problems.push(`${side}: ${sides[side].length} reports, ${PAIRED_RUNS} expected`);
    apps[side] = [...new Set(sides[side].map((r) => String(r.report.app ?? "unknown")))];
    if (apps[side].length !== 1 || apps[side][0] === "unknown") problems.push(`${side}: the app commit is ${apps[side].join(", ") || "missing"}, one expected`);
  }
  if (apps.base.length === 1 && apps.base[0] === apps.head[0]) problems.push(`base and head ran the same app commit ${apps.base[0]}`);

  const rows: string[] = [];
  const failures: string[] = [];
  const exempt: string[] = [];
  for (const [name, l] of Object.entries(limits)) {
    if (l.nightly || l.source) continue;
    const median_: Partial<Record<Side, number>> = {};
    for (const side of SIDES) {
      const seen = sides[side].map((r) => scaled(r.report, l, r.calibration)).filter((v): v is number => v !== null);
      if (seen.length >= PAIRED_USABLE) median_[side] = round(median(seen));
      else failures.push(`${l.what}: ${side} has ${seen.length} usable runs, ${PAIRED_USABLE} needed (${name})`);
    }
    const { base, head } = median_;
    if (base === undefined || head === undefined) {
      rows.push(`| ${l.what} | ${base ?? "not measured"} | ${head ?? "not measured"} | | ${l.gate ?? "none yet"} | not measured |`);
      continue;
    }
    const regressed = head > base * REGRESSION.ratio && head - base > REGRESSION.ms;
    const headOver = l.gate !== null && head > l.gate;
    const baseOver = l.gate !== null && base > l.gate;
    const change = `${head - base >= 0 ? "+" : ""}${round(head - base)} ms (${base > 0 ? `${head >= base ? "+" : ""}${Math.round(((head - base) / base) * 100)}%` : "n/a"})`;
    let verdict: string;
    if (regressed) {
      verdict = "regression";
      failures.push(`${l.what}: ${head} against the base's ${base}, more than ${Math.round((REGRESSION.ratio - 1) * 100)}% and ${REGRESSION.ms} ms slower (${name})`);
    } else if (headOver && baseOver) {
      verdict = "over its gate, exempt: the base is over it too";
      exempt.push(`${l.what}: ${head}, over its gate ${l.gate}; the base is over it too (${base}) and this change isn't a regression (${name})`);
    } else if (headOver) {
      verdict = "over its gate";
      failures.push(`${l.what}: ${head}, over its gate ${l.gate}, which the base meets (${base}) (${name})`);
    } else verdict = "ok";
    rows.push(`| ${l.what} | ${base} | ${head} | ${change} | ${l.gate ?? "none yet"} | ${verdict} |`);
  }
  const calibrations = SIDES.map(
    (side) => `${side} ${sides[side].map((r) => (typeof r.calibration === "string" ? "left out" : `${r.calibration["@1x"]}/${r.calibration["@4x"]}`)).join(", ") || "none"}`,
  );
  const leftOut = SIDES.flatMap((side) => sides[side].flatMap((r) => (typeof r.calibration === "string" ? [`${basename(r.file)}: ${r.calibration}`] : [])));
  const failed = problems.length + failures.length > 0;
  const lines = [
    `**perf-scale, paired on one runner: head ${apps.head.join(", ") || "?"} against its merge base ${apps.base.join(", ") || "?"}, ${PAIRED_RUNS} alternating runs each**`,
    "",
    `Each side is the median of its runs, scaled as the gates are. A regression is more than ${Math.round((REGRESSION.ratio - 1) * 100)}% and more than ${REGRESSION.ms} ms slower than the base. A gate the base also misses doesn't fail a head that isn't a regression. Calibrations @1x/@4x ms: ${calibrations.join("; ")}.`,
    "",
    "| What | Base | Head | Change | Gate | Verdict |",
    "|---|---|---|---|---|---|",
    ...rows,
    ...(leftOut.length ? ["", "Left out of the scaled timings:", ...leftOut.map((s) => `- ${s}`)] : []),
    ...(exempt.length ? ["", "Over a gate the base also misses (not a failure):", ...exempt.map((s) => `- ${s}`)] : []),
    ...(problems.length ? ["", "The pair can't be judged:", ...problems.map((s) => `- ${s}`)] : []),
    ...(failures.length ? ["", "Failed:", ...failures.map((s) => `- ${s}`)] : []),
  ];
  return { code: failed ? 1 : 0, text: lines.join("\n") };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const runs = args.filter((a) => !a.startsWith("--"));
  if (!runs.length) {
    console.error("usage: bun scripts/perf-check.ts [--nightly] run1.json [run2.json ...] [feel1.json ...] | --paired [--failed=list.txt] perf-pair-*.json");
    process.exit(2);
  }
  if (args.includes("--paired")) {
    const list = args.find((a) => a.startsWith("--failed="))?.slice("--failed=".length);
    const failedRuns = list && existsSync(list) ? readFileSync(list, "utf8").split("\n").filter(Boolean) : [];
    const { code, text } = pairedCheck(runs, failedRuns);
    console.log(text);
    process.exit(code);
  }
  const { code, text } = perfCheck(runs, args.includes("--nightly"));
  console.log(text);
  process.exit(code);
}
