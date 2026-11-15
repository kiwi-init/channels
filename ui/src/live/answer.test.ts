import { describe, expect, test } from "bun:test"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, handedOver, type Roster } from "@kiwi/core/state.ts"
import { asksOf } from "~/live/map"
import { wordsRaw } from "~/words"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
  { name: "atlas", pk: "pk-atlas", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const signed = (m: Record<string, unknown>) => ({ v: 1, sigOk: true, ts: 1, ...m }) as Wire
const ask = signed({ id: "a", seq: 5, from: "win", pk: "pk-win", kind: "blocking", body: "Is the old relay still needed?", to: ["jow"], esc: true, holds: [3] })
const lead = signed({ id: "b", seq: 6, from: "atlas", pk: "pk-atlas", kind: "msg", body: "Jow, it asks whether we can switch the old relay off. Type your answer in its box.", re: [5] })
const owner = signed({ id: "c", seq: 7, from: "jow", pk: "pk-jow", kind: "msg", body: "done, switch it off", re: [5], to: ["win"] })

describe("a card's answer is the reply that answered it (T465, #1126)", () => {
  test("the lead explaining the card in its thread doesn't answer it; the owner's reply does", () => {
    const messages = [ask, lead, owner]
    const { asks } = asksOf(fold(messages, roster, 0), messages, "jow", true, [], roster, new Map())
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({ kind: "question", answer: { by: "jow" } })
    const card = asks[0]
    expect(card?.kind === "question" && card.answer && wordsRaw(card.answer.text)).toBe("done, switch it off")
  })

  test("with only the lead's reply, the card is still waiting", () => {
    const messages = [ask, lead]
    const { asks } = asksOf(fold(messages, roster, 0), messages, "jow", true, [], roster, new Map())
    expect(asks).toHaveLength(1)
    expect(asks[0]?.kind === "question" && asks[0].answer).toBeFalsy()
  })
})

describe("a card knows where its answer shows (#1794)", () => {
  test("a reply typed in the room shows in the feed, so the card points at it", () => {
    const messages = [ask, owner]
    const { asks } = asksOf(fold(messages, roster, 0), messages, "jow", true, [], roster, new Map())
    expect(asks[0]).toMatchObject({ kind: "question", answer: { shownIn: "feed", seq: 7 } })
  })

  test("an answer sent from the card is a side reply, so only the card shows it", () => {
    const fromCard = signed({ id: "d", seq: 8, from: "jow", pk: "pk-jow", kind: "msg", body: "done", re: [5], to: ["win"], side: true })
    const messages = [ask, fromCard]
    const { asks } = asksOf(fold(messages, roster, 0), messages, "jow", true, [], roster, new Map())
    expect(asks[0]).toMatchObject({ kind: "question", answer: { shownIn: "card" } })
    expect(asks[0]?.kind === "question" && asks[0].answer && "seq" in asks[0].answer).toBe(false)
  })
})

describe("a decision the Lead sends on keeps its area and whose it was (T505)", () => {
  test("the card has the area, and names the Builder whose hand-over it answers", () => {
    const handed = signed({ id: "h", seq: 3, from: "win", pk: "pk-win", kind: "blocking", body: handedOver("win", "Count where?", { area: "Tab strip" }), to: ["atlas"] })
    const sent = signed({ id: "s", seq: 4, from: "atlas", pk: "pk-atlas", kind: "blocking", body: "The count after the name?", to: ["jow"], esc: true, area: "Tab strip", re: [3] })
    const messages = [handed, sent]
    const card = asksOf(fold(messages, roster, 0), messages, "jow", true, [], roster, new Map()).asks.find((a) => a.id === "4")
    expect(card).toMatchObject({ kind: "question", area: "Tab strip", via: "win" })
  })

  test("a decision of the Lead's own names nobody else", () => {
    const own = signed({ id: "s", seq: 4, from: "atlas", pk: "pk-atlas", kind: "blocking", body: "Ship it?", to: ["jow"], esc: true, re: [5] })
    const messages = [ask, own]
    const card = asksOf(fold(messages, roster, 0), messages, "jow", true, [], roster, new Map()).asks.find((a) => a.id === "4")
    expect(card?.kind === "question" && card.via).toBeUndefined()
  })
})

describe("what the Lead settled itself shows to the person who decides (T506)", () => {
  const handed = signed({ id: "h", seq: 3, from: "win", pk: "pk-win", kind: "blocking", body: handedOver("win", "Hide agents that left?", { choices: ["A: hide", "B: dim"] }), to: ["atlas"] })
  const settle = signed({ id: "r", seq: 4, from: "atlas", pk: "pk-atlas", kind: "msg", body: "B: dim", re: [3], to: ["win"] })
  const passed = signed({ id: "p", seq: 5, from: "atlas", pk: "pk-atlas", kind: "blocking", body: "Hide agents that left?", to: ["jow"], esc: true, re: [3] })
  const settledOf = (messages: Wire[], me = "jow", now = 1_000) => asksOf(fold(messages, roster, 0), messages, me, me === "jow", [], roster, new Map(), now).settled

  test("the Lead's answer to a hand-over is settled, with the question and whose it was", () => {
    const [one, ...rest] = settledOf([handed, settle])
    expect(rest).toHaveLength(0)
    expect(one).toMatchObject({ id: "4", by: "atlas", asker: "win" })
    expect(one && [wordsRaw(one.question), wordsRaw(one.answer)]).toEqual(["Hide agents that left?", "B: dim"])
  })

  test("one the Lead sent on to a person isn't settled, and a day later it's gone", () => {
    expect(settledOf([handed, passed])).toEqual([])
    expect(settledOf([handed, settle], "jow", 1 + 86_400_001)).toEqual([])
  })

  test("your reply to it is the overrule", () => {
    const over = signed({ id: "o", seq: 6, from: "jow", pk: "pk-jow", kind: "msg", body: "Hide them", re: [4], to: ["atlas", "win"] })
    const [one] = settledOf([handed, settle, over])
    expect(one?.overruled && wordsRaw(one.overruled.text)).toBe("Hide them")
  })

  test("someone who doesn't decide doesn't see it", () => {
    expect(settledOf([handed, settle], "win")).toEqual([])
  })
})

describe("with answers by tap on, a typed reply doesn't answer the card (T509)", () => {
  const tapOn = signed({ id: "t", seq: 4, from: "jow", pk: "pk-jow", kind: "event", body: "", ev: { op: "asks.tap.set", on: true } })
  const map = (messages: Wire[]) => asksOf(fold(messages, roster, 0), messages, "jow", true, [], roster, new Map()).asks[0]

  test("the card stays open and remembers what you typed", () => {
    const card = map([tapOn, ask, owner])
    expect(card).toMatchObject({ kind: "question", typed: { by: "jow", seq: 7 } })
    expect(card?.kind === "question" && card.answer).toBeFalsy()
  })

  test("a tap from the card answers it", () => {
    const tap = signed({ id: "p", seq: 8, from: "jow", pk: "pk-jow", kind: "msg", body: "done", re: [5], to: ["win"], side: true, pick: true })
    const card = map([tapOn, ask, owner, tap])
    expect(card).toMatchObject({ kind: "question", answer: { by: "jow", shownIn: "card" } })
    expect(card?.kind === "question" && card.typed).toBeFalsy()
  })
})
