import { describe, expect, test } from "bun:test"

import type { Message } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state/types.ts"
import { roomMessages } from "~/mods/read"

const msg = (seq: number, room: string | undefined, body: string, extra: Partial<Message> = {}): Message =>
  ({ v: 1, id: `m${seq}`, from: "ana", kind: "msg", body, ts: seq * 1000, rts: seq * 1000 + 1, seq, sigOk: true, ...(room ? { room } : {}), ...extra }) as unknown as Message

const stateWith = (over: Partial<Record<"rooms" | "roomOf" | "trust" | "deleted" | "edits", Map<unknown, unknown>>> = {}): ChannelState =>
  ({ rooms: new Map([["ops", { id: "ops" }], ["dm-ana-bo", { id: "dm-ana-bo", dm: true }]]), roomOf: new Map(), trust: new Map(), deleted: new Map(), edits: new Map(), ...over }) as unknown as ChannelState

describe("what a mod reads in a room (T8545)", () => {
  test("only that room's messages, oldest first, with author, text and the relay's time", () => {
    const messages = [msg(1, undefined, "in general"), msg(2, "ops", "deploy at 5"), msg(3, "secret", "not for the mod"), msg(4, "ops", "done")]
    expect(roomMessages(stateWith(), messages, "ops")).toEqual([
      { id: 2, author: "ana", text: "deploy at 5", at: 2001 },
      { id: 4, author: "ana", text: "done", at: 4001 },
    ])
    expect(roomMessages(stateWith(), messages, "general").map((m) => m.id)).toEqual([1])
  })

  test("a message moved to another room follows it, and edits show their newest text", () => {
    const state = stateWith({ roomOf: new Map([[2, "secret"]]), edits: new Map([[4, { body: "done, all green", at: 5, seq: 5 }]]) })
    expect(roomMessages(state, [msg(2, "ops", "deploy at 5"), msg(4, "ops", "done")], "ops")).toEqual([{ id: 4, author: "ana", text: "done, all green", at: 4001 }])
  })

  test("events, deleted, unsigned and empty messages never reach it, nor a direct-message room", () => {
    const state = stateWith({ deleted: new Map([[3, 9]]) })
    const messages = [msg(1, "ops", "a task moved", { kind: "event" }), msg(2, "ops", "forged", { sigOk: false }), msg(3, "ops", "taken back"), msg(4, "ops", "   "), msg(5, "ops", "kept")]
    expect(roomMessages(state, messages, "ops").map((m) => m.id)).toEqual([5])
    expect(roomMessages(state, [msg(6, "dm-ana-bo", "just us")], "dm-ana-bo")).toEqual([])
  })

  test("the last 50 of the room", () => {
    const many = Array.from({ length: 80 }, (_, i) => msg(i + 1, "ops", `line ${i + 1}`))
    const got = roomMessages(stateWith(), many, "ops")
    expect(got).toHaveLength(50)
    expect(got[0]!.id).toBe(31)
    expect(got.at(-1)!.id).toBe(80)
  })
})
