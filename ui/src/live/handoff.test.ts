import { describe, expect, test } from "bun:test"

import { HANDOFF_DONE, type Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { asksOf, messagesOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "maya", pk: "pk-maya", owner: false, at: 0, active: true, kind: "human", display: "Maya", answersDecisions: true },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const handoff = { url: "https://vercel.com/login", vendor: "vercel", expiresAt: 10 * 60_000 }

const ask = {
  v: 1,
  id: "h1",
  seq: 5,
  from: "win",
  pk: "pk-win",
  sigOk: true,
  kind: "blocking",
  body: "Sign in to Vercel so I can link the preview deploys",
  ts: 1,
  to: ["jow"],
  esc: true,
  handoff,
} as Wire

const done = { v: 1, id: "h2", seq: 6, from: "jow", pk: "pk-jow", sigOk: true, kind: "msg", body: HANDOFF_DONE, ts: 2, to: ["win"], re: [5] } as Wire

const pictures = { get: () => ({ spot: "", alt: "", state: "waiting" as const }) }

describe("a browser handoff shows in the feed again (T197)", () => {
  test("the person it's for gets a card with the link, its vendor and its expiry", () => {
    const { asks, askOf } = asksOf(fold([ask], roster, 0), [ask], "jow", true, [], roster, new Map())
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({ kind: "question", label: "Browser for you", handoff: { url: handoff.url, label: "vercel (vercel.com)", expiresAt: handoff.expiresAt } })
    const state = fold([ask], roster, 0)
    expect(messagesOf(state, [ask], "jow", askOf, pictures, []).find((m) => m.seq === 5)?.ask).toBe("5")
  })

  test("someone who answers decisions doesn't get another person's browser", () => {
    const { asks } = asksOf(fold([ask], roster, 0), [ask], "maya", false, [], roster, new Map())
    expect(asks).toHaveLength(0)
  })

  test("Done answers the card", () => {
    const { asks } = asksOf(fold([ask, done], roster, 0), [ask, done], "jow", true, [], roster, new Map())
    expect(asks[0]).toMatchObject({ answer: { text: HANDOFF_DONE, by: "jow" } })
  })
})
