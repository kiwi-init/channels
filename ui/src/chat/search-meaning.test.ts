import { describe, expect, test } from "bun:test"

import { meaningPool } from "~/chat/search-hits"
import type { Channel, Message, OlderHit } from "~/model"
import { wrote } from "~/words"

const room = { kind: "room", room: "general" } as const
const msg = (seq: number, text: string, extra: Partial<Message> = {}): Message => ({ seq, from: "ana", at: seq, text: wrote(text), where: room, ...extra }) as Message
const channel = (messages: Message[]) =>
  ({ messages, nicknames: new Map([["ana", "Ana"]]), rooms: [{ id: "general", name: "general" }] }) as unknown as Pick<Channel, "messages" | "nicknames" | "rooms">

describe("Jev reads the newest messages first, then older keyword hits", () => {
  test("newest first, with names and places spelled out, and no blanks, drafts or system lines", () => {
    const pool = meaningPool(channel([msg(1, "first"), msg(3, "third"), msg(2, "  "), msg(4, "draft", { pending: true }), msg(5, "joined", { system: true })]), [])
    expect(pool.items).toEqual([
      { id: 3, from: "Ana", where: "# general", text: "third" },
      { id: 1, from: "Ana", where: "# general", text: "first" },
    ])
    expect(pool.hits.get(3)).toMatchObject({ kind: "message" })
  })

  test("an older hit already in view is not sent twice, and long text is cut", () => {
    const older: OlderHit[] = [
      { seq: 3, from: "ana", text: "third", at: 3, where: room },
      { seq: 2, from: "bo", text: "x".repeat(700), at: 0, where: room },
    ]
    const pool = meaningPool(channel([msg(3, "third")]), older)
    expect(pool.items.map((i) => i.id)).toEqual([3, 2])
    expect(pool.items[1]!.text).toHaveLength(600)
    expect(pool.hits.get(2)).toMatchObject({ kind: "older" })
  })

  test("at most 120 recent messages, 160 in all", () => {
    const many = Array.from({ length: 200 }, (_, i) => msg(i + 1, `m${i}`))
    const older = Array.from({ length: 100 }, (_, i): OlderHit => ({ seq: -i - 1, from: "ana", text: `o${i}`, at: 0, where: room }))
    const pool = meaningPool(channel(many), older)
    expect(pool.items).toHaveLength(160)
    expect(pool.items.filter((i) => i.id > 0)).toHaveLength(120)
  })
})
