import { describe, expect, test } from "bun:test"
import { MAX_BODY_LENGTH } from "@kiwi/core/protocol.ts"
import { attached, backWords, composerKey, drafts, giveBack, keptDrafts, tooLong } from "~/chat/drafts"
import type { Upload } from "~/model"

const image: Upload = { name: "a.png", mime: "image/png", data: "AAAA" }

describe("giveBack", () => {
  test("an empty composer gets the text and the images back", () => {
    const key = composerKey("c1", { kind: "room", room: "general" })
    const stashed: string[] = []
    expect(giveBack(key, "the long message", [image], (_k, t) => stashed.push(t))).toBe("composer")
    expect(drafts.get(key)).toBe("the long message")
    expect(attached.get(key)).toEqual([image])
    expect(stashed).toEqual([])
  })

  test("a composer with new text keeps it, and the refused message goes to the stash", () => {
    const key = composerKey("c2", { kind: "dm", with: "owl" }, 12)
    drafts.set(key, "something new")
    const stashed: [string, string][] = []
    expect(giveBack(key, "the long message", [], (k, t) => stashed.push([k, t]))).toBe("stash")
    expect(drafts.get(key)).toBe("something new")
    expect(stashed).toEqual([[key, "the long message"]])
  })

  test("a composer holding only images counts as busy too", () => {
    const key = composerKey("c3", { kind: "task", task: 4 })
    attached.set(key, [image])
    expect(giveBack(key, "text", [], () => {})).toBe("stash")
  })

  test("the key matches the composer's: channel, place and thread", () => {
    expect(composerKey("c", { kind: "room", room: "general" })).toBe('c:{"kind":"room","room":"general"}:')
    expect(composerKey("c", { kind: "room", room: "general" }, 7)).toBe('c:{"kind":"room","room":"general"}:7')
  })
})

describe("tooLong", () => {
  test("names the length, how much is over and the limit", () => {
    expect(tooLong("x".repeat(MAX_BODY_LENGTH))).toBeNull()
    expect(tooLong("x".repeat(MAX_BODY_LENGTH + 1234))).toBe("Too long to send: 101,234 characters, 1,234 over the 100,000 limit")
  })
})

describe("backWords", () => {
  test("says where the message went, and when images couldn't come along", () => {
    expect(backWords("too big", "composer", 2)).toBe("Not sent: too big. It's back in the composer.")
    expect(backWords("too big", "stash", 0)).toBe("Not sent: too big. It's in the stash: ⇧⌘S brings it back.")
    expect(backWords("too big", "stash", 1)).toBe("Not sent: too big. It's in the stash: ⇧⌘S brings it back; its image didn't fit in the stash.")
  })
})

describe("a draft survives the window reloading", () => {
  const shelf = () => {
    const box = new Map<string, string>()
    return { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v), removeItem: (k: string) => void box.delete(k), box }
  }

  test("what was typed is there after a reload, per composer", () => {
    const on = shelf()
    const before = keptDrafts(on)
    const general = composerKey("c9", { kind: "room", room: "general" })
    const dm = composerKey("c9", { kind: "dm", with: "owl" })
    before.set(general, "half a thought")
    before.set(dm, "for owl")
    const after = keptDrafts(on)
    expect(after.get(general)).toBe("half a thought")
    expect(after.get(dm)).toBe("for owl")
  })

  test("a sent or cleared draft doesn't come back", () => {
    const on = shelf()
    const before = keptDrafts(on)
    const key = composerKey("c9", { kind: "room", room: "general" })
    before.set(key, "sent soon")
    before.set(key, "")
    expect(keptDrafts(on).has(key)).toBe(false)
    expect(on.box.size).toBe(0)
  })

  test("junk or no storage starts empty", () => {
    const on = shelf()
    on.setItem("kiwi:drafts", "{not json")
    expect(keptDrafts(on).size).toBe(0)
    expect(keptDrafts(null).set("k", "v").get("k")).toBe("v")
  })
})
