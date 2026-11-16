import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export type Proc = { pid: number; ppid: number; pgid: number; start: string };

function fromStat(pid: number, stat: string): Proc | null {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const [ppid, pgid, start] = [Number(fields[1]), Number(fields[2]), fields[19]];
  return Number.isSafeInteger(ppid) && Number.isSafeInteger(pgid) && start ? { pid, ppid, pgid, start } : null;
}

function fromPs(line: string): Proc | null {
  const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
  return m?.[4] ? { pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), start: m[4] } : null;
}

function ps(args: string[]): string {
  return spawnSync("ps", args, { encoding: "utf8", timeout: 2_000 }).stdout ?? "";
}

export function procOf(pid: number): Proc | null {
  try {
    if (process.platform === "linux") return fromStat(pid, readFileSync(`/proc/${pid}/stat`, "utf8"));
    return fromPs(ps(["-o", "pid=,ppid=,pgid=,lstart=", "-p", String(pid)]));
  } catch {
    // Gone, or not ours to read: no identity, so never one to signal.
    return null;
  }
}

export function procTable(): Map<number, Proc> {
  const table = new Map<number, Proc>();
  const procs =
    process.platform === "linux"
      ? readdirSync("/proc")
          .filter((p) => /^\d+$/.test(p))
          .map((p) => procOf(Number(p)))
      : ps(["-A", "-o", "pid=,ppid=,pgid=,lstart="]).split("\n").map(fromPs);
  for (const proc of procs) if (proc) table.set(proc.pid, proc);
  return table;
}
