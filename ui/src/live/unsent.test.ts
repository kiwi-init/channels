import { afterEach, describe, expect, test } from "bun:test"
import { wordsRaw } from "~/words"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { inFeed, postedBlocks } from "~/chat/doc/posted"
import { messagesOf, type Pending } from "~/live/map"
import { capUnsent, changeUnsent, nextUnsentKey, resendDue, resendOf, restoreUnsent, retryUnsent, unsentIn } from "~/live/unsent"

const where: Pending["where"] = { kind: "room", room: "general" }
const pending = (key: number, text: string, failed?: string): Pending => ({ key, where, text, at: 1, ...(failed ? { failed } : {}) })

describe("unsent messages outlive the open channel (T946)", () => {
  test("a failed message is still there when its channel opens again", () => {
    const key = nextUnsentKey()
    changeUnsent("room-a", (list) => [...list, pending(key, "the deploy is done", "offline")])
    expect(unsentIn("room-a").map((p) => [p.text, p.failed])).toEqual([["the deploy is done", "offline"]])
    expect(unsentIn("room-b")).toEqual([])
    changeUnsent("room-a", (list) => list.filter((p) => p.key !== key))
    expect(unsentIn("room-a")).toEqual([])
  })

  test("keys stay unique across channels and remounts", () => {
    const a = nextUnsentKey()
    const b = nextUnsentKey()
    expect(b).toBeGreaterThan(a)
  })
})

describe("retrying a failed doc line keeps its block (T1465)", () => {
  const roster: Roster = [{ name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human" }]
  const pictures = { get: () => ({ spot: "", alt: "", state: "waiting" as const }) }
  const block = { th: "th1", id: "b1" }
  const places = (list: Pending[]) => {
    const rows = messagesOf(fold([], roster, 0), [], "jow", new Map(), pictures, list)
    const posted = postedBlocks(rows)
    return { feed: rows.filter((m) => inFeed(m, true)).map((m) => wordsRaw(m.text)), fromDoc: posted.has(block.id) ? [] : [block.id] }
  }

  test("the retried line keeps everything it was sent with, its block too", () => {
    const failed: Pending = { key: 1, where, text: "ship it", at: 1, failed: "offline", inThread: 7, replyTo: 5, block }
    expect(resendOf(failed)).toEqual({ inThread: 7, replyTo: 5, block })
  })

  test("the line shows in one place before, during and after the retry", () => {
    const failed: Pending = { key: 1, where, text: "ship it", at: 1, failed: "offline", block }
    expect(places([failed])).toEqual({ feed: ["ship it"], fromDoc: [] })
    const again = resendOf(failed)
    const retrying: Pending = { key: 2, where, text: failed.text, at: 2, ...again }
    expect(places([retrying])).toEqual({ feed: [], fromDoc: [block.id] })
    expect(places([{ ...retrying, failed: "offline" }])).toEqual({ feed: ["ship it"], fromDoc: [] })
  })
})

describe("retrying a comment that failed to send (T2680)", () => {
  const image = { name: "board.png", mime: "image/png", data: "iVBORw0KGgo=" }
  const spec = { kind: "room", room: "general" } as Pending["where"]
  const failed: Pending = { key: 3, where: spec, text: "the dialog I have in mind", at: 1, failed: "offline", inThread: 150, images: [image] }

  test("it posts once, to the spec's thread, carrying its image", async () => {
    const posts: unknown[] = []
    const dropped: number[] = []
    const seq = await retryUnsent(
      [pending(1, "other"), failed],
      3,
      (key) => void dropped.push(key),
      async (where, text, extras) => {
        posts.push({ where, text, extras })
        return 9
      }
    )
    expect(seq).toBe(9)
    expect(dropped).toEqual([3])
    expect(posts).toEqual([{ where: spec, text: "the dialog I have in mind", extras: { inThread: 150, images: [image] } }])
  })

  test("a retry that fails again is posted once and hands the error back", async () => {
    let posts = 0
    const tried = retryUnsent(
      [failed],
      3,
      () => {},
      async () => {
        posts += 1
        throw new Error("offline")
      }
    )
    await expect(tried).rejects.toThrow("offline")
    expect(posts).toBe(1)
  })

  test("a comment already gone isn't posted", async () => {
    let posts = 0
    await expect(
      retryUnsent(
        [],
        3,
        () => {},
        async () => ++posts
      )
    ).rejects.toThrow("that message is gone")
    expect(posts).toBe(0)
  })
})

describe("a failed message outlives a restart, a reload or a UI swap (T1755)", () => {
  const image = { name: "board.png", mime: "image/png", data: "iVBORw0KGgo=" }
  const disk = (room = 1_000_000) => {
    const held = new Map<string, string>()
    return {
      held,
      getItem: (k: string) => held.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > room) throw new Error("QuotaExceededError")
        held.set(k, v)
      },
    }
  }
  afterEach(() => restoreUnsent(null))

  test("it comes back with its words, where it was going, its reply and its image", () => {
    const on = disk()
    restoreUnsent(on)
    const key = nextUnsentKey()
    const failed: Pending = { key, where: { kind: "dm", with: "maya" }, text: "the deploy is done", at: 5, failed: "offline", inThread: 7, replyTo: 5, images: [image], block: { th: "th1", id: "b1" } }
    changeUnsent("room-a", (list) => [...list, failed])
    restoreUnsent(on)
    expect(unsentIn("room-a")).toEqual([failed])
    expect(nextUnsentKey()).toBeGreaterThan(key)
  })

  test("a message still on its way or already landed isn't brought back, so it can't post twice", () => {
    const on = disk()
    restoreUnsent(on)
    changeUnsent("room-a", () => [pending(1, "on its way"), { ...pending(2, "landed"), seq: 40 }, pending(3, "failed", "offline")])
    restoreUnsent(on)
    expect(unsentIn("room-a").map((p) => p.text)).toEqual(["failed"])
  })

  test("discarding or sending it clears it from the disk too", () => {
    const on = disk()
    restoreUnsent(on)
    changeUnsent("room-a", () => [pending(1, "failed", "offline")])
    changeUnsent("room-a", (list) => list.filter((p) => p.key !== 1))
    restoreUnsent(on)
    expect(unsentIn("room-a")).toEqual([])
  })

  test("a full disk keeps the words and says the images are gone", () => {
    const on = disk(200)
    restoreUnsent(on)
    changeUnsent("room-a", () => [{ ...pending(1, "see the board", "offline"), images: [{ ...image, data: "A".repeat(500) }] }])
    restoreUnsent(on)
    expect(unsentIn("room-a")).toEqual([{ ...pending(1, "see the board", "offline"), images: [], lostImages: true }])
  })

  test("junk on the disk is no failed messages, never a crash", () => {
    for (const junk of ["{", "[1]", JSON.stringify({ "room-a": [{ key: "1", text: 2 }, null, { ...pending(4, "x", "offline"), where: { kind: "theirs" } }] })]) {
      const on = disk()
      on.held.set("kiwi:unsent", junk)
      restoreUnsent(on)
      expect(unsentIn("room-a")).toEqual([])
    }
  })

  test("the cap drops the oldest landed lines, never a failed one or one on its way", () => {
    const list = [pending(1, "failed", "offline"), { ...pending(2, "landed"), seq: 40 }, pending(3, "on its way"), { ...pending(4, "landed too"), seq: 41 }, pending(5, "new")]
    expect(capUnsent(list, 3).map((p) => p.key)).toEqual([1, 3, 5])
    expect(capUnsent(list, 4).map((p) => p.key)).toEqual([1, 3, 4, 5])
    expect(capUnsent(list, 1).map((p) => p.key)).toEqual([1, 3, 5])
  })
})

describe("failed messages send themselves when the connection is back (T1755)", () => {
  const NOW = 10 * 60 * 60_000
  const at = (key: number, text: string, failed: string, ago = 60_000): Pending => ({ ...pending(key, text, failed), at: NOW - ago })
  const sends = (room: string, fail: (key: number) => unknown = () => null) => {
    const sent: number[] = []
    const retry = async (key: number): Promise<number> => {
      sent.push(key)
      const err = fail(key)
      if (err) throw err
      changeUnsent(room, (list) => list.filter((p) => p.key !== key))
      return key
    }
    return { sent, retry }
  }
  afterEach(() => restoreUnsent(null))

  test("each recent one is sent once, oldest first; lines on their way are left alone", async () => {
    changeUnsent("r1", () => [at(1, "first", "offline"), pending(2, "on its way"), at(3, "second", "offline")])
    const { sent, retry } = sends("r1")
    await resendDue("r1", NOW, retry)
    expect(sent).toEqual([1, 3])
    expect(unsentIn("r1").map((p) => p.key)).toEqual([2])
  })

  test("an old one, one over today's limit and one that lost its images wait for your Retry", async () => {
    changeUnsent("r2", () => [
      at(1, "from yesterday", "offline", 2 * 60 * 60_000),
      at(2, "over", "you've sent today's 1,000 messages"),
      { ...at(3, "no picture", "offline"), lostImages: true as const },
      at(4, "fresh", "offline"),
    ])
    const { sent, retry } = sends("r2")
    await resendDue("r2", NOW, retry)
    expect(sent).toEqual([4])
  })

  test("still offline: it stops at the first failure and the rest wait for the next reconnect", async () => {
    changeUnsent("r3", () => [at(1, "first", "offline"), at(2, "second", "offline")])
    const { sent, retry } = sends("r3", () => new Error("offline"))
    await resendDue("r3", NOW, retry)
    expect(sent).toEqual([1])
  })

  test("a refused one doesn't hold back the next", async () => {
    changeUnsent("r4", () => [at(1, "too long", "offline"), at(2, "fine", "offline")])
    const { sent, retry } = sends("r4", (key) => (key === 1 ? { _tag: "Rejected", message: "too long" } : null))
    await resendDue("r4", NOW, retry)
    expect(sent).toEqual([1, 2])
  })

  test("two reconnects in a row don't send the same message twice", async () => {
    changeUnsent("r5", () => [at(1, "first", "offline"), at(2, "second", "offline")])
    const { sent, retry } = sends("r5")
    await Promise.all([resendDue("r5", NOW, retry), resendDue("r5", NOW, retry)])
    expect(sent).toEqual([1, 2])
  })
})
