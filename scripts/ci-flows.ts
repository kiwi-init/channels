import { Glob } from "bun";

const budget = [...new Glob("test/budget-*.test.ts").scanSync()].map((f) => f.slice("test/".length, -".test.ts".length)).sort();

export const FLOWS: string[] = [
  "e2e",
  "verbs",
  "threads",
  "reconnect",
  "cache-trim",
  ...budget,
  "join-seats",
  "join-seats-review",
  "join-seats-hooks",
  "read-receipts",
  "remote-launch-flow",
  "reclaim",
  "wake-yourself",
  "seats",
  "multi-seat",
  "handoff",
  "hooks-once",
  "hooks-hung-relay",
  "offline-read",
  "hooks-reentry",
  "hooks-persona",
  "mimo-wake-restart",
  "held-seat",
  "loop-flows",
  "daemon-admits",
  "private-room-history",
  "private-dms",
  "start-harness",
];
