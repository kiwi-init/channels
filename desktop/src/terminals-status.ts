import { readTerminalsStatus, type TerminalsStatus } from "@kiwi/core/terminals.ts";

export function terminalsOf(stdout: string): TerminalsStatus | null {
  try {
    return readTerminalsStatus(JSON.parse(stdout) as unknown);
  } catch {
    // Not the one JSON object kiwi terminal status --json writes: show no New agents group rather than guess.
    return null;
  }
}
