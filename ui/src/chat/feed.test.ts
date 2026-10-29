import { describe, expect, test } from "bun:test"
import { DEMO_CHANNEL } from "~/demo/data"
import { longFeed } from "~/demo/long"
import { keepSame, same } from "~/live/keep"
import type { Message } from "~/model"

const general = { kind: "room", room: "general" } as const
const msg = (seq: number, extra: Partial<Message> = {}): Message => ({ seq, from: "atlas", at: seq * 1000, text: `message ${seq}`, where: general, ...extra })

describe("rows keep their message objects across live updates", () => {
  test("same compares plain data deeply", () => {
    expect(same({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(true)
    expect(same({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] })).toBe(false)
    expect(same({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(same([1, 2], { 0: 1, 1: 2 })).toBe(false)
  })

  test("an unchanged list comes back as the same array", () => {
    const prev = [msg(1), msg(2)]
    expect(keepSame(prev, [msg(1), msg(2)])).toBe(prev)
  })

  test("a new message keeps every older object and adds the new one", () => {
    const prev = [msg(1), msg(2)]
    const next = keepSame(prev, [msg(1), msg(2), msg(3)])
    expect(next).not.toBe(prev)
    expect(next[0]).toBe(prev[0] as Message)
    expect(next[1]).toBe(prev[1] as Message)
    expect(next[2]?.seq).toBe(3)
  })

  test("a reaction replaces only the message it landed on", () => {
    const prev = [msg(1), msg(2)]
    const next = keepSame(prev, [msg(1), msg(2, { reactions: [{ emoji: "👍", by: ["jow"] }] })])
    expect(next[0]).toBe(prev[0] as Message)
    expect(next[1]).not.toBe(prev[1] as Message)
    expect(next[1]?.reactions?.[0]?.emoji).toBe("👍")
  })
})

describe("the long-feed demo", () => {
  const channel = longFeed(DEMO_CHANNEL)
  const room = channel.messages.filter((m) => m.where.kind === "room" && m.where.room === "general")

  test("is the same 1500 messages every time, oldest first", () => {
    expect(room.length).toBeGreaterThan(1500)
    expect(longFeed(DEMO_CHANNEL).messages.map((m) => m.text)).toEqual(channel.messages.map((m) => m.text))
    const generated = room.slice(0, 1500)
    expect(generated.every((m, i) => i === 0 || m.at >= (generated[i - 1]?.at ?? 0))).toBe(true)
  })

  test("mixes what a busy channel carries", () => {
    const seqs = new Set(channel.messages.map((m) => m.seq))
    expect(room.some((m) => m.text.includes("| ---"))).toBe(true)
    expect(room.some((m) => m.text.includes("```"))).toBe(true)
    const oldest = Math.min(...seqs)
    expect(room.filter((m) => m.replyTo !== undefined).every((m) => seqs.has(m.replyTo ?? -1) || (m.replyTo ?? 0) < oldest)).toBe(true)
    expect(room.filter((m) => m.replyTo !== undefined).length).toBeGreaterThan(100)
    expect(room.filter((m) => m.mentionsYou).length).toBeGreaterThan(20)
    expect(room.filter((m) => m.images?.length).length).toBeGreaterThan(3)
    expect(room.filter((m) => m.prs?.length).length).toBeGreaterThan(20)
    expect(room.filter((m) => m.system).length).toBeGreaterThan(10)
  })
})
