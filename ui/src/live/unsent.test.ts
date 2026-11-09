import { describe, expect, test } from "bun:test"
import { wordsRaw } from "~/words"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { inFeed, postedBlocks } from "~/chat/doc/posted"
import { messagesOf, type Pending } from "~/live/map"
import { changeUnsent, nextUnsentKey, resendOf, retryUnsent, unsentIn } from "~/live/unsent"

const where = { kind: "main" } as Pending["where"]
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
