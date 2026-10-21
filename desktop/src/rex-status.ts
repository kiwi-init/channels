import { readRexStatus, REX_UNKNOWN, type RexStatus } from "@kiwi/core/terminals.ts";

export function rexStatusOf(stdout: string): RexStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // Not the one JSON object kiwi rex status --json writes: show nothing rather than guess.
    return REX_UNKNOWN;
  }
  return readRexStatus(parsed);
}
