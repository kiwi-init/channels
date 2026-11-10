import { describe, expect, test } from "bun:test"
import { MAX_BODY_LENGTH } from "@kiwi/core/protocol.ts"
import { attached, backWords, composerKey, drafts, giveBack, keptAttached, keptDrafts, tooLong, type FileShelf } from "~/chat/drafts"
import type { Upload } from "~/model"
import { keysHint } from "~/kit/keys"

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
    expect(backWords("too big", "stash", 0)).toBe(`Not sent: too big. It's in the stash: ${keysHint("S", true)} brings it back.`)
    expect(backWords("too big", "stash", 1)).toBe(`Not sent: too big. It's in the stash: ${keysHint("S", true)} brings it back; its image didn't fit in the stash.`)
  })
})

const shelf = () => {
  const box = new Map<string, string>()
  let writes = 0
  return {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes++
      box.set(k, v)
    },
    removeItem: (k: string) => void box.delete(k),
    box,
    writes: () => writes,
  }
}

describe("a draft survives a quit, an update or a crash (T1756)", () => {
  test("what was typed is there after a restart, per composer", () => {
    const on = shelf()
    const before = keptDrafts(on)
    const general = composerKey("c9", { kind: "room", room: "general" })
    const dm = composerKey("c9", { kind: "dm", with: "owl" })
    before.set(general, "half a thought")
    before.set(dm, "for owl")
    before.flush()
    const after = keptDrafts(on)
    expect(after.get(general)).toBe("half a thought")
    expect(after.get(dm)).toBe("for owl")
  })

  test("a sent or cleared draft doesn't come back", () => {
    const on = shelf()
    const before = keptDrafts(on)
    const key = composerKey("c9", { kind: "room", room: "general" })
    before.set(key, "sent soon")
    before.flush()
    before.set(key, "")
    before.flush()
    expect(keptDrafts(on).has(key)).toBe(false)
    expect(on.box.size).toBe(0)
  })

  test("junk or no storage starts empty", () => {
    const on = shelf()
    on.setItem("kiwi:drafts", "{not json")
    expect(keptDrafts(on).size).toBe(0)
    expect(keptDrafts(null).set("k", "v").get("k")).toBe("v")
  })

  test("a draft typed before the update, in the old session store, is carried over once", () => {
    const on = shelf()
    const old = shelf()
    old.setItem("kiwi:drafts", JSON.stringify({ a: "from the old store", b: "old b" }))
    on.setItem("kiwi:drafts", JSON.stringify({ b: "newer b" }))
    const now = keptDrafts(on, 500, old)
    expect(now.get("a")).toBe("from the old store")
    expect(now.get("b")).toBe("newer b")
    expect(old.box.size).toBe(0)
    expect(keptDrafts(on).get("a")).toBe("from the old store")
  })
})

describe("typing doesn't write storage on every key (issue 2069)", () => {
  test("a burst of keys is one write, a little later", async () => {
    const on = shelf()
    const kept = keptDrafts(on, 10)
    for (const text of ["h", "he", "hel", "hell", "hello"]) kept.set("k", text)
    expect(kept.get("k")).toBe("hello")
    expect(on.writes()).toBe(0)
    await new Promise((r) => setTimeout(r, 40))
    expect(on.writes()).toBe(1)
    expect(keptDrafts(on).get("k")).toBe("hello")
  })

  test("leaving the page writes what is still waiting, once", () => {
    const on = shelf()
    const kept = keptDrafts(on)
    kept.set("k", "not yet on disk")
    kept.flush()
    kept.flush()
    expect(on.writes()).toBe(1)
    expect(keptDrafts(on).get("k")).toBe("not yet on disk")
  })
})

describe("saved drafts stay within a cap", () => {
  test("the 50 newest are kept, and typing in an old one makes it new again", () => {
    const on = shelf()
    const kept = keptDrafts(on)
    for (let i = 0; i < 60; i++) kept.set(`k${i}`, `draft ${i}`)
    kept.set("k3", "touched again")
    kept.flush()
    const after = keptDrafts(on)
    expect(after.size).toBe(50)
    expect(after.get("k3")).toBe("touched again")
    expect(after.has("k10")).toBe(false)
    expect(after.get("k59")).toBe("draft 59")
  })

  test("a draft too big for the budget stays in memory, and the others are still saved", () => {
    const on = shelf()
    const kept = keptDrafts(on)
    kept.set("small", "fits")
    kept.set("huge", "x".repeat(1_000_001))
    kept.flush()
    expect(kept.get("huge")?.length).toBe(1_000_001)
    const after = keptDrafts(on)
    expect(after.has("huge")).toBe(false)
    expect(after.get("small")).toBe("fits")
  })
})

describe("attached images survive a reload and a quit (T1756)", () => {
  const disk = () => {
    const rows = new Map<string, unknown>()
    const on: FileShelf = {
      all: async () => [...rows],
      put: async (key, kept) => void rows.set(key, kept),
      drop: async (key) => void rows.delete(key),
    }
    return { on, rows }
  }

  test("images attached before are back after a restart, and the composer is told", async () => {
    const { on } = disk()
    const before = keptAttached(on)
    before.set("k", [image])
    await before.settled()
    let told = 0
    const after = keptAttached(on, () => told++)
    expect(after.get("k")).toBeUndefined()
    await after.settled()
    expect(after.get("k")).toEqual([image])
    expect(told).toBe(1)
  })

  test("sent or removed images don't come back", async () => {
    const { on, rows } = disk()
    const before = keptAttached(on)
    before.set("k", [image])
    before.delete("k")
    await before.settled()
    expect(rows.size).toBe(0)
    const after = keptAttached(on)
    await after.settled()
    expect(after.has("k")).toBe(false)
  })

  test("what was attached or removed while the disk was still loading wins", async () => {
    const { on } = disk()
    const before = keptAttached(on)
    before.set("changed", [image])
    before.set("removed", [image])
    await before.settled()
    const newer: Upload = { name: "b.png", mime: "image/png", data: "BBBB" }
    const after = keptAttached(on)
    after.set("changed", [newer])
    after.delete("removed")
    await after.settled()
    expect(after.get("changed")).toEqual([newer])
    expect(after.has("removed")).toBe(false)
    const again = keptAttached(on)
    await again.settled()
    expect(again.get("changed")).toEqual([newer])
    expect(again.has("removed")).toBe(false)
  })

  test("only the 20 newest composers keep images, and junk rows are dropped", async () => {
    const { on, rows } = disk()
    const before = keptAttached(on)
    for (let i = 0; i < 25; i++) before.set(`k${i}`, [image])
    await before.settled()
    expect(rows.size).toBe(20)
    rows.set("junk", { files: "nope" })
    for (let i = 0; i < 5; i++) rows.set(`old${i}`, { files: [image], at: i })
    const after = keptAttached(on)
    await after.settled()
    expect(after.size).toBe(20)
    expect(after.has("k24")).toBe(true)
    expect(after.has("old0")).toBe(false)
    expect(rows.has("junk")).toBe(false)
    expect(rows.size).toBe(20)
  })

  test("a disk that refuses keeps the images in memory", async () => {
    const on: FileShelf = { all: () => Promise.reject(new Error("blocked")), put: () => Promise.reject(new Error("full")), drop: () => Promise.reject(new Error("full")) }
    const kept = keptAttached(on)
    kept.set("k", [image])
    await kept.settled()
    expect(kept.get("k")).toEqual([image])
  })
})
