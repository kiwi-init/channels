import { describe, expect, test } from "bun:test"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
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
