import { describe, expect, test } from "bun:test";

import { fold, type AskHead, type ChannelState, type GithubPr, type GithubRelease, type Task } from "@kiwi/core/state.ts";

import { NEXT_RELEASE_NOTE, taskGroups } from "./views";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 18, 15);

const task = (id: number, state: Task["state"], updatedAt = NOW, extra: Partial<Task> = {}): Task => ({
  id,
  title: `t${id}`,
  state,
  createdBy: "jon",
  createdAt: 0,
  updatedAt,
  notes: [],
  workedBy: [],
  rounds: [],
  ...extra,
});

const board = (tasks: Task[], extra: Partial<ChannelState> = {}): ChannelState => ({ ...fold([], [], NOW), tasks: new Map(tasks.map((t) => [t.id, t])), ...extra });

describe("the sidebar's views", () => {
  test("the board groups by the person's message each task serves: latest-moving ask first, unfiled last, in progress first within each", () => {
    const tasks = [
      task(1, "doing", NOW - 5, { ask: 10 }),
      task(2, "review", NOW - 1, { ask: 20 }),
      task(3, "todo", NOW - 9, { ask: 10 }),
      task(4, "done", NOW - 60_000, { ask: 10 }),
      task(5, "done", NOW - 2 * DAY, { ask: 20 }),
      task(6, "todo", NOW),
      task(7, "review", NOW - 7, { ask: 10 }),
      task(8, "done", NOW - 9 * DAY, { ask: 30 }),
    ];
    const head = (id: number, words: string): AskHead => ({ id, by: "jon", words, at: 0 });
    const askHeads = new Map([head(10, "ship v2"), head(20, "fix the board"), head(30, "old")].map((h) => [h.id, h]));
    const state = board(tasks, { askHeads });
    const ids = (view: Parameters<typeof taskGroups>[1]) => taskGroups(state, view, NOW).map((g) => [g.head.kind === "ask" ? (g.head.ask?.id ?? null) : g.key, g.tasks.map((t) => t.id)]);
    expect(ids("everything")).toEqual([
      [20, [2, 5]],
      [10, [1, 7, 3, 4]],
      [null, [6]],
    ]);
    expect(ids("review")).toEqual([
      [20, [2]],
      [10, [7]],
    ]);
    expect(ids("done")).toEqual([
      [10, [4]],
      [20, [5]],
    ]);
    expect(ids("needs")).toEqual([]);
  });

  test("with releases known, open work stays under its ask and finished work groups by release: next (named by the release.next note), each release newest first, cancelled last", () => {
    const pr = (number: number, branch: string, state: GithubPr["state"], at: number): GithubPr => ({ repo: "o/r", number, branch, state, at, seq: number });
    const release = (tag: string, at: number, prs: number[]): GithubRelease => ({ repo: "o/r", tag, at, shas: [], prs, seq: at });
    const askHeads = new Map([[10, { id: 10, by: "jon", words: "ship v2", at: 0 }]]);
    const state = board(
      [
        task(1, "doing", NOW, { ask: 10 }),
        task(2, "doing", NOW - 5, { ask: 10 }),
        task(3, "done", NOW - DAY, { ask: 10 }),
        task(4, "done", NOW - 2 * DAY, { ask: 10 }),
        task(5, "done", NOW - 3, { cancelled: true }),
        task(6, "done", NOW - 9 * DAY),
      ],
      {
        askHeads,
        branchPrefix: "T",
        facts: new Map([[NEXT_RELEASE_NOTE, { key: NEXT_RELEASE_NOTE, value: "2026.10.0", by: "lead", ts: NOW, seq: 1 }]]),
        github: {
          prs: new Map(
            [pr(11, "T1-a", "open", NOW), pr(12, "T2-b", "merged", NOW - 10), pr(13, "T3-c", "merged", NOW - DAY), pr(14, "T4", "merged", NOW - 2 * DAY)].map((p) => [`o/r#${p.number}`, p]),
          ),
          checks: new Map(),
          issues: new Map(),
          rules: new Map(),
          releases: new Map([["o/r", [release("v1", NOW - 2 * DAY, [14]), release("v2", NOW - DAY, [13])]]]),
          runs: new Map(),
          runsSince: null,
          runsForgotten: null,
        },
      },
    );
    const groups = taskGroups(state, "everything", NOW);
    expect(groups.map((g) => [g.head, g.tasks.map((t) => t.id)])).toEqual([
      [{ kind: "ask", ask: askHeads.get(10)! }, [1]],
      [{ kind: "next", name: "2026.10.0" }, [2]],
      [{ kind: "release", tag: "v2", at: NOW - DAY }, [3]],
      [{ kind: "release", tag: "v1", at: NOW - 2 * DAY }, [4]],
      [{ kind: "cancelled" }, [5]],
    ]);
    expect(taskGroups(state, "doing", NOW).flatMap((g) => g.tasks.map((t) => t.id))).toEqual([1]);
    expect(taskGroups({ ...state, facts: new Map() }, "done", NOW)[0]?.head).toEqual({ kind: "next", name: null });
  });
});
