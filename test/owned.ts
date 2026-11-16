import { appendFileSync, readFileSync, statSync } from "node:fs";
import { commandOf, running } from "../src/daemon/lock.ts";

export const LEDGER_ENV = "KIWI_TEST_SPAWNS";
export const GRACE_MS = 2_000;
const KILLED_MS = 1_000;

type Entry = { pid: number; cmd: string };

const ledger = (): string | undefined => process.env[LEDGER_ENV];

const withLedger = (env: Record<string, string | undefined> | undefined): Record<string, string | undefined> | undefined => {
  const path = ledger();
  return env && path ? { ...env, [LEDGER_ENV]: path } : env;
};

export function record(pid: number, cmd: readonly string[], path = ledger()): void {
  if (!path) return;
  appendFileSync(path, `${JSON.stringify({ pid, cmd: cmd.join(" ") })}\n`);
}

export function spawnOwned<const In extends Bun.SpawnOptions.Writable = "ignore", const Out extends Bun.SpawnOptions.Readable = "pipe", const Err extends Bun.SpawnOptions.Readable = "inherit">(
  cmd: string[],
  options?: Bun.SpawnOptions.SpawnOptions<In, Out, Err>,
): Bun.Subprocess<In, Out, Err> {
  const p = Bun.spawn<In, Out, Err>(cmd, options ? { ...options, env: withLedger(options.env) } : options);
  record(p.pid, cmd);
  return p;
}

export function spawnOwnedSync<const In extends Bun.SpawnOptions.Writable = "ignore", const Out extends Bun.SpawnOptions.Readable = "pipe", const Err extends Bun.SpawnOptions.Readable = "pipe">(
  cmd: string[],
  options?: Bun.SpawnOptions.SpawnSyncOptions<In, Out, Err>,
): Bun.SyncSubprocess<Out, Err> {
  return Bun.spawnSync<In, Out, Err>(cmd, options ? { ...options, env: withLedger(options.env) } : options);
}

export function ledgerSize(path = ledger()): number {
  if (!path) return 0;
  return statSync(path, { throwIfNoEntry: false })?.size ?? 0;
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
        return typeof e === "object" && e !== null && "pid" in e && "cmd" in e && Number.isSafeInteger(e.pid) && typeof e.cmd === "string" ? [{ pid: Number(e.pid), cmd: e.cmd }] : [];
      } catch {
        // A line cut short by a kill mid-write names no process we can prove is ours.
        return [];
      }
    });
}

const shape = (cmd: string): string => {
  const [program = "", ...rest] = cmd.trim().split(/\s+/);
  return [program.split("/").pop() ?? program, ...rest].join(" ");
};

const ours = (e: Entry): boolean => e.pid !== process.pid && running(e.pid) && shape(commandOf(e.pid)) === shape(e.cmd);

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // It exited between the check and the signal: already stopped.
  }
}

export async function stopOwned(path = ledger(), from = 0, grace = GRACE_MS): Promise<number[]> {
  if (!path) return [];
  const live = entries(path, from).filter(ours);
  for (const e of live) signal(e.pid, "SIGTERM");
  const until = Date.now() + grace;
  while (live.some(ours) && Date.now() < until) await Bun.sleep(50);
  const stubborn = live.filter(ours);
  for (const e of stubborn) signal(e.pid, "SIGKILL");
  const killedBy = Date.now() + KILLED_MS;
  while (stubborn.some((e) => running(e.pid)) && Date.now() < killedBy) await Bun.sleep(50);
  return live.map((e) => e.pid);
}
