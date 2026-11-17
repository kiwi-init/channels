import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type Proc, procOf, procTable } from "../src/daemon/procs.ts";

export const LEDGER_ENV = "KIWI_TEST_SPAWNS";
export const OWNER_ENV = "KIWI_TEST_OWNER";
export const GRACE_MS = 2_000;
const KILLED_MS = 1_000;
const POLL_MS = 50;

type Entry = { pid: number; start: string | null; group: boolean };

export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

export function ledgerLine(pid: number, group: boolean, cmd: readonly string[]): string {
  return `${JSON.stringify({ pid, start: procOf(pid)?.start ?? null, group, cmd: cmd.join(" ") })}\n`;
}

function entries(path: string, from: number): Entry[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8").slice(from);
  } catch {
    // No ledger yet: nothing was started.
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        const e: unknown = JSON.parse(l);
        if (typeof e !== "object" || e === null || !("pid" in e) || !Number.isSafeInteger(e.pid)) return [];
        const start = "start" in e && typeof e.start === "string" ? e.start : null;
        const group = "group" in e && e.group === true;
        return [{ pid: Number(e.pid), start, group }];
      } catch {
        // A line cut short by a kill mid-write names no process we can prove is ours.
        return [];
      }
    });
}

export const ownerFor = (ledger: string, scope: string): string => `${ledger}:${scope}:`;

function environOf(pid: number): string {
  try {
    return `\u0000${readFileSync(`/proc/${pid}/environ`, "utf8")}`;
  } catch {
    // Gone, or not ours to read: not one this run started.
    return "";
  }
}

function marked(table: Map<number, Proc>, owner: string): Set<number> {
  if (process.platform === "linux") return new Set([...table.keys()].filter((pid) => environOf(pid).includes(`\u0000${OWNER_ENV}=${owner}`)));
  const out = spawnSync("ps", ["-E", "-ww", "-A", "-o", "pid=,command="], { encoding: "utf8", timeout: 5_000 }).stdout ?? "";
  return new Set(
    out
      .split("\n")
      .filter((l) => l.includes(` ${OWNER_ENV}=${owner}`))
      .map((l) => Number(/^\s*(\d+)/.exec(l)?.[1]))
      .filter((pid) => table.has(pid)),
  );
}

function owned(roots: Entry[], marker: string | null): Proc[] {
  const table = procTable();
  const keep = new Set<number>();
  for (let p = table.get(process.pid); p && !keep.has(p.pid); p = table.get(p.ppid)) keep.add(p.pid);
  const found = new Map<number, Proc>();
  const add = (p: Proc): void => {
    if (!keep.has(p.pid)) found.set(p.pid, p);
  };
  for (const e of roots) {
    const leader = table.get(e.pid);
    const same = leader !== undefined && e.start !== null && leader.start === e.start;
    if (leader && same) add(leader);
    if (e.group && (same || leader === undefined)) for (const p of table.values()) if (p.pgid === e.pid) add(p);
  }
  if (marker)
    for (const pid of marked(table, marker)) {
      const p = table.get(pid);
      if (p) add(p);
    }
  let grew = found.size > 0;
  while (grew) {
    grew = false;
    for (const p of table.values())
      if (!found.has(p.pid) && !keep.has(p.pid) && found.has(p.ppid)) {
        found.set(p.pid, p);
        grew = true;
      }
  }
  return [...found.values()];
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // It exited between the snapshot and the signal: already stopped.
  }
}

export async function stopOwned(path = process.env[LEDGER_ENV], from = 0, options: { grace?: number; owner?: string; sweep?: boolean } = {}): Promise<number[]> {
  if (!path) return [];
  const roots = entries(path, from);
  const marker = options.owner ?? (options.sweep ? `${path}:` : null);
  if (!roots.length && !marker) return [];
  const termed = new Set<number>();
  const until = Date.now() + (options.grace ?? GRACE_MS);
  for (let live = owned(roots, marker); live.length && Date.now() < until; live = owned(roots, marker)) {
    for (const p of live.filter((p) => !termed.has(p.pid))) {
      signal(p.pid, "SIGTERM");
      termed.add(p.pid);
    }
    await Bun.sleep(POLL_MS);
  }
  const killedBy = Date.now() + KILLED_MS;
  for (let live = owned(roots, marker); live.length && Date.now() < killedBy; live = owned(roots, marker)) {
    for (const p of live) {
      signal(p.pid, "SIGKILL");
      termed.add(p.pid);
    }
    await Bun.sleep(POLL_MS);
  }
  return [...termed];
}

if (import.meta.main) {
  const [cmd, ledger] = Bun.argv.slice(2);
  if (cmd !== "stop" || !ledger) {
    console.error("usage: bun scripts/ci-owned.ts stop LEDGER");
    process.exit(2);
  }
  await stopOwned(ledger, 0, { sweep: true });
}
