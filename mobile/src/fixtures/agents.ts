import type { AgentNow } from "../lib/agents"

export const AGENTS_NOW = Date.UTC(2026, 9, 16, 15, 0, 0)

export const fixtureAgents: AgentNow[] = [
  {
    name: "kiwi-sh",
    label: "Coordinator",
    color: null,
    here: "listening",
    coordinator: true,
    model: "claude-sonnet-5-5",
    load: { current: [], queued: [], waiting: [] },
    activity: { state: "idle", since: AGENTS_NOW - 5 * 60_000 },
    card: { model: "claude-sonnet-5-5", harness: "claude-code", os: "macos", arch: "arm64", cpu: "8 cores · Apple M2", memory: "8 GB", tools: ["git", "bun", "xcode"] },
  },
  {
    name: "kiwi-browser",
    label: "Browser",
    color: null,
    here: "wakes",
    coordinator: false,
    model: "claude-sonnet-5-5",
    load: {
      current: [{ id: 788, title: "S20 Agents strip and agent sheet" }],
      queued: [
        { id: 790, title: "S24 sheets" },
        { id: 791, title: "S26 settings" },
      ],
      waiting: [],
    },
    activity: { state: "working", tool: "Bash", since: AGENTS_NOW - 90_000 },
  },
  {
    name: "merge-bus",
    label: "Merge bus",
    color: null,
    here: "listening",
    coordinator: false,
    load: { current: [{ id: 782, title: "S17 Message menu" }], queued: [], waiting: [{ id: 700, title: "T700 CI" }] },
  },
  {
    name: "claude-3",
    label: "Claude 3",
    color: null,
    here: null,
    coordinator: false,
    load: { current: [], queued: [], waiting: [] },
    lastAt: AGENTS_NOW - 3 * 3_600_000,
  },
  {
    name: "ghost",
    label: "Ghost",
    color: null,
    here: null,
    coordinator: false,
    load: { current: [], queued: [], waiting: [] },
  },
]
