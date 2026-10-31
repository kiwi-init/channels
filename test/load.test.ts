import { describe, expect, test } from "bun:test";
import { loadJson, loadLine, loadSummary, memberLoad, showsLoad } from "@kiwi/core/load.ts";
import type { ChannelState, Task } from "@kiwi/core/state.ts";
const task = (id: number, owner: string | undefined, state: Task["state"], title = `task ${id}`): Task => ({
  id,
  title,
  state,
  owner,
  createdBy: "x",
  createdAt: 0,
  updatedAt: 0,
  notes: [],
  workedBy: [],
  rounds: [],
});
const board = (tasks: Task[]): ChannelState =>
  ({
    secret: new Map(),
    members: new Map(),
    tasks: new Map(tasks.map((t) => [t.id, t])),
    facts: new Map(),
    leases: new Map(),
    trust: new Map(),
    scopeSets: new Map(),
    roleSets: new Map(),
    rejected: new Map(),
    openAsks: [],
    askHeads: new Map(),
    threadOf: new Map(),
    threadPeople: new Map(),
    lead: null,
    rooms: new Map(),
    roomOf: new Map(),
    placeOf: new Map(),
    places: new Map(),
    charter: null,
    compact: null,
    compactProposal: null,
    repos: [],
    github: { prs: new Map(), checks: new Map(), issues: new Map(), rules: new Map(), releases: new Map() },
    hold: null,
    githubWrite: null,
    branchPrefix: null,
    reactions: new Map(),
    edits: new Map(),
    deleted: new Map(),
    head: 0,
  }) as ChannelState;

describe("member load", () => {
  test("nothing assigned is free; done tasks and other people's don't count", () => {
    const s = board([task(1, "win", "done"), task(2, "mac", "doing"), task(3, undefined, "todo")]);
    const l = memberLoad(s, "win");
    expect(l.level).toBe("free");
    expect(loadLine(l)).toBe("free");
  });

  test("one task in progress, or a queue, is busy", () => {
    expect(memberLoad(board([task(1, "win", "doing")]), "win").level).toBe("busy");
    expect(memberLoad(board([task(1, "win", "todo")]), "win").level).toBe("busy");
  });

  test("two at once, or four on the plate, is overloaded", () => {
    expect(memberLoad(board([task(1, "win", "doing"), task(2, "win", "doing")]), "win").level).toBe("overloaded");
    expect(memberLoad(board([1, 2, 3, 4].map((i) => task(i, "win", i === 1 ? "doing" : "todo"))), "win").level).toBe("overloaded");
  });

  test("tasks in review are shown but aren't load", () => {
    const s = board([task(1, "win", "review"), task(2, "win", "review")]);
    const l = memberLoad(s, "win");
    expect(l.level).toBe("free");
    expect(loadLine(l)).toBe("2 waiting");
  });

  test("the line names the current task; json carries the details", () => {
    const s = board([task(7, "win", "doing", "Fix the login redirect"), task(8, "win", "todo")]);
    const l = memberLoad(s, "win");
    expect(loadLine(l)).toBe("doing T7 Fix the login redirect · 1 queued");
    expect(loadJson(l)).toEqual({ level: "busy", current: [{ id: "T7", title: "Fix the login redirect" }], queued: [{ id: "T8", title: "task 8" }], waiting: [] });
  });

  test("agents always show load; people and owners only when they hold something", () => {
    const free = memberLoad(board([]), "x");
    const busy = memberLoad(board([task(1, "x", "todo")]), "x");
    expect(showsLoad({ kind: "agent" }, free)).toBe(true);
    expect(showsLoad(undefined, free)).toBe(true);
    expect(showsLoad({ kind: "human" }, free)).toBe(false);
    expect(showsLoad({ owner: true }, free)).toBe(false);
    expect(showsLoad({ owner: true }, busy)).toBe(true);
    expect(loadSummary(free)).toBe("free");
    expect(loadSummary(busy)).toBe("busy: 1 queued");
  });
});
