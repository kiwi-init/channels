import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { SeatRecord } from "./config.ts";

type Harness = NonNullable<SeatRecord["harness"]>;

const WOKEN_BY_COMMAND: Partial<Record<Harness, string>> = { codex: "codex", opencode: "opencode" };

export function commandOf(harness: Harness | undefined): string | null {
  return (harness && WOKEN_BY_COMMAND[harness]) ?? null;
}

export function findOnPath(cmd: string, env: Record<string, string | undefined> = process.env): string | null {
  const user = env.HOME || homedir();
  const dirs = [env.PATH ?? "", join(user, ".local", "bin"), join(user, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(delimiter);
  return Bun.which(cmd, { PATH: dirs });
}

export function pinnedFor(record: Pick<SeatRecord, "harness" | "bin">): Pick<SeatRecord, "bin"> {
  if (record.bin) return {};
  const cmd = commandOf(record.harness);
  const bin = cmd ? findOnPath(cmd) : null;
  return bin ? { bin } : {};
}

export function runnable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    // Missing, unreadable or not executable: the pinned binary can't be run.
    return false;
  }
}
