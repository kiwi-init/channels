import { SNAPSHOT_EVERY } from "@kiwi/core/protocol.ts";

export function nextSnapshotTry(head: number, at: number): number {
  return at + SNAPSHOT_EVERY > head ? at + SNAPSHOT_EVERY : head + SNAPSHOT_EVERY;
}
