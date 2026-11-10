import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { roomsOf, taskMentionsOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "dev", pk: "pk-dev", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const msg = (seq: number, from: string, body: string, task?: number): Wire =>
  ({ v: 1, id: `m${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "msg", body, ts: seq * 1000, ...(task !== undefined ? { task } : {}) }) as Wire
const ev = (seq: number, from: string, e: Event): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev: e, ts: seq * 1000 }) as Wire

const add = ev(1, "jow", { op: "task.add", title: "Ship the export", owner: "dev" })
const counts = (log: Wire[], seen: Record<string, number> = {}) => taskMentionsOf(fold(log, roster, 0), log, "jow", seen, 0)

describe("an @mention posted on a task counts before you open it (#2027)", () => {
  test("a mention of you in a task counts for that task, though the room shows nothing", () => {
    const log = [add, msg(2, "dev", "@jow milestone: half the rows export", 1)]
    expect(counts(log).get(1)).toBe(1)
    expect(roomsOf(fold(log, roster, 0), log, "jow", {}, 0).find((r) => r.id === "general")?.mentions).toBe(0)
  })

  test("opening the task clears it: the task's seen mark passes the message", () => {
    const log = [add, msg(2, "dev", "@jow milestone: half the rows export", 1)]
    expect(counts(log, { "task:1": 2 }).get(1)).toBeUndefined()
  })

  test("a later mention after the seen mark counts again", () => {
    const log = [add, msg(2, "dev", "@jow milestone: half done", 1), msg(3, "dev", "@jow done, PR is up", 1)]
    expect(counts(log, { "task:1": 2 }).get(1)).toBe(1)
  })

  test("a task message that doesn't mention you, and your own message, don't count", () => {
    const log = [add, msg(2, "dev", "still on the writer", 1), msg(3, "jow", "@jow note to self", 1)]
    expect(counts(log).size).toBe(0)
  })
})
