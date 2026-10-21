import { describe, expect, test } from "bun:test"

import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import { PERMISSION_CHOICES, type PermissionShown } from "@kiwi/core/permission.ts"
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"

import { askLabel, asksFor, choiceIn, chosenOf, permissionAsks } from "./asks"

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

describe("permission rows in Needs you", () => {
  test("come only from the fold's open asks: a forged copy, two asks at one seq, an ask past its deadline since the fold and a plain question make none", async () => {
    const ids = new Map<string, Identity>()
    const roster: Roster = []
    for (const [name, kind, owner] of [
      ["jon", "human", true],
      ["ana", "human", false],
      ["win", "agent", false],
    ] as const) {
      const id = await generateIdentity(name)
      ids.set(name, id)
      roster.push({ name, pk: id.pk, owner, at: 0, active: true, kind, sponsor: { user: name === "jon" ? "u-jon" : "u-ana", name } })
    }
    const now = 1_000_000
    const shown = (command: string, expiresAt = now + 60_000): PermissionShown => ({ tool: "Bash", command, cwd: "/a", nonce: "nonce-123", expiresAt, canAllow: true })
    const askAt = async (seq: number, permission: PermissionShown | null): Promise<Message> => {
      const p = await sign(ids.get("win")!, {
        v: 1 as const,
        id: `ask-${seq}`,
        from: "win",
        kind: "blocking",
        body: "Allow?",
        to: ["ana", "jon"],
        esc: true,
        ...(permission ? { choices: [...PERMISSION_CHOICES], permission } : {}),
        ts: seq,
      })
      return { ...p, seq, rts: seq, sigOk: await verify(p) }
    }
    const real = await askAt(1, shown("rm -rf ~"))
    const copy: Message = { ...real, seq: 2, rts: 2, permission: shown("ls"), sigOk: false }
    const doubled = await askAt(3, shown("rm -rf /tmp/x"))
    const lookAlike: Message = { ...doubled, permission: shown("ls"), sigOk: false }
    const expiring = await askAt(4, shown("ls", now + 10))
    const plain = await askAt(5, null)
    const state = fold([real, copy, lookAlike, doubled, expiring, plain], roster, now)
    expect(asksFor(state.openAsks, "ana").decisions.map((m) => m.seq)).toEqual([1, 4, 5])
    expect(permissionAsks(asksFor(state.openAsks, "ana"), now).map(({ m }) => m.seq)).toEqual([1, 4])
    expect(permissionAsks(asksFor(state.openAsks, "ana"), now + 11).map(({ m, p }) => [m.seq, p.command])).toEqual([[1, "rm -rf ~"]])
  })
})
