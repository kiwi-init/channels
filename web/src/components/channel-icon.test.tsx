import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", harnessUrl: () => "" }))
const { ChannelFace } = await import("./channel-icon")

const html = (lead: string | null) => renderToStaticMarkup(createElement(ChannelFace, { icon: { kind: "emoji", emoji: "🥝" }, lead, title: "channels-dev", size: 40 }))

describe("a channel's face", () => {
  test("with a lead, it is the lead's head, as in the channel's details", () => {
    const out = html("steady-puffin")
    expect(out).toContain('alt="The lead"')
    expect(out).not.toContain("🥝")
  })
  test("without one, it is the channel's icon", () => {
    const out = html(null)
    expect(out).toContain("🥝")
    expect(out).not.toContain("<img")
  })
})
