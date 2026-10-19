import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { ChannelIcon } from "@kiwi/core/protocol.ts"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: (face: string) => `/robot-${face}.svg`, robotFor: (key: string) => (key === "channels-dev" ? "teal" : "gold") }))
const { ChannelIconTile, RobotPicker } = await import("./channel-icon")

const tile = (icon: ChannelIcon | null) => renderToStaticMarkup(createElement(ChannelIconTile, { icon, title: "channels-dev", size: 40 }))

describe("a channel's face", () => {
  test("is the robot head its owner picked", () => {
    expect(tile({ kind: "robot", robot: "coral" })).toContain('src="/robot-coral.svg"')
  })
  test("without an icon, is a robot head steady for its title, never the lead's", () => {
    expect(tile(null)).toContain('src="/robot-teal.svg"')
  })
  test("an emoji or an image icon still shows as itself", () => {
    expect(tile({ kind: "emoji", emoji: "🥝" })).toContain("🥝")
    expect(tile({ kind: "image", mime: "image/png", data: "AAAA" })).toContain('src="data:image/png;base64,AAAA"')
  })
})

describe("the robot picker", () => {
  test("offers all twelve heads and marks the chosen one", () => {
    const out = renderToStaticMarkup(createElement(RobotPicker, { value: "mint", onPick: () => {} }))
    expect(out.match(/role="radio"/g)?.length).toBe(12)
    expect(out.match(/aria-checked="true"/g)?.length).toBe(1)
    expect(out).toMatch(/aria-checked="true" aria-label="mint robot"/)
  })
})
