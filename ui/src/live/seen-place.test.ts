import { describe, expect, test } from "bun:test"
import type { Message } from "@kiwi/core/protocol.ts"
import { dmPlace, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import { directsOf } from "~/live/map"
import { lastIn, seenKeyOf } from "~/live/seen-place"

const seat = (name: string, user: string, handle: string) => [name, { name, pk: `pk-${name}`, kind: "human", active: true, owner: false, sponsor: { user, name: handle, handle } }] as const
const members = new Map([seat("jow", "p-jow", "jow"), seat("jow-2", "p-jow", "jow"), seat("tia", "p-tia", "tia"), seat("ana", "p-ana", "ana")])
const sealed = {
  id: "ours",
  name: "",
  createdBy: null,
  at: 0,
  dm: true,
  members: [
    { name: "jow", pk: "pk-jow" },
    { name: "jow-2", pk: "pk-jow-2" },
    { name: "tia", pk: "pk-tia" },
  ],
}
const state = (roomOf: [number, string][], placeOf: [number, unknown][] = []) =>
  ({ members, rooms: new Map([["ours", sealed]]), roomOf: new Map(roomOf), placeOf: new Map(placeOf), places: new Map(), trust: { get: () => "verified" } }) as unknown as ChannelState
const said = (seq: number, from: string, more: Partial<Message> = {}) => ({ seq, from, kind: "msg", ts: seq, body: "hi", ...more }) as unknown as Message
const unreadWith = (s: ChannelState, messages: Message[], me: string, seen: Record<string, number>) => directsOf(s, messages, me, seen).find((d) => d.with === "tia")?.unread

describe("reading a DM clears its badge (T1747)", () => {
  test("a sealed DM, read on a person's second device", () => {
    const s = state([[5, "ours"]])
    const messages = [said(5, "tia", { room: "ours" })]
    const where = { kind: "dm", with: "tia" } as const
    expect(unreadWith(s, messages, "jow-2", {})).toBe(1)
    const last = lastIn(messages, s, "jow-2", where)
    expect(last).toBe(5)
    expect(unreadWith(s, messages, "jow-2", { [seenKeyOf(s, where, "jow-2")]: last })).toBe(0)
  })

  test("an older DM that isn't sealed, read on the second device", () => {
    const place = dmPlace("jow", "tia")
    const s = state([], [[7, place]])
    const messages = [said(7, "tia")]
    const where = { kind: "dm", with: "tia" } as const
    expect(seenKeyOf(s, where, "jow-2")).toBe(placeKey(place))
    expect(lastIn(messages, s, "jow-2", where)).toBe(7)
    expect(unreadWith(s, messages, "jow-2", { [seenKeyOf(s, where, "jow-2")]: 7 })).toBe(0)
  })

  test("another pair's sealed room doesn't count as this DM", () => {
    const other = {
      ...sealed,
      id: "theirs",
      members: [
        { name: "tia", pk: "pk-tia" },
        { name: "ana", pk: "pk-ana" },
      ],
    }
    const s = { ...state([[9, "theirs"]]), rooms: new Map([["theirs", other]]) } as unknown as ChannelState
    expect(lastIn([said(9, "tia", { room: "theirs" })], s, "jow", { kind: "dm", with: "tia" })).toBe(0)
  })
})
