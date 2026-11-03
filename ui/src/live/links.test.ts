import { describe, expect, test } from "bun:test"
import { joinCodeFromLink } from "@kiwi/app/deep-link.ts"
import { encodeJoinCode, newRoomId } from "@kiwi/core/crypto.ts"
import { messageHash, messageLink } from "@kiwi/core/message-link.ts"
import { drawerNews, hashTarget, messageOfLink } from "~/live/links"
import { dropMessage, findWanted, openFromNote, wantedNow } from "~/live/open-message"
import type { Message } from "~/model"

describe("links to a message, and the drawer's news dot", () => {
  test("the narrow window's drawer button carries a dot for news in rooms and DMs", () => {
    const room = (unread: number, mentions: number) => ({ id: "general", name: "general", unread, mentions })
    expect(drawerNews({ rooms: [room(0, 0)], directs: [] })).toBeNull()
    expect(drawerNews({ rooms: [room(2, 0)], directs: [] })).toBe("quiet")
    expect(drawerNews({ rooms: [room(2, 1)], directs: [] })).toBe("loud")
    expect(drawerNews({ rooms: [room(0, 0)], directs: [{ with: "atlas", unread: 1, last: 1 }] })).toBe("loud")
  })

  test("View carries the message; the link still opens its channel", () => {
    expect(messageLink("mc2-abc", 42)).toBe("kiwi://join/mc2-abc?m=42")
    expect(messageOfLink(messageLink("mc2-abc", 42))).toBe(42)
    expect(messageOfLink("kiwi://join/mc2-abc")).toBeNull()
    expect(messageOfLink("kiwi://join/mc2-abc?m=0")).toBeNull()
    expect(messageOfLink("kiwi://join/mc2-abc?m=4x")).toBeNull()
    const code = encodeJoinCode({ roomId: newRoomId(), ownerFp: "A".repeat(16) })
    expect(joinCodeFromLink(messageLink(code, 42))).toBe(code)
  })

  test("the channel waits until its feed reaches the message, and only then calls it missing", () => {
    const m = (seq: number): Message => ({ seq, from: "lead", at: seq, text: "hi", where: { kind: "task", task: 3 } }) as Message
    const want = { code: "mc2-abc", seq: 7 }
    expect(findWanted(null, "mc2-abc", [m(7)])).toEqual({ kind: "none" })
    expect(findWanted(want, "mc2-other", [m(7)])).toEqual({ kind: "none" })
    expect(findWanted(want, "mc2-abc", [])).toEqual({ kind: "waiting" })
    expect(findWanted(want, "mc2-abc", [m(5), m(6)])).toEqual({ kind: "waiting" })
    expect(findWanted(want, "mc2-abc", [m(6), m(7)])).toEqual({ kind: "found", m: m(7) })
    expect(findWanted(want, "mc2-abc", [m(6), m(8)])).toEqual({ kind: "missing" })
  })

  test("a click always shows the channel first, from Settings or the same channel too, and only then asks for the message", () => {
    const steps: string[] = []
    const show = (code: string) => {
      steps.push(`show ${code} (wanted ${wantedNow()?.seq ?? "none"})`)
    }
    const was = wantedNow()
    if (was) dropMessage(was)
    openFromNote("mc2-abc", 42, show)
    expect(steps).toEqual(["show mc2-abc (wanted none)"])
    expect(wantedNow()).toEqual({ code: "mc2-abc", seq: 42 })
    const now = wantedNow()
    if (now) dropMessage(now)
  })

  test("the browser's hash carries the message the way the desktop link does", () => {
    expect(messageHash("mc2-abc", 42)).toBe("#mc2-abc?m=42")
    expect(hashTarget(messageHash("mc2-abc", 42))).toEqual({ hash: "#mc2-abc", seq: 42 })
    expect(hashTarget("#mc2-abc")).toEqual({ hash: "#mc2-abc", seq: null })
    expect(hashTarget("#mc2-abc?m=x")).toEqual({ hash: "#mc2-abc", seq: null })
  })
})
