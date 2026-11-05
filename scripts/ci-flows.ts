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
  "reclaim",
  "wake-yourself",
  "wake-tmux",
  "seats",
  "multi-seat",
  "handoff",
  "hooks-once",
  "hooks-hung-relay",
  "offline-read",
  "hooks-reentry",
  "hooks-persona",
  "hooks-agy-answers",
  "mimo-wake-restart",
  "held-seat",
  "loop-flows",
  "daemon-admits",
  "old-room-history",
];

export const MAC: string[] = [
  "desktop-app-life",
  "desktop-eb-bundle",
  "desktop-update-blocked",
  "desktop-update-failures",
  "desktop-update-mac-home",
  "desktop-update-stall",
  "install",
  "wake-tmux",
  "loop-flows",
];
