import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"
import { Quote } from "./quote"

const msg = (over: Partial<Message>): Message => ({ v: PROTOCOL_VERSION, id: "m7", seq: 7, ts: 0, from: "otter", kind: "msg", body: "ship it once ci-ok is green", ...over })
const html = (q: Message | undefined, mine = false, joined = true) =>
  renderToStaticMarkup(createElement(Quote, { seq: 7, q, mine, joined, nameOf: (n: string) => (n === "otter" ? "Otter" : n), onJump: () => undefined }))

describe("a reply quotes what it answers, inline", () => {
  test("names the sender and quotes the words", () => {
    const out = html(msg({}))
    expect(out).toContain("Otter")
    expect(out).toContain("ship it once ci-ok is green")
    expect(out).toContain('aria-label="Replying to Otter: ship it once ci-ok is green"')
  })

  test("a picture with no words reads as an image", () => {
    expect(html(msg({ body: "a.png", imgs: [{ name: "a.png", mime: "image/png" }] }))).toContain("Image")
    expect(
      html(
        msg({
          body: "a.png, b.png",
          imgs: [
            { name: "a.png", mime: "image/png" },
            { name: "b.png", mime: "image/png" },
          ],
        })
      )
    ).toContain("2 images")
  })

  test("a message no longer loaded still says it answers one", () => {
    expect(html(undefined)).toContain("Earlier message")
  })

  test("the line to the reply runs on the sender's side, and only from the last quote", () => {
    expect(html(msg({}), false)).toContain("border-l-2")
    expect(html(msg({}), true)).toContain("border-r-2")
    expect(html(msg({}), false, false)).not.toContain("border-t-2")
  })
})
