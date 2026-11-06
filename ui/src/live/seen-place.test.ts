import { describe, expect, test } from "bun:test"
import { roomSeenKey } from "@kiwi/app/rooms.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { dmPlace, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import { directsOf } from "~/live/map"
import { firstMarks, lastIn, seenByThread, seenKeyOf } from "~/live/seen-place"

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

describe("a fresh device starts caught up in members-only DMs (#1886)", () => {
  const roomState = (places: [string, unknown][] = []) => ({ ...state([[5, "ours"]]), places: new Map(places) }) as unknown as ChannelState

  test("the first-visit marks clear a read members-only DM on a person's second seat", () => {
    const s = roomState()
    const messages = [said(5, "tia", { room: "ours" })]
    const marks = firstMarks(s, messages, "jow-2")
    expect(marks[placeKey(dmPlace("jow", "tia"))]).toBe(5)
    expect(unreadWith(s, messages, "jow-2", marks)).toBe(0)
  })

  test("a message past the marks still counts", () => {
    const s = roomState()
    const messages = [said(5, "tia", { room: "ours" }), said(6, "tia", { room: "ours" })]
    expect(unreadWith(s, messages, "jow-2", firstMarks(s, [messages[0]!], "jow-2"))).toBe(1)
  })

  test("a true direct thread and a plain room keep their marks", () => {
    const place = dmPlace("jow", "tia")
    const direct = { ...state([], [[9, place]]), places: new Map([[placeKey(place), { place, last: 9, count: 1 }]]) } as unknown as ChannelState
    expect(firstMarks(direct, [said(9, "tia")], "jow")[placeKey(place)]).toBe(9)
    const plain = { ...state([[8, "r2"]]), rooms: new Map([["r2", { id: "r2", name: "two", createdBy: null, at: 0 }]]) } as unknown as ChannelState
    expect(firstMarks(plain, [said(8, "ana", { room: "r2" })], "jow")[roomSeenKey("r2")]).toBe(8)
  })
})

describe("a reply read in an open thread is read in its DM too (#1665)", () => {
  const place = dmPlace("jow", "tia")
  const threaded = (placeOf: [number, unknown][], threadOf: [number, number][]) => ({ ...state([], placeOf), threadOf: new Map(threadOf) }) as unknown as ChannelState

  test("opening the thread moves the DM's mark over the replies it shows", () => {
    const s = threaded(
      [
        [7, place],
        [8, place],
      ],
      [[8, 7]]
    )
    const messages = [said(7, "jow"), said(8, "tia", { re: [7] })]
    const seen = { [placeKey(place)]: 7 }
    expect(unreadWith(s, messages, "jow", seen)).toBe(1)
    const marks = seenByThread(messages, s, "jow", 7, seen)
    expect(marks).toEqual({ [placeKey(place)]: 8 })
    expect(unreadWith(s, messages, "jow", { ...seen, ...marks })).toBe(0)
  })

  test("with history before the thread not loaded, the DM's mark stays where it was", () => {
    const s = threaded(
      [
        [10, place],
        [11, place],
      ],
      [[11, 10]]
    )
    const messages = [said(10, "tia"), said(11, "tia", { re: [10] })]
    expect(seenByThread(messages, s, "jow", 10, { [placeKey(place)]: 7 })).toEqual({})
    expect(seenByThread(messages, s, "jow", 10, { [placeKey(place)]: 9 })).toEqual({ [placeKey(place)]: 11 })
  })

  test("a gap in the loaded history stops the mark, while known messages elsewhere are passed", () => {
    const s = threaded(
      [
        [7, place],
        [8, place],
        [10, place],
      ],
      [
        [8, 7],
        [10, 7],
      ]
    )
    const gap = [said(7, "jow"), said(8, "tia", { re: [7] }), said(10, "tia", { re: [7] })]
    expect(seenByThread(gap, s, "jow", 7, { [placeKey(place)]: 7 })).toEqual({ [placeKey(place)]: 8 })
    const elsewhere = { ...s, roomOf: new Map([[9, "general"]]) } as unknown as ChannelState
    const known = [said(7, "jow"), said(8, "tia", { re: [7] }), said(9, "ana", { room: "general" }), said(10, "tia", { re: [7] })]
    expect(seenByThread(known, elsewhere, "jow", 7, { [placeKey(place)]: 7 })).toEqual({ [placeKey(place)]: 10 })
  })

  test("a DM message outside the thread stays unread, and so does everything after it", () => {
    const s = threaded(
      [
        [7, place],
        [8, place],
        [9, place],
        [10, place],
      ],
      [
        [8, 7],
        [10, 7],
      ]
    )
    const messages = [said(7, "jow"), said(8, "tia", { re: [7] }), said(9, "tia"), said(10, "tia", { re: [7] })]
    const seen = { [placeKey(place)]: 7 }
    const marks = seenByThread(messages, s, "jow", 7, seen)
    expect(marks).toEqual({ [placeKey(place)]: 8 })
    expect(unreadWith(s, messages, "jow", { ...seen, ...marks })).toBe(2)
  })
})
