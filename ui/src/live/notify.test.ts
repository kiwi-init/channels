import { describe, expect, test } from "bun:test"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { channelLink, drawerNews, heardHeads, lastWorth, worthTelling } from "~/live/notify"

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

describe("notifications for every channel (T657)", () => {
  const reads = () => {
    const done: string[] = []
    const gates: (() => void)[] = []
    const read = (code: string, after: number, upTo: number) => {
      done.push(`${code} ${after}..${upTo}`)
      return new Promise<void>((ok) => gates.push(ok))
    }
    const settle = async () => {
      while (gates.length) {
        gates.shift()?.()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      }
    }
    return { done, read, settle }
  }

  test("a channel's first head is where it starts: no backlog", async () => {
    const r = reads()
    const heads = heardHeads(() => false, r.read)
    heads.head("a", 40)
    heads.start("b", 10)
    heads.head("b", 12)
    await r.settle()
    expect(r.done).toEqual(["b 10..12"])
  })

  test("each new head reads only what came after the last one", async () => {
    const r = reads()
    const heads = heardHeads(() => false, r.read)
    heads.start("a", 5)
    heads.head("a", 6)
    await r.settle()
    heads.head("a", 6)
    heads.head("a", 4)
    heads.head("a", 9)
    await r.settle()
    expect(r.done).toEqual(["a 5..6", "a 6..9"])
  })

  test("heads during a read are caught up in one more read", async () => {
    const r = reads()
    const heads = heardHeads(() => false, r.read)
    heads.start("a", 1)
    heads.head("a", 2)
    heads.head("a", 3)
    heads.head("a", 4)
    await r.settle()
    expect(r.done).toEqual(["a 1..2", "a 2..4"])
  })

  test("the open channel, a focused window or none skip the read and move on", async () => {
    const r = reads()
    let skip = true
    const heads = heardHeads(() => skip, r.read)
    heads.start("a", 1)
    heads.head("a", 8)
    skip = false
    heads.head("a", 9)
    await r.settle()
    expect(r.done).toEqual(["a 8..9"])
  })

  test("the last message worth telling, never one whose signature fails", () => {
    const fresh = [msg({ seq: 1, to: ["jow"] }), msg({ seq: 2, body: "@jow" }), msg({ seq: 3, to: ["jow"], sigOk: false }), msg({ seq: 4 })]
    expect(lastWorth(fresh, "jow", "mentions", false)?.seq).toBe(2)
    expect(lastWorth(fresh, "jow", "none", false)).toBeNull()
    expect(lastWorth(fresh, "jow", "all", false)?.seq).toBe(4)
  })

  test("a click opens the channel through its join link", () => {
    expect(channelLink("mc2-abc")).toBe("kiwi://join/mc2-abc")
  })
})
