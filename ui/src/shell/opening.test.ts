import { describe, expect, test } from "bun:test"

import type { App, ChannelTile } from "~/model"
import { opening } from "~/shell/opening"

const tile = (code: string, state: ChannelTile["state"]): ChannelTile => ({ code, title: code, state, unread: 0, needsYou: 0, last: 0 })
const app = (over: Partial<Pick<App, "channel" | "channels" | "gone">> = {}): Pick<App, "channel" | "channels" | "gone"> => ({
  channel: null,
  channels: [tile("mc2-a", "member"), tile("mc2-w", "waiting"), tile("mc2-g", "gone")],
  ...over,
})

describe("a channel that is opening shows nothing for that commit, not a Home that is thrown away (T1788)", () => {
  test("a member channel picked in the rail, before its data is published, is opening", () => {
    expect(opening(app(), { page: "channel", channel: "mc2-a" })).toBe(true)
  })

  test("once the channel is published it is no longer opening", () => {
    expect(opening(app({ channel: { code: "mc2-a" } as App["channel"] }), { page: "channel", channel: "mc2-a" })).toBe(false)
  })

  test("Home, Settings, a channel still waiting to be let in, one that is gone and one this app doesn't hold keep their own screens", () => {
    expect(opening(app(), { page: "channel", channel: null })).toBe(false)
    expect(opening(app(), { page: "settings", channel: "mc2-a" })).toBe(false)
    expect(opening(app(), { page: "channel", channel: "mc2-w" })).toBe(false)
    expect(opening(app(), { page: "channel", channel: "mc2-g" })).toBe(false)
    expect(opening(app(), { page: "channel", channel: "mc2-unknown" })).toBe(false)
    expect(opening(app({ gone: { code: "mc2-a", title: "A", why: "closed" } }), { page: "channel", channel: "mc2-a" })).toBe(false)
  })
})
