import { describe, expect, test } from "bun:test"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { addMarks } from "@kiwi/channel/receipts.ts"
import { messagesOf } from "~/live/map"
import { receiptsOf, withReceipts } from "~/live/receipts"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "maya", pk: "pk-maya", owner: false, at: 0, active: true, kind: "human", display: "Maya" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "atlas", pk: "pk-atlas", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

let next = 0
const wire = (over: Partial<Wire>): Wire => {
  next++
  return { v: 1, id: `w${next}`, seq: next, from: "win", pk: `pk-${over.from ?? "win"}`, sigOk: true, kind: "msg", body: "hi", ts: next * 1000, rts: next * 1000, ...over } as Wire
}
const pictures = { get: () => ({ spot: "", alt: "", state: "waiting" as const }) }
const rows = (log: Wire[], me = "jow") => messagesOf(fold(log, roster, 0), log, me, new Map(), pictures, [])
const row = (log: Wire[], seq: number, me = "jow") => rows(log, me).find((m) => m.seq === seq)

describe("a message row says what it is (T641)", () => {
  test("questions, blockers and finishes say so, and who for", () => {
    const ask = wire({ kind: "ask", to: ["jow"], body: "Ship it now?" })
    const blocked = wire({ kind: "blocking", to: ["jow", "maya"], body: "No token" })
    const done = wire({ kind: "done", body: "Merged" })
    const log = [ask, blocked, done]
    expect(row(log, ask.seq)?.said).toEqual({ text: "asks you", tone: "ask" })
    expect(row(log, blocked.seq)?.said).toEqual({ text: "is blocked, needs you and Maya", tone: "alert" })
    expect(row(log, done.seq)?.said).toEqual({ text: "finished", tone: "quiet" })
  })

  test("a decision or a step handed to people is named in amber", () => {
    const decision = wire({ kind: "blocking", to: ["jow"], esc: true, body: "Release?" })
    const step = wire({ kind: "ask", to: ["jow"], esc: true, step: { why: "login", needsPerson: "only Jow can", do: ["run it"] }, body: "Sign in" })
    const log = [decision, step]
    expect(row(log, decision.seq)?.said).toEqual({ text: "Decision for you", tone: "decide" })
    expect(row(log, step.seq)?.said).toEqual({ text: "A step for you", tone: "decide" })
    expect(row(log, decision.seq, "maya")?.said).toEqual({ text: "Decision for Jow", tone: "decide" })
  })

  test("a plain message names who it went to only when its text doesn't", () => {
    const named = wire({ to: ["atlas"], body: "@atlas take T4" })
    const unnamed = wire({ to: ["atlas"], body: "take T4" })
    const all = wire({ to: ["*"], body: "standup" })
    const mine = wire({ from: "jow", to: ["win"], body: "go" })
    const log = [named, unnamed, all, mine]
    expect(row(log, named.seq)?.said).toBeUndefined()
    expect(row(log, unnamed.seq)?.said).toEqual({ text: "to atlas", tone: "quiet" })
    expect(row(log, all.seq)?.said).toEqual({ text: "to everyone", tone: "quiet" })
    expect(row(log, mine.seq)?.said).toBeUndefined()
  })

  test("every PR in a message gets its own chip", () => {
    const m = wire({ body: "Up: https://github.com/kiwi-init/channels/pull/12 and https://github.com/kiwi-init/channels/pull/13" })
    expect(row([m], m.seq)?.prs?.map((p) => p.number)).toEqual([12, 13])
  })

  test("a reply keeps its quote when the message it answers is no longer here, but never quotes an event", () => {
    const gone = wire({ body: "answering something old", re: [1] })
    const event = wire({ kind: "event", body: "", ev: { op: "fact.set", key: "k", value: "v" } } as Partial<Wire>)
    const onEvent = wire({ body: "re that note", re: [event.seq] })
    const log = [gone, event, onEvent]
    expect(row(log, gone.seq)?.replyTo).toBe(1)
    expect(row(log, onEvent.seq)?.replyTo).toBeUndefined()
  })
})

describe("read receipts under your newest message (T641)", () => {
  test("only your newest message in each place says whether it was read", () => {
    const first = wire({ from: "jow", to: ["win"], body: "one" })
    const last = wire({ from: "jow", to: ["win"], body: "two" })
    const log = [first, last]
    const state = fold(log, roster, 0)
    const pkOf = (n: string) => `pk-${n}`
    const unread = receiptsOf(state, log, "jow", addMarks(new Map(), [{ pk: "pk-win", seq: first.seq, at: 1 }]), pkOf, (t) => `t${t}`)
    expect([...unread]).toEqual([[last.seq, "Delivered"]])
    const read = receiptsOf(state, log, "jow", addMarks(new Map(), [{ pk: "pk-win", seq: last.seq, at: 42 }]), pkOf, (t) => `t${t}`)
    expect([...read]).toEqual([[last.seq, "Read t42"]])
    const shown = withReceipts(rows(log), read)
    expect(shown.find((m) => m.seq === last.seq)?.receipt).toBe("Read t42")
    expect(shown.find((m) => m.seq === first.seq)?.receipt).toBeUndefined()
  })

  test("nothing when no recipient has ever sent a mark", () => {
    const m = wire({ from: "jow", to: ["win"], body: "hi" })
    expect(receiptsOf(fold([m], roster, 0), [m], "jow", new Map(), (n) => `pk-${n}`, String).size).toBe(0)
  })
})
