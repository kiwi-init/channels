import { describe, expect, test } from "bun:test"

import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"

import { askLabel, asksFor, choiceIn, chosenOf } from "./asks"

const ask = (seq: number, from: string, extra: Partial<Message> = {}): Message => ({
  v: PROTOCOL_VERSION,
  id: String(seq),
  from,
  kind: "ask",
  body: `${from}:${seq}`,
  ts: 0,
  seq,
  sigOk: true,
  ...extra,
})

describe("asksFor", () => {
  test("every ask the badge counts lands in decisions, escalations or questions", () => {
    const escalated = ask(1, "bot", { to: ["jon"], esc: true })
    const direct = ask(2, "bot", { to: ["jon"] })
    const broadcast = ask(3, "bot", { to: ["*"] })
    const broadcastEsc = ask(4, "bot", { to: ["*"], esc: true })
    const own = ask(5, "jon", { to: ["*"] })
    const elsewhere = ask(6, "bot", { to: ["ana"] })
    const noRecipient = ask(7, "bot")
    const { decisions, escalations, questions } = asksFor([escalated, direct, broadcast, broadcastEsc, own, elsewhere, noRecipient], "jon")
    expect(decisions).toEqual([escalated, direct])
    expect(escalations).toEqual([])
    expect(questions).toEqual([broadcast, broadcastEsc])
  })

  test("a browser handoff to you stays in Needs you, not the composer", () => {
    const handoff = ask(1, "bot", { to: ["jon"], esc: true, handoff: { url: "https://example.com/x", vendor: "x", expires: 1 } })
    const { decisions, escalations } = asksFor([handoff], "jon")
    expect(decisions).toEqual([])
    expect(escalations).toEqual([handoff])
  })

  test("nothing open is nothing to show", () => {
    expect(asksFor([], "jon")).toEqual({ decisions: [], escalations: [], questions: [] })
  })
})

describe("askLabel", () => {
  test("names a decision, a question to you, and a question to everyone", () => {
    expect(askLabel(ask(1, "bot", { to: ["jon"], esc: true }), "jon")).toBe("Decision for you")
    expect(askLabel(ask(2, "bot", { to: ["jon"] }), "jon")).toBe("Question for you")
    expect(askLabel(ask(3, "bot", { to: ["*"] }), "jon")).toBe("Question for everyone")
    expect(askLabel(ask(4, "bot", { to: ["*"], esc: true }), "jon")).toBe("Question for everyone")
  })
})

describe("who chose what", () => {
  const options = ["A: Each person's own switch", "B: The owner allows voice first"]
  const asked = ask(10, "bot", { to: ["jon"], esc: true, choices: options })
  const reply = (seq: number, from: string, body: string, extra: Partial<Message> = {}): Message => ({ ...ask(seq, from), kind: "msg", body, ts: seq * 1000, re: [10], ...extra })

  test("a reply that is one of the options, word for word or by its letter, is the choice", () => {
    expect(chosenOf(asked, [reply(11, "jon", "B: The owner allows voice first")])).toEqual({ choice: options[1]!, by: "jon", at: 11000 })
    expect(chosenOf(asked, [reply(12, "jon", "B")])).toEqual({ choice: options[1]!, by: "jon", at: 12000 })
    expect(chosenOf(asked, [reply(13, "jon", "a: sure")])).toBeUndefined()
    expect(choiceIn("A) yes", options)).toBe(options[0])
  })

  test("only someone it was asked of chooses; the asker, other people and other threads don't", () => {
    expect(chosenOf(asked, [reply(14, "bot", "A"), reply(15, "ana", "A"), reply(16, "jon", "A", { re: [99] })])).toBeUndefined()
    expect(chosenOf({ ...asked, to: ["*"] }, [reply(17, "ana", "A")])).toEqual({ choice: options[0]!, by: "ana", at: 17000 })
  })

  test("the first choice counts, and an ask without options has none", () => {
    expect(chosenOf(asked, [reply(18, "jon", "something else first"), reply(19, "jon", "A"), reply(20, "jon", "B")])?.choice).toBe(options[0])
    expect(chosenOf({ ...asked, choices: undefined }, [reply(21, "jon", "A")])).toBeUndefined()
  })
})
