import { describe, expect, test } from "bun:test"

import type { Task } from "@kiwi/core/state.ts"

import { matchingTasks, taskMatches } from "./task-search"

const task = (id: number, title: string, updatedAt = id): Task => ({ id, title, state: "doing", createdBy: "jon", createdAt: 0, updatedAt, notes: [], workedBy: [], rounds: [] })
const tasks = [task(13, "Cancel stuck tasks"), task(22, "Improve task search", 30), task(32, "Close old requests")]

describe("task search", () => {
  test("an id query accepts T13, t13 and 13, and only matches that task", () => {
    for (const query of ["T13", "t13", "13", " 13 "]) expect(matchingTasks(tasks, query).map((t) => t.id)).toEqual([13])
    expect(matchingTasks(tasks, "1")).toEqual([])
  })

  test("a title query matches without regard to case, newest first", () => {
    expect(matchingTasks(tasks, "TASK").map((t) => t.id)).toEqual([22, 13])
    expect(matchingTasks(tasks, "requests").map((t) => t.id)).toEqual([32])
    expect(matchingTasks(tasks, "stuck").map((t) => t.id)).toEqual([13])
  })

  test("a query that matches nothing returns no tasks", () => {
    expect(matchingTasks(tasks, "missing")).toEqual([])
    expect(matchingTasks(tasks, null)).toEqual([])
  })

  test("an empty Tasks view query keeps every task", () => {
    expect(tasks.every((t) => taskMatches(t, null) && taskMatches(t, " "))).toBe(true)
  })
})
