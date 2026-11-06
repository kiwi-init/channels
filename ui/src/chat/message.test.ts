import { describe, expect, test } from "bun:test"

import { sameRow } from "~/chat/message"
import type { Channel, Message, Task } from "~/model"
import { wrote } from "~/words"

const task = (title: string): Task => ({ id: 1, title: wrote(title), status: "doing", createdBy: "jow", createdAt: 0, updatedAt: 0, notes: [], rounds: [], history: [], archived: false })

const channel = (title: string): Channel =>
  ({
    code: "c",
    title: "c",
    youOwn: true,
    you: "jow",
    repos: [],
    rooms: [],
    directs: [],
    theirs: [],
    people: [],
    nicknames: new Map(),
    messages: [],
    tasks: [task(title)],
    asks: [],
    connection: "live",
  }) as unknown as Channel

const m: Message = { seq: 1, from: "jow", at: 0, text: wrote("on it"), where: { kind: "task", task: 1 }, task: 1 }
const names = new Map<string, string>()
const chips = new Set<number>()
const row = (c: Channel) => ({ channel: c, m, compact: false, names, tasks: chips })

describe("a message row redraws when its task chip changes (#1763)", () => {
  test("renaming the task redraws the row", () => {
    expect(sameRow(row(channel("Export the board")), row(channel("Export the board as CSV")))).toBe(false)
  })

  test("the same task title keeps the row as it is", () => {
    expect(sameRow(row(channel("Export the board")), row(channel("Export the board")))).toBe(true)
  })
})
