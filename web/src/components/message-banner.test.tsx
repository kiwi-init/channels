import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"

import { AskedBelow } from "./asked-below"
import type { MessageProps } from "./message"
import { sameRow } from "./message-memo"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { MessageRow } = await import("./message")

const ask: Message = {
  v: PROTOCOL_VERSION,
  id: "9",
  from: "win",
  kind: "msg",
  body: "Should I delete the 800 test rooms on the old relay? It frees space, and it can't be undone.",
  choices: ["A: delete them", "B: keep them"],
  to: ["jow"],
  ts: 0,
  seq: 9,
  sigOk: true,
}

const quoted = () => undefined
const nameOf = (n: string) => n
const onJump = () => {}
const onChoose = () => {}

const props = (extra: Partial<MessageProps> = {}): MessageProps => ({
  m: ask,
  me: "jow",
  online: true,
  first: true,
  adjacentReply: false,
  highlighted: false,
  quoted,
  nameOf,
  onJump,
  onChoose,
  ...extra,
})

describe("a question waiting above the composer shows once", () => {
  test("in the feed it is a one-line pointer to the banner", () => {
    const html = renderToStaticMarkup(createElement(AskedBelow, { body: ask.body, first: true }))
    expect(html).toContain("Answer it below")
    expect(html).toContain("Should I delete the 800 test rooms")
    expect(html).not.toContain("A: delete them")
  })

  test("moving in or out of the banner renders the row again", () => {
    expect(sameRow(props(), props({ inBanner: true }))).toBe(false)
    expect(sameRow(props({ inBanner: true }), props({ inBanner: true }))).toBe(true)
  })
})

describe("a step in conversation history", () => {
  const m: Message = {
    ...ask,
    esc: true,
    holds: [12],
    choices: undefined,
    step: {
      why: "The catalog deploy is waiting",
      needsPerson: "Only the owner has Cloudflare access",
      do: ["Purge the /catalog/ prefix"],
      run: ["curl -sI https://example.com/catalog"],
      links: ["https://dash.cloudflare.com/"],
    },
  }

  test("keeps the instructions and links after the answer, but does not repeat them beside its banner", () => {
    const html = renderToStaticMarkup(createElement(MessageRow, props({ m, onChoose: undefined })))
    expect(html).toContain("A step for you")
    expect(html).toContain("Step instructions")
    expect(html).toContain("Purge the /catalog/ prefix")
    expect(html).toContain("curl -sI https://example.com/catalog")
    expect(html).toContain('href="https://dash.cloudflare.com/"')
    const banner = renderToStaticMarkup(createElement(MessageRow, props({ m, inBanner: true })))
    expect(banner).not.toContain("Step instructions")
    expect(banner).toContain("Answer it below")
  })
})
