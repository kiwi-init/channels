import { describe, expect, test } from "bun:test"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { joinCodeFromLink } from "@kiwi/app/deep-link.ts"
import { encodeJoinCode, newRoomId } from "@kiwi/core/crypto.ts"
import { channelLink, drawerNews, heardHeads, lastWorth, messageLink, messageOfLink, noteBody, noteTitle, wirePlace, worthTelling } from "~/live/notify"
import { findWanted } from "~/live/open-message"
import type { Message } from "~/model"

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

describe("what a notification says and opens (#1351)", () => {
  test("the title names the room, the task or a direct message", () => {
    expect(noteTitle(msg({}), "jow", "lead", "ops", wirePlace(msg({})))).toBe("lead in ops · #general")
    expect(noteTitle(msg({ room: "releases" }), "jow", "lead", "ops", { kind: "room", name: "Releases" })).toBe("lead in ops · #Releases")
    expect(noteTitle(msg({ task: 12 }), "jow", "lead", "ops", wirePlace(msg({ task: 12 })))).toBe("lead in ops · T12")
    expect(noteTitle(msg({ dm: true }), "jow", "lead", "ops", wirePlace(msg({ dm: true })))).toBe("lead in ops · a direct message")
  })

  test("a decision put to you, or escalated, says it needs you; a plain message or a permission prompt does not", () => {
    const place = wirePlace(msg({ task: 3 }))
    expect(noteTitle(msg({ kind: "ask", to: ["jow"] }), "jow", "lead", "ops", place)).toBe("lead needs you in ops · T3")
    expect(noteTitle(msg({ kind: "blocking", esc: true }), "jow", "lead", "ops", place)).toBe("lead needs you in ops · T3")
    expect(noteTitle(msg({ to: ["jow"] }), "jow", "lead", "ops", place)).toBe("lead in ops · T3")
    expect(noteTitle(msg({ kind: "ask", to: ["maya"] }), "jow", "lead", "ops", place)).toBe("lead in ops · T3")
  })

  test("the body is plain text, without markdown or code blocks, cut at a word", () => {
    const body = "**OPS-12: cards 1 and 2** (merged at 82f865f). Until card 2 runs, `deploy.sh` refuses.\n**1. Memory reading**\n```sh\nsystemctl show x\n```"
    expect(noteBody(body)).toBe("OPS-12: cards 1 and 2 (merged at 82f865f). Until card 2 runs, deploy.sh refuses. 1. Memory reading")
    const long = noteBody("word ".repeat(80))
    expect(long.length).toBeLessThanOrEqual(200)
    expect(long.endsWith("word…")).toBe(true)
    expect(noteBody("x".repeat(300)).length).toBe(200)
  })

  test("View carries the message; the link still opens its channel", () => {
    expect(messageLink("mc2-abc", 42)).toBe("kiwi://join/mc2-abc?m=42")
    expect(messageOfLink(messageLink("mc2-abc", 42))).toBe(42)
    expect(messageOfLink(channelLink("mc2-abc"))).toBeNull()
    expect(messageOfLink("kiwi://join/mc2-abc?m=0")).toBeNull()
    expect(messageOfLink("kiwi://join/mc2-abc?m=4x")).toBeNull()
    const code = encodeJoinCode({ roomId: newRoomId(), ownerFp: "A".repeat(16) })
    expect(joinCodeFromLink(messageLink(code, 42))).toBe(code)
  })

  test("the channel finds the message once it has loaded it, and knows when it never will", () => {
    const m = (seq: number): Message => ({ seq, from: "lead", at: seq, text: "hi", where: { kind: "task", task: 3 } }) as Message
    const want = { code: "mc2-abc", seq: 7 }
    expect(findWanted(null, "mc2-abc", [m(7)], false)).toEqual({ kind: "none" })
    expect(findWanted(want, "mc2-other", [m(7)], false)).toEqual({ kind: "none" })
    expect(findWanted(want, "mc2-abc", [], true)).toEqual({ kind: "waiting" })
    expect(findWanted(want, "mc2-abc", [m(6)], false)).toEqual({ kind: "missing" })
    expect(findWanted(want, "mc2-abc", [m(6), m(7)], false)).toEqual({ kind: "found", m: m(7) })
  })
})
