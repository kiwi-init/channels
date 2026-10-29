import { describe, expect, test } from "bun:test"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { drawerNews, worthTelling } from "~/live/notify"

const msg = (over: Partial<Wire>): Wire => ({ v: 1, id: "1", seq: 1, from: "atlas", kind: "msg", body: "hi", ts: 1, rts: 1, sigOk: true, sig: "", ...over }) as Wire

describe("notifications (T654)", () => {
  test("none tells nothing, all tells every message from someone else", () => {
    expect(worthTelling(msg({ to: ["jow"] }), "jow", "none", true)).toBe(false)
    expect(worthTelling(msg({}), "jow", "all", false)).toBe(true)
    expect(worthTelling(msg({ from: "jow" }), "jow", "all", false)).toBe(false)
  })

  test("mentions tells messages to you or naming you", () => {
    expect(worthTelling(msg({}), "jow", "mentions", false)).toBe(false)
    expect(worthTelling(msg({ to: ["jow"] }), "jow", "mentions", false)).toBe(true)
    expect(worthTelling(msg({ body: "@jow can you look?" }), "jow", "mentions", false)).toBe(true)
  })

  test("mentions tells a decision escalated to you when you answer decisions", () => {
    const escalated = msg({ kind: "ask", esc: true, body: "ship it or wait?" })
    expect(worthTelling(escalated, "jow", "mentions", true)).toBe(true)
    expect(worthTelling(escalated, "jow", "mentions", false)).toBe(false)
    expect(worthTelling(msg({ esc: true }), "jow", "mentions", true)).toBe(false)
  })

  test("the narrow window's drawer button carries a dot for news in rooms and DMs", () => {
    const room = (unread: number, mentions: number) => ({ id: "general", name: "general", unread, mentions })
    expect(drawerNews({ rooms: [room(0, 0)], directs: [] })).toBeNull()
    expect(drawerNews({ rooms: [room(2, 0)], directs: [] })).toBe("quiet")
    expect(drawerNews({ rooms: [room(2, 1)], directs: [] })).toBe("loud")
    expect(drawerNews({ rooms: [room(0, 0)], directs: [{ with: "atlas", unread: 1, last: 1 }] })).toBe("loud")
  })
})
