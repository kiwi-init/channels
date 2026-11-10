import { describe, expect, test } from "bun:test"

import { READ_FLOOR, seenAt } from "@kiwi/app/threads.ts"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { roomsOf } from "~/live/map"
import { threadsOf } from "~/live/threads"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

let next = 0
const wire = (over: Partial<Wire>): Wire => {
  next++
  return { v: 1, id: `w${next}`, seq: next, from: "win", pk: `pk-${over.from ?? "win"}`, sigOk: true, kind: "msg", body: "hi", ts: next * 1000, rts: next * 1000, ...over } as Wire
}

describe("a whole channel marked read is a floor under every place's own mark (T3487)", () => {
  test("a place reads from its own mark or the floor, whichever is higher, and a store without a floor reads as before", () => {
    expect(seenAt({ main: 4 }, "main")).toBe(4)
    expect(seenAt({ main: 4, [READ_FLOOR]: 9 }, "main")).toBe(9)
    expect(seenAt({ main: 12, [READ_FLOOR]: 9 }, "main")).toBe(12)
    expect(seenAt({ [READ_FLOOR]: 9 }, "room:design", 3)).toBe(9)
    expect(seenAt({}, "room:design", 3)).toBe(3)
  })

  test("rooms count nothing up to the floor, and a message that arrives after it is unread again", () => {
    const first = wire({ body: "one" })
    const second = wire({ body: "two" })
    const log = [first, second]
    const general = (seen: Record<string, number>, messages: Wire[]) => roomsOf(fold(messages, roster, 0), messages, "jow", seen, 0).find((r) => r.id === "general")?.unread
    expect(general({}, log)).toBe(2)
    expect(general({ [READ_FLOOR]: second.seq }, log)).toBe(0)
    const later = wire({ body: "three" })
    expect(general({ [READ_FLOOR]: second.seq }, [...log, later])).toBe(1)
  })

  test("threads honour it too", () => {
    const root = wire({ from: "jow", body: "where does T10 stand?" })
    const reply = wire({ re: [root.seq], body: "merged" })
    const log = [root, reply]
    const unread = (seen: Record<string, number>) => threadsOf(fold(log, roster, 0), log, "jow", seen, 0).find((t) => t.root === root.seq)?.unread
    expect(unread({})).toBe(1)
    expect(unread({ [READ_FLOOR]: reply.seq })).toBe(0)
  })
})
