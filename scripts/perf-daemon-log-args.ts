import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface BenchArgs {
  work: string;
  seats: number;
  perCycle: number;
  cycles: number;
  rate: number;
  settleMs: number;
  body: number;
}

const valueOf = (argv: readonly string[], name: string): string | null | undefined => {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  return value === undefined || value === "" || value.startsWith("--") ? null : value;
};

export function benchArgs(argv: readonly string[]): BenchArgs | { why: string } {
  const work = valueOf(argv, "work");
  if (work === undefined) return { why: "--work DIR is required: a new directory for this run's relay data and kiwi home" };
  if (work === null) return { why: "--work needs a directory after it" };
  const numbers: [keyof Omit<BenchArgs, "work">, string, number][] = [
    ["seats", "seats", 8],
    ["perCycle", "per-cycle", 300],
    ["cycles", "cycles", 4],
    ["rate", "rate", 20],
    ["settleMs", "settle", 10_000],
    ["body", "body", 1500],
  ];
  const out: BenchArgs = { work: resolve(work), seats: 0, perCycle: 0, cycles: 0, rate: 0, settleMs: 0, body: 0 };
  for (const [key, name, fallback] of numbers) {
    const raw = valueOf(argv, name);
    if (raw === null) return { why: `--${name} needs a number after it` };
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(n) || n < (key === "settleMs" ? 0 : 1)) return { why: `--${name} must be a whole number${key === "settleMs" ? "" : " above 0"}, not ${raw}` };
    out[key] = n;
  }
  return out;
}

export function claimWork(dir: string): string | null {
  try {
    mkdirSync(dir);
    return null;
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EEXIST"
      ? `${dir} already exists: give a new directory, so nothing of yours is overwritten`
      : `can't make ${dir}: ${err instanceof Error ? err.message : String(err)}`;
  }
}
