import { Glob } from "bun";

const budget = [...new Glob("test/budget-*.test.ts").scanSync()].map((f) => f.slice("test/".length, -".test.ts".length)).sort();

export const FLOWS: Record<string, string[]> = {
  "flows-a": ["e2e", "verbs", "threads", "reconnect", "cache-trim", ...budget],
  "flows-b": [
    "join-seats",
    "read-receipts",
    "daemon-pair",
    "sh-escape",
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
  ],
};
