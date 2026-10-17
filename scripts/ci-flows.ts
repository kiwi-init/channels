import { Glob } from "bun";

const budget = [...new Glob("test/budget-*.test.ts").scanSync()].map((f) => f.slice("test/".length, -".test.ts".length)).sort();

export const FLOWS: Record<string, string[]> = {
  "flows-a": ["e2e", "verbs", "threads", "reconnect", ...budget],
  "flows-b": ["join-seats", "read-receipts", "daemon-pair", "sh-escape", "coordinator-follows", "reclaim", "wake-yourself", "seats", "multi-seat", "handoff"],
};
