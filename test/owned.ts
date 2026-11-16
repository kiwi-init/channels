import { appendFileSync, statSync } from "node:fs";
import { LEDGER_ENV } from "../scripts/ci-owned.ts";

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
