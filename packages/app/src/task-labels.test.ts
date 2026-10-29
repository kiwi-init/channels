import { expect, test } from "bun:test";

import { fold, type Task } from "@kiwi/core/state.ts";

import { labelOf, STATE_LABEL, stateWord } from "./task-labels";

const state = fold([], [], 0);
const task = (over: Partial<Task>): Task => ({ id: 1, title: "t", state: "todo", createdBy: "a", createdAt: 0, updatedAt: 0, notes: [], workedBy: [], rounds: [], ...over });

test("a task reads by its status, the same on the board, the cards and the details; the board's groups keep their names", () => {
  expect(STATE_LABEL).toEqual({ todo: "Up next", doing: "In progress", review: "In review", done: "Done" });
  expect(labelOf(state, task({}))).toBe("Planned");
  expect(stateWord(state, task({ state: "doing", owner: "a" }))).toBe("working");
  expect(stateWord(state, task({ state: "review", owner: "a" }))).toBe("working");
  expect(labelOf(state, task({ state: "done" }))).toBe("Done");
  expect(labelOf(state, task({ state: "done", cancelled: true }))).toBe("Cancelled");
});
