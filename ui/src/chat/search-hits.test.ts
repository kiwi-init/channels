import { describe, expect, test } from "bun:test"
import { wrote } from "~/words"

import { hitKey, hitText, messageIndex, searchHits, whereLabel } from "~/chat/search-hits"
import type { Message, Task } from "~/model"

const general = { kind: "room", room: "general" } as const
const msg = (seq: number, text: string, extra: Partial<Message> = {}): Message => ({ seq, from: "atlas", at: seq * 1000, text: wrote(text), where: general, ...extra })
const task = (id: number, title: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: wrote(title),
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

  test("tasks come in Jump to's order: where the title matches first, then the most recently touched (T1820)", () => {
    const found = [task(15, "Rotate the relay's signing key", { updatedAt: 10 }), task(17, "Find why the relay drops sockets", { updatedAt: 20 }), task(18, "Relay graphs", { updatedAt: 5 })]
    expect(searchHits(found, index, "relay").slice(0, 3).map(hitKey)).toEqual(["task-18", "task-17", "task-15"])
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

describe("search reads messages the way people see them (#1763)", () => {
  test("a mention is found by the agent's nickname, not its handle", () => {
    const named = messageIndex({ nicknames: new Map([["gentle-otter", "lead"]]), messages: [msg(1, "@gentle-otter take the relay")] })
    expect(searchHits([], named, "lead").map(hitKey)).toEqual(["message-1"])
    expect(searchHits([], named, "gentle").map(hitKey)).toEqual([])
  })
})

describe("the index is built again on every message while search is open (T1812)", () => {
  const names = new Map([["atlas", "Atlas"]])
  const found = (messages: Message[], nicknames: ReadonlyMap<string, string>, query: string) =>
    searchHits([], messageIndex({ messages, nicknames }), query)
      .filter((h) => h.kind === "message")
      .map((h) => h.m.seq)

  test("a later build finds what a first build would, new messages included", () => {
    const first = [msg(1, "deploy the relay to staging"), msg(2, "the relay is up")]
    expect(found(first, names, "relay")).toEqual(expect.arrayContaining([1, 2]))
    const later = [...first.map((m) => ({ ...m })), msg(3, "relay logs look clean")]
    expect(found(later, names, "relay").sort()).toEqual([1, 2, 3])
    expect(found(later, names, "logs")).toEqual([3])
  })

  test("an edited message is found by its new words, not its old ones", () => {
    found([msg(1, "deploy the relay to staging")], names, "relay")
    const edited = [msg(1, "deploy the worker to staging")]
    expect(found(edited, names, "relay")).toEqual([])
    expect(found(edited, names, "worker")).toEqual([1])
  })

  test("a changed nickname is found by the new name", () => {
    const messages = [msg(1, "deploy the relay to staging")]
    expect(found(messages, names, "atlas")).toEqual([1])
    const renamed = new Map([["atlas", "Hermes"]])
    expect(found(messages, renamed, "hermes")).toEqual([1])
    expect(found(messages, renamed, "atlas")).toEqual([])
  })
})
