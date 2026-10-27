import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"
import { choiceGate } from "@/lib/choosing"
import { answered } from "@/lib/asks"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { ComposerQuestion } = await import("./composer-question")
const { stepReplyText } = await import("./step-card")

const decision: Message = {
  v: PROTOCOL_VERSION,
  id: "1",
  from: "bot",
  kind: "ask",
  body: "Ship it now?",
  ts: 0,
  seq: 7,
  sigOk: true,
  to: ["jon"],
  esc: true,
  choices: ["A: ship it", "B: wait a day"],
}

const html = (m: Message, more = 0) =>
  renderToStaticMarkup(createElement(ComposerQuestion, { m, more, nameOf: (n: string) => n, disabled: false, onChoose: () => Promise.resolve(true), onElse: () => {} }))

describe("a decision in the composer", () => {
  test("shows the question, its options and Something else", () => {
    const out = html(decision, 2)
    expect(out).toContain("Decision for you")
    expect(out).toContain("Ship it now?")
    expect(out).toContain("A: ship it")
    expect(out).toContain("B: wait a day")
    expect(out).toContain("Something else")
    expect(out).toContain("+2 more")
  })

  test("names the task it was asked in, and no task when it has none", () => {
    expect(html({ ...decision, task: 12 })).toContain(">T12<")
    expect(html(decision)).not.toMatch(/>T\d+</)
  })

  test("has no way to dismiss it", () => {
    expect(html(decision)).not.toMatch(/aria-label="(Cancel|Close|Dismiss)/)
  })

  test("a question with no options is answered in the field alone", () => {
    const out = html({ ...decision, choices: undefined, esc: undefined })
    expect(out).toContain("Question for you")
    expect(out).toContain("Ship it now?")
    expect(out).not.toContain("Something else")
  })
})

describe("a step in the composer", () => {
  const step: Message = {
    ...decision,
    id: "step-1",
    body: "Purge the catalog cache",
    choices: undefined,
    holds: [12],
    step: {
      why: "The catalog deploy is waiting",
      needsPerson: "Only the owner has Cloudflare access",
      do: ["Purge the /catalog/ prefix"],
      run: ["curl -sI https://example.com/catalog"],
      expect: "cf-cache-status: BYPASS",
      links: ["https://dash.cloudflare.com/"],
    },
  }

  test("shows the how above Done, the reason actions and free text, never Decision for you", () => {
    const out = html(step)
    expect(out).toContain("A step for you")
    expect(out).not.toContain("Decision for you")
    expect(out).toContain("The catalog deploy is waiting")
    expect(out).toContain("Only the owner has Cloudflare access")
    expect(out).toContain("Purge the /catalog/ prefix")
    expect(out).toContain("curl -sI https://example.com/catalog")
    expect(out).toContain("cf-cache-status: BYPASS")
    expect(out).toContain('href="https://dash.cloudflare.com/"')
    expect(out).toContain("Copy command 1")
    expect(out.indexOf("Step instructions")).toBeLessThan(out.indexOf(">Done<"))
    expect(out).toContain("Can’t do it")
    expect(out).toContain("Not needed")
    expect(out).toContain("Something else")
    expect(out).toContain("max-h-[70dvh]")
    expect(out).toContain("overflow-y-auto")
  })

  test("Done preserves pasted output and the other outcomes carry their reason", () => {
    expect(stepReplyText({ outcome: "done", output: "first line\n  second line" })).toBe("Done\n\nfirst line\n  second line")
    expect(stepReplyText({ outcome: "done" })).toBe("Done")
    expect(stepReplyText({ outcome: "cant", reason: "No access on this device" })).toBe("Can't do it: No access on this device")
    expect(stepReplyText({ outcome: "not-needed", reason: "Already purged" })).toBe("Not needed: Already purged")
  })
})

describe("answering a question once", () => {
  test("the first question takes a click at once; the one that follows an answer waits 400 ms, so a double click can't answer it", () => {
    let now = 1_000
    const gate = choiceGate(() => now)
    gate.shown()
    expect(gate.take()).toBe(true)
    expect(gate.take()).toBe(false)
    gate.done(true)
    expect(gate.take()).toBe(false)
    gate.shown()
    now += 100
    expect(gate.take()).toBe(false)
    now += 400
    expect(gate.take()).toBe(true)
    gate.done(false)
    expect(gate.take()).toBe(true)
    gate.done(true)
    gate.shown()
    gate.shown()
    expect(gate.take()).toBe(true)
  })

  test("a message @addressed to someone else is not the answer to the waiting question", () => {
    expect(answered(decision, [], false)).toBe(decision)
    expect(answered(decision, ["bot"], false)).toBe(decision)
    expect(answered(decision, ["bot", "ana"], false)).toBe(decision)
    expect(answered(decision, ["ana"], false)).toBeUndefined()
    expect(answered(decision, [], true)).toBeUndefined()
    expect(answered(undefined, [], false)).toBeUndefined()
  })
})
