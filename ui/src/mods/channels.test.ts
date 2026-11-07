import { describe, expect, test } from "bun:test"

import type { ChannelTile, HomeChannel } from "~/model"
import { channelsFor, modChannels } from "~/mods/channels"

const tile = (code: string, over: Partial<ChannelTile> = {}): ChannelTile => ({ code, title: code, state: "member", unread: 0, needsYou: 0, last: 0, ...over })

const home = (code: string, over: Partial<HomeChannel> = {}): HomeChannel => ({
  code,
  title: code,
  lead: null,
  leadName: null,
  working: 0,
  asks: [],
  moving: [],
  more: 0,
  doneToday: 0,
  red: 0,
  agents: [],
  said: null,
  ...over,
})

describe("the channels a mod with the channels need sees", () => {
  test("the ones that need you come first, then the most recent, and a muted one only when it needs you", () => {
    const list = modChannels(
      [tile("old", { last: 1 }), tile("fresh", { last: 9 }), tile("asks", { needsYou: 2, last: 0 }), tile("hushed", { muted: true, last: 20 }), tile("loud", { muted: true, needsYou: 1 })],
      []
    )
    expect(list.map((c) => [c.code, c.needs])).toEqual([
      ["asks", 2],
      ["loud", 1],
      ["fresh", 0],
      ["old", 0],
    ])
  })

  test("channels still waiting to be let in, or gone, stay off it, and each carries only its code, title, count, last activity and line", () => {
    const list = modChannels([tile("waiting", { state: "waiting" }), tile("gone", { state: "gone" }), tile("here", { title: "Here", last: 5, unread: 3 })], [])
    expect(list).toEqual([{ code: "here", title: "Here", needs: 0, last: 5, line: null }])
  })

  test("its one line is the task that's moving, else the last thing said in #general, else nothing", () => {
    const list = modChannels(
      [tile("busy", { last: 3 }), tile("talk", { last: 2 }), tile("still", { last: 1 })],
      [
        home("busy", { moving: [{ id: 4, title: "Top bar buttons", who: "megatron", state: "in review", busy: true, red: false }] }),
        home("talk", { said: { from: "jow", at: 0, text: "ship  it\ntoday" } }),
        home("still"),
      ]
    )
    expect(list.map((c) => c.line)).toEqual(["megatron · Top bar buttons · in review", "jow: ship it today", null])
  })

  test("a long line ends in an ellipsis", () => {
    const [one] = modChannels([tile("c")], [home("c", { said: { from: "a", at: 0, text: "x".repeat(200) } })])
    expect(one?.line?.length).toBe(90)
    expect(one?.line?.endsWith("…")).toBe(true)
  })

  test("only a mod that's on and asked for channels gets them; any other gets nothing", () => {
    const list = modChannels([tile("here")], [])
    expect(channelsFor({ state: "on", needs: ["afk", "channels"] }, list)).toBe(list)
    expect(channelsFor({ state: "on", needs: ["afk", "panel"] }, list)).toBeNull()
    expect(channelsFor({ state: "asks", needs: ["channels"] }, list)).toBeNull()
    expect(channelsFor({ state: "off", needs: ["channels"] }, list)).toBeNull()
    expect(channelsFor(undefined, list)).toBeNull()
  })
})
