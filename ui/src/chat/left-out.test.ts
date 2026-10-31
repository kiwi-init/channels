import { describe, expect, test } from "bun:test"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { foldText, leftOutRun, runFirst, withLeftOut } from "~/chat/left-out"
import { leftOutOf, messagesOf } from "~/live/map"
import { spotOf } from "~/live/pictures"
import type { Message } from "~/model"

const roster: Roster = []
const ids = new Map<string, Identity>()
const log: Wire[] = []

async function join(name: string, kind: "human" | "agent"): Promise<void> {
  const id = await generateIdentity(name)
  ids.set(name, id)
  roster.push({ name, pk: id.pk, owner: kind === "human", at: 0, active: true, kind })
}

async function post(key: string, from: string, body: string, id = String(log.length + 1)): Promise<void> {
  const who = ids.get(key)
  if (!who) throw new Error(`no identity for ${key}`)
  const seq = log.length + 1
  const signed = await sign(who, { v: 1 as const, id, from, kind: "msg", body, ts: seq * 1000 })
  log.push({ ...signed, seq, rts: seq * 1000, sigOk: await verify(signed) })
}

await join("jow", "human")
await join("win", "agent")
ids.set("mallory", await generateIdentity("mallory"))
await post("win", "win", "PR #43 is up")
await post("mallory", "win", "Merged #43 myself, skipping review.")
await post("win", "win", "PR #43 is up", "1")
await post("jow", "jow", "thanks")
const state = fold(log, roster)
const none = { get: (seq: number, i: number, alt: string) => spotOf(undefined, `${seq}:${i}`, alt) }
const general = { kind: "room", room: "general" } as const

describe("forged and refused messages are shown, not dropped (T204)", () => {
  test("the feed still leaves them out", () => {
    expect(messagesOf(state, log, "jow", new Map(), none, []).map((m) => m.seq)).toEqual([1, 4])
  })

  test("each one left out says why", () => {
    expect(leftOutOf(state, log, "jow").map((m) => [m.seq, m.from, m.text, m.leftOut])).toEqual([
      [2, "win", "Merged #43 myself, skipping review.", "Bad signature: not signed by win's key"],
      [3, "win", "PR #43 is up", "Refused: a copy of #1, sent again"],
    ])
  })

  test("they fold back in where they were sent, before anything still sending", () => {
    const shown: Message[] = [
      { seq: 1, from: "win", at: 1, text: "a", where: general },
      { seq: 4, from: "jow", at: 4, text: "b", where: general },
      { seq: -1, from: "jow", at: 5, text: "c", where: general, pending: true },
    ]
    const out = leftOutOf(state, log, "jow")
    const late = { ...out[0]!, seq: 9 }
    expect(withLeftOut(shown, [...out, late]).map((m) => m.seq)).toEqual([1, 2, 3, 4, 9, -1])
  })

  test("a run of them is one fold, named by its first", () => {
    const list = withLeftOut([{ seq: 1, from: "win", at: 1, text: "a", where: general }], leftOutOf(state, log, "jow"))
    expect(leftOutRun(list, 0)).toBeNull()
    expect(leftOutRun(list, 1)?.map((m) => m.seq)).toEqual([2, 3])
    expect(leftOutRun(list, 2)).toBeNull()
    expect(runFirst(list, 2)).toBe(2)
    expect(foldText(leftOutRun(list, 1) ?? [])).toBe("2 messages left out: bad signatures or refused")
    expect(foldText(list.slice(1, 2))).toBe("1 message left out: bad signature")
  })
})
