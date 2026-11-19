import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { LEDGER_ENV, ledgerLine, OWNER_ENV } from "../scripts/ci-owned.ts";

const ledger = (): string | undefined => process.env[LEDGER_ENV];

const withLedger = (env: Record<string, string | undefined> | undefined): Record<string, string | undefined> | undefined => {
  const path = ledger();
  const owner = process.env[OWNER_ENV];
  return env && path ? { ...env, [LEDGER_ENV]: path, ...(owner ? { [OWNER_ENV]: owner } : {}) } : env;
};

export function record(pid: number, cmd: readonly string[], group = false, path = ledger()): void {
  if (!path) return;
  appendFileSync(path, ledgerLine(pid, group, cmd));
}

export function spawnOwned<const In extends Bun.SpawnOptions.Writable = "ignore", const Out extends Bun.SpawnOptions.Readable = "pipe", const Err extends Bun.SpawnOptions.Readable = "inherit">(
  cmd: string[],
  options?: Bun.SpawnOptions.SpawnOptions<In, Out, Err>,
): Bun.Subprocess<In, Out, Err> {
  const group = options?.detached ?? true;
  const p = Bun.spawn<In, Out, Err>(cmd, { ...options, detached: group, env: withLedger(options?.env ?? process.env) });
  record(p.pid, cmd, group);
  return p;
}

export function spawnOwnedSync<const In extends Bun.SpawnOptions.Writable = "ignore", const Out extends Bun.SpawnOptions.Readable = "pipe", const Err extends Bun.SpawnOptions.Readable = "pipe">(
  cmd: string[],
  options?: Bun.SpawnOptions.SpawnSyncOptions<In, Out, Err>,
): Bun.SyncSubprocess<Out, Err> {
  const group = options?.detached ?? true;
  const p = Bun.spawnSync<In, Out, Err>(cmd, { ...options, detached: group, env: withLedger(options?.env ?? process.env) });
  record(p.pid, cmd, group);
  return p;
}

export function ledgerSize(path = ledger()): number {
  if (!path) return 0;
  return statSync(path, { throwIfNoEntry: false })?.size ?? 0;
}

export async function pidIn(file: string, ms = 10_000): Promise<number> {
  const end = Date.now() + ms;
  for (;;) {
    const pid = existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
    if (Number.isSafeInteger(pid) && pid > 0) return pid;
    if (Date.now() >= end) throw new Error(`no pid in ${file} after ${ms} ms`);
    await Bun.sleep(20);
  }
}
