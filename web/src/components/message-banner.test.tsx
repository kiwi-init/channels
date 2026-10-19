import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"

import { AskedBelow } from "./asked-below"
import type { MessageProps } from "./message"
import { sameRow } from "./message-memo"

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
