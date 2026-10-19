import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"
import { ComposerQuestion } from "./composer-question"

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

const html = (m: Message, more = 0) => renderToStaticMarkup(createElement(ComposerQuestion, { m, more, nameOf: (n: string) => n, disabled: false, onChoose: () => {}, onElse: () => {} }))

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
