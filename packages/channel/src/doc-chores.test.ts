import { describe, expect, test } from "bun:test";
import type { DocStat } from "@kiwi/core/client.ts";
import { DOC_PRUNE_IDLE_MS, type TaskState } from "@kiwi/core/protocol.ts";
import type { Task } from "@kiwi/core/state.ts";
import { DOC_COMPACT_IDLE_MS, planDocs } from "./doc-chores.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const task = (id: number, state: TaskState, cancelled = false): Task => ({
  id,
  title: `t${id}`,
  state,
  createdBy: "a",
  createdAt: 0,
  updatedAt: 0,
  notes: [],
  workedBy: [],
  rounds: [],
  ...(cancelled ? { cancelled } : {}),
});
const stat = (th: string, idleFor: number, n = 3): DocStat => ({ th, bytes: 100, n, upto: 0, last: NOW - idleFor });

describe("the owner's doc upkeep plan (T1430)", () => {
  const docs = new Map([
    ["main", "main0000000000000000aa"],
    ["task:1", "task1000000000000000aa"],
    ["task:2", "task2000000000000000aa"],
    ["task:3", "task3000000000000000aa"],
    ["task:4", "task4000000000000000aa"],
  ]);
  const tasks = new Map([
    [1, task(1, "done")],
    [2, task(2, "doing")],
    [3, task(3, "todo", true)],
    [4, task(4, "done")],
  ]);

  test("a doc id the channel doesn't map is pruned once idle for a week, never sooner, and never a mapped one", () => {
    const plan = planDocs([stat("strayold000000000000aa", DOC_PRUNE_IDLE_MS), stat("straynew000000000000aa", DOC_PRUNE_IDLE_MS - 1), stat("main0000000000000000aa", 30 * DAY)], { docs, tasks }, NOW);
    expect(plan.prune).toEqual(["strayold000000000000aa"]);
  });

  test("a done or cancelled task's doc with a log is compacted once idle a day; open tasks, fresh edits and bare snapshots are left alone", () => {
    const plan = planDocs(
      [
        stat("task1000000000000000aa", DOC_COMPACT_IDLE_MS),
        stat("task2000000000000000aa", 30 * DAY),
        stat("task3000000000000000aa", 2 * DAY),
        stat("task4000000000000000aa", DOC_COMPACT_IDLE_MS - 1),
        stat("main0000000000000000aa", 30 * DAY),
      ],
      { docs, tasks },
      NOW,
    );
    expect(plan.compact).toEqual([
      ["task:1", "task1000000000000000aa"],
      ["task:3", "task3000000000000000aa"],
    ]);
    expect(planDocs([stat("task1000000000000000aa", 2 * DAY, 0)], { docs, tasks }, NOW).compact).toEqual([]);
    expect(planDocs([], { docs, tasks }, NOW)).toEqual({ prune: [], compact: [] });
  });
});
