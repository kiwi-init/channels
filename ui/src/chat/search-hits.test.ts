import { describe, expect, test } from "bun:test"

import { hitKey, hitText, messageIndex, searchHits, whereLabel } from "~/chat/search-hits"
import type { Message, Task } from "~/model"

const general = { kind: "room", room: "general" } as const
const msg = (seq: number, text: string, extra: Partial<Message> = {}): Message => ({ seq, from: "atlas", at: seq * 1000, text, where: general, ...extra })
const task = (id: number, title: string, extra: Partial<Task> = {}): Task => ({
  id,
  title,
  status: "doing",
  createdBy: "jow",
  createdAt: 0,
  updatedAt: id,
  notes: [],
  history: [],
  rounds: [],
  archived: false,
  ...extra,
})

const channel = {
  rooms: [{ id: "general", name: "general", unread: 0, mentions: 0 }],
  nicknames: new Map([
    ["atlas", "Atlas"],
    ["maya", "Maya Lin"],
  ]),
  messages: [
    msg(1, "deploy the relay to staging"),
    msg(2, "lunch plans", { from: "maya" }),
    msg(3, "the relay deploy failed", { where: { kind: "dm", with: "maya" } }),
    msg(4, "relay joined", { system: true }),
    msg(5, "relay retry", { pending: true }),
    msg(6, "relay notes in the task", { where: { kind: "task", task: 7 } }),
  ],
}
const tasks = [task(7, "Fix the relay deploy"), task(13, "Cancel stuck tasks"), task(21, "Old relay cleanup", { archived: true, updatedAt: 99 })]
const index = messageIndex(channel)
const keys = (query: string) => searchHits(tasks, index, query).map(hitKey)

describe("channel search", () => {
  test("lists matching tasks first, then messages from every room, DM and task thread", () => {
    expect(keys("relay").slice(0, 2)).toEqual(["task-7", "task-21"])
    expect(
      keys("relay")
        .filter((k) => k.startsWith("message"))
        .sort()
    ).toEqual(["message-1", "message-3", "message-6"])
  })

  test("leaves out system lines and messages still being sent", () => {
    expect(keys("joined")).toEqual([])
    expect(keys("retry")).toEqual([])
  })

  test("a task number finds that task alone among tasks", () => {
    for (const query of ["T13", "t13", "13"]) expect(keys(query).filter((k) => k.startsWith("task"))).toEqual(["task-13"])
  })

  test("finds a message by its author's nickname", () => {
    expect(keys("maya lunch")).toEqual(["message-2"])
  })

  test("an archived task ranks after every live one, even a weaker match", () => {
    expect(keys("relay").slice(0, 2)).toEqual(["task-7", "task-21"])
  })

  test("an empty or punctuation-only query lists nothing", () => {
    expect(keys("")).toEqual([])
    expect(keys(" ?! ")).toEqual([])
  })

  test("a result shows Markdown as plain text, unless the match sits only in a table or code block", () => {
    expect(hitText("**Bundle is down** to `374 KB`", ["bundle"])).toBe("Bundle is down to 374 KB")
    expect(hitText("Sizes:\n| chunk | bundle |\n|---|---|", ["bundle"])).toContain("bundle")
  })

  test("names where a message lives", () => {
    expect(whereLabel(channel, general)).toBe("# general")
    expect(whereLabel(channel, { kind: "dm", with: "maya" })).toBe("@ Maya Lin")
    expect(whereLabel(channel, { kind: "task", task: 7 })).toBe("T7")
  })
})
