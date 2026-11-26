export type Group = "web" | "network" | "shell" | "daemon" | "other";
export const GROUPS: readonly Group[] = ["web", "network", "shell", "daemon", "other"];

export interface ProcRead {
  pid: number;
  started: string;
  kb: number | null;
}

export interface Sample {
  at: string;
  phase: "live" | "idle";
  procs: Record<Group, ProcRead[]>;
  pss: Record<Group, number | null>;
  valid: boolean;
  problems: string[];
}

const mib = (kb: number) => Math.round(kb / 1024);

export function sampleOf(at: string, phase: Sample["phase"], reads: Partial<Record<Group, ProcRead[]>>): Sample {
  const procs = Object.fromEntries(GROUPS.map((g) => [g, [...(reads[g] ?? [])].sort((a, b) => a.pid - b.pid)])) as Record<Group, ProcRead[]>;
  const problems: string[] = [];
  if (!procs.web.length) problems.push("web: no WebKitWebProcess");
  for (const g of GROUPS) for (const r of procs[g]) if (r.kb === null) problems.push(`${g} ${r.pid}: smaps_rollup could not be read`);
  const pss = Object.fromEntries(GROUPS.map((g) => [g, procs[g].some((r) => r.kb === null) || (g === "web" && !procs.web.length) ? null : mib(procs[g].reduce((s, r) => s + r.kb!, 0))])) as Record<
    Group,
    number | null
  >;
  return { at, phase, procs, pss, valid: !problems.length, problems };
}

export const identity = (reads: readonly ProcRead[]): string => reads.map((r) => `${r.pid}@${r.started}`).join(" ");

export function changes(prev: Sample, next: Sample): string[] {
  return GROUPS.flatMap((g) => (identity(prev.procs[g]) === identity(next.procs[g]) ? [] : [`${next.at} ${g}: [${identity(prev.procs[g])}] became [${identity(next.procs[g])}]`]));
}

export function webDrops(samples: readonly Sample[], minMiB = 300): { at: string; from: number; to: number }[] {
  return samples.flatMap((s, i) => {
    const before = samples[i - 1];
    if (!before?.valid || !s.valid || identity(before.procs.web) !== identity(s.procs.web)) return [];
    const from = before.pss.web!;
    const to = s.pss.web!;
    return from - to >= minMiB ? [{ at: s.at, from, to }] : [];
  });
}

export function stats(xs: readonly number[]): { min: number; median: number; max: number } | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return { min: s[0]!, median: s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2), max: s.at(-1)! };
}

export interface Settings {
  agents: number;
  warmMin: number;
  liveMin: number;
  idleMin: number;
  everySec: number;
  messageSec: number;
  seed: { tasks: number; messages: number; taskNotes: number };
  liveSamples: number;
  totalSamples: number;
}

export function settings(env: Record<string, string | undefined>, base: Settings["seed"]): Settings {
  const errors: string[] = [];
  const RULES = {
    positive: { ok: (n: number) => n > 0, says: "a number above 0" },
    "positive integer": { ok: (n: number) => n > 0 && Number.isInteger(n), says: "a whole number above 0" },
    "zero or more": { ok: (n: number) => n >= 0, says: "a number, 0 or more" },
    "integer, zero or more": { ok: (n: number) => n >= 0 && Number.isInteger(n), says: "a whole number, 0 or more" },
  };
  const read = (name: string, fallback: number, rule: keyof typeof RULES): number => {
    const raw = env[name];
    const n = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isFinite(n) || !RULES[rule].ok(n)) errors.push(`${name} must be ${RULES[rule].says}, not ${JSON.stringify(raw)}`);
    return n;
  };
  const agents = read("PERF_AGENTS", 10, "positive integer");
  const warmMin = read("PSS_WARM_MIN", 5, "zero or more");
  const liveMin = read("PSS_LIVE_MIN", 40, "zero or more");
  const idleMin = read("PSS_IDLE_MIN", 10, "zero or more");
  const everySec = read("PSS_EVERY_SEC", 30, "positive");
  const messageSec = read("PSS_MESSAGE_SEC", 6, "positive");
  const seed = {
    tasks: read("PERF_TASKS", base.tasks, "integer, zero or more"),
    messages: read("PERF_MESSAGES", base.messages, "integer, zero or more"),
    taskNotes: read("PERF_TASK_NOTES", base.taskNotes, "integer, zero or more"),
  };
  const liveSamples = Math.round((liveMin * 60) / everySec);
  const totalSamples = Math.round(((liveMin + idleMin) * 60) / everySec);
  if (!errors.length && totalSamples < 2) errors.push(`PSS_LIVE_MIN and PSS_IDLE_MIN at PSS_EVERY_SEC=${everySec} give ${totalSamples} samples: at least 2 are needed`);
  if (errors.length) throw new Error(errors.join("\n"));
  return { agents, warmMin, liveMin, idleMin, everySec, messageSec, seed, liveSamples, totalSamples };
}
