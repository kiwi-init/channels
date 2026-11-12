import { describe, expect, test } from "bun:test"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts"
import { addMarks } from "@kiwi/channel/receipts.ts"
import { reachedOf, receiptsOf, withReceipts } from "~/live/receipts"
import type { Message } from "~/model"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "dev", pk: "pk-dev", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "atlas", pk: "pk-atlas", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

let next = 10
const wire = (over: Partial<Wire>): Wire => {
  next++
  return { v: 1, id: `w${next}`, seq: next, from: "win", pk: `pk-${over.from ?? "win"}`, sigOk: true, kind: "msg", body: "hi", ts: next * 1000, rts: next * 1000, ...over } as Wire
}
const pkOf = (n: string) => `pk-${n}`
const here = new Map([
  ["win", {}],
  ["dev", {}],
  ["atlas", {}],
])
const led = (log: Wire[], doing: [number, string][] = []): ChannelState =>
  ({ ...fold(log, roster, 0), lead: "atlas", tasks: new Map(doing.map(([id, owner]) => [id, { id, owner, state: "doing" }])) }) as unknown as ChannelState
const under = (log: Wire[], state: ChannelState, marks: Parameters<typeof receiptsOf>[3], busy: Record<string, string>, reached: ReturnType<typeof reachedOf>) => [
  ...receiptsOf(state, log, "jow", marks, pkOf, String, (n) => (busy[n] ? { text: busy[n] } : null), 0, reached),
]

describe("the line under a person's message says who is not there (T614)", () => {
  test("an agent nothing can wake is named at once, in place of Delivered", () => {
    const m = wire({ from: "jow", to: ["win"], body: "any news?" })
    const marks = addMarks(new Map(), [{ pk: "pk-win", seq: 1, at: 1 }])
    expect(under([m], led([m]), marks, {}, reachedOf(new Map(), ["win"], false))).toEqual([[m.seq, { sign: { gone: "win can't be woken" } }]])
  })

  test("an agent nothing answers for is named only once everyone had time to answer", () => {
    const m = wire({ from: "jow", to: ["win"], body: "any news?" })
    const marks = addMarks(new Map(), [{ pk: "pk-win", seq: 1, at: 1 }])
    expect(under([m], led([m]), marks, {}, reachedOf(new Map(), [], false))).toEqual([[m.seq, { receipt: "Delivered" }]])
    expect(under([m], led([m]), marks, {}, reachedOf(new Map(), [], true))).toEqual([[m.seq, { sign: { gone: "win isn't listening" } }]])
  })

  test("several are named together, and whoever read it still shows", () => {
    const m = wire({ from: "jow", to: ["win", "dev", "atlas"], body: "any news?" })
    const marks = addMarks(new Map(), [{ pk: "pk-atlas", seq: m.seq, at: 1 }])
    expect(under([m], led([m]), marks, {}, reachedOf(new Map([["atlas", {}]]), [], true))).toEqual([[m.seq, { receipt: "Read by atlas", sign: { gone: "win, dev aren't listening" } }]])
  })

  test("it goes once the agent reads the message", () => {
    const m = wire({ from: "jow", to: ["win"], body: "any news?" })
    const marks = addMarks(new Map(), [{ pk: "pk-win", seq: m.seq, at: 7 }])
    expect(under([m], led([m]), marks, {}, reachedOf(new Map(), ["win"], true))).toEqual([[m.seq, { receipt: "Read 7" }]])
  })
})

describe("the line under a person's message says who is busy, and how far back the message is (T614)", () => {
  test("its task, the messages that reach it first, and the lead to ask", () => {
    const before = [wire({ from: "jow", to: ["win"], body: "one" }), wire({ from: "atlas", to: ["win"], body: "two" })]
    const m = wire({ from: "jow", to: ["win"], body: "is the bubble in my app?" })
    const log = [...before, m]
    const marks = addMarks(new Map(), [{ pk: "pk-win", seq: 1, at: 1 }])
    const said = under(log, led(log, [[31, "win"]]), marks, { win: "running Bash" }, reachedOf(here, [], true))
    expect(said).toEqual([[m.seq, { receipt: "win is busy on T31 · 2 messages ahead of yours", sign: { ask: { to: "atlas", name: "atlas", about: "win" } } }]])
  })

  test("with no task it says what the agent is doing, and one message ahead is singular", () => {
    const before = wire({ from: "atlas", to: ["win"], body: "one" })
    const m = wire({ from: "jow", to: ["win"], body: "and this?" })
    const marks = addMarks(new Map(), [{ pk: "pk-win", seq: 1, at: 1 }])
    const said = under([before, m], led([before, m]), marks, { win: "thinking" }, reachedOf(here, [], true))
    expect(said[0]?.[1].receipt).toBe("win is busy · thinking · 1 message ahead of yours")
  })

  test("yours is next when nothing else waits for it", () => {
    const m = wire({ from: "jow", to: ["win"], body: "and this?" })
    const marks = addMarks(new Map(), [{ pk: "pk-win", seq: m.seq - 1, at: 1 }])
    expect(under([m], led([m]), marks, { win: "thinking" }, reachedOf(here, [], true))[0]?.[1].receipt).toBe("win is busy · thinking · yours is next")
  })

  test("the row carries the sign beside the receipt", () => {
    const m = wire({ from: "jow", to: ["win"], body: "and this?" })
    const row = { seq: m.seq } as Message
    const marks = addMarks(new Map(), [{ pk: "pk-win", seq: m.seq - 1, at: 1 }])
    const shown = withReceipts(
      [row],
      receiptsOf(led([m]), [m], "jow", marks, pkOf, String, () => ({ text: "thinking" }), 0, reachedOf(here, [], true))
    )
    expect(shown[0]).toEqual({ seq: m.seq, receipt: "win is busy · thinking · yours is next", sign: { ask: { to: "atlas", name: "atlas", about: "win" } } })
  })
})
