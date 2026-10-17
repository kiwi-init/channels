import { describe, expect, test } from "bun:test"

import { PROTOCOL_VERSION, type Message } from "@mc/protocol.ts"

import { askLabel, asksFor } from "./asks"

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
  test("every ask the badge counts lands in escalations or questions", () => {
    const escalated = ask(1, "bot", { to: ["jon"], esc: true })
    const direct = ask(2, "bot", { to: ["jon"] })
    const broadcast = ask(3, "bot", { to: ["*"] })
    const broadcastEsc = ask(4, "bot", { to: ["*"], esc: true })
    const own = ask(5, "jon", { to: ["*"] })
    const elsewhere = ask(6, "bot", { to: ["ana"] })
    const noRecipient = ask(7, "bot")
    const { escalations, questions } = asksFor([escalated, direct, broadcast, broadcastEsc, own, elsewhere, noRecipient], "jon")
    expect(escalations).toEqual([escalated])
    expect(questions).toEqual([direct, broadcast, broadcastEsc])
  })

  test("nothing open is nothing to show", () => {
    expect(asksFor([], "jon")).toEqual({ escalations: [], questions: [] })
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
