import { describe, expect, test } from "bun:test"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { followKey, followMark, followsOf, threadSeenKey, threadsOf } from "~/live/threads"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "maya", pk: "pk-maya", owner: false, at: 0, active: true, kind: "human", display: "Maya" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

let next = 0
const wire = (over: Partial<Wire>): Wire => {
  next++
  return { v: 1, id: `w${next}`, seq: next, from: "win", pk: `pk-${over.from ?? "win"}`, sigOk: true, kind: "msg", body: "hi", ts: next * 1000, rts: next * 1000, ...over } as Wire
}
const threads = (log: Wire[], seen: Record<string, number> = {}, me = "jow") => threadsOf(fold(log, roster, 0), log, me, seen, 0)

describe("following a thread (T2924)", () => {
  test("you follow what you started, replied in or were named in, and nothing else", () => {
    const started = wire({ from: "jow", body: "where does T10 stand?" })
    const startedReply = wire({ re: [started.seq], side: true, body: "close" })
    const joined = wire({ from: "maya", body: "release notes?" })
    const joinedReply = wire({ from: "jow", re: [joined.seq], side: true, body: "on it" })
    const named = wire({ from: "maya", body: "the icons" })
    const namedReply = wire({ re: [named.seq], side: true, body: "@jow they need your eyes" })
    const other = wire({ from: "maya", body: "lunch?" })
    const otherReply = wire({ re: [other.seq], side: true, body: "12:30" })
    const log = [started, startedReply, joined, joinedReply, named, namedReply, other, otherReply]
    const by = new Map(threads(log).map((t) => [t.root, t.following]))
    expect([by.get(started.seq), by.get(joined.seq), by.get(named.seq), by.get(other.seq)]).toEqual([true, true, true, false])
  })

  test("Follow and Unfollow win over what you'd follow anyway, and the latest one wins", () => {
    const mine = wire({ from: "jow", body: "ship it?" })
    const reply = wire({ re: [mine.seq], side: true, body: "yes" })
    const theirs = wire({ from: "maya", body: "lunch?" })
    const answer = wire({ re: [theirs.seq], side: true, body: "12:30" })
    const log = [mine, reply, theirs, answer]
    const off = followMark(undefined, 40, false)
    const on = followMark(undefined, 40, true)
    const by = new Map(threads(log, { [followKey(mine.seq)]: off, [followKey(theirs.seq)]: on }).map((t) => [t.root, t.following]))
    expect([by.get(mine.seq), by.get(theirs.seq)]).toEqual([false, true])
    const again = followMark(off, 40, true)
    expect([followsOf({ [followKey(1)]: again }, 1), again > off]).toEqual([true, true])
    expect(followsOf({ [followKey(1)]: followMark(again, 40, false) }, 1)).toBe(false)
    expect(followsOf({}, 1)).toBeNull()
  })

  test("a later Follow on another device outranks an earlier Unfollow when the marks merge by max", () => {
    const unfollowedEarly = followMark(undefined, 100, false)
    const followedLater = followMark(undefined, 120, true)
    expect(followsOf({ [followKey(7)]: Math.max(unfollowedEarly, followedLater) }, 7)).toBe(true)
  })

  test("unread counts others' replies after the thread was last seen, and what's for you", () => {
    const root = wire({ from: "jow", body: "T10?" })
    const seen = wire({ re: [root.seq], side: true, body: "first" })
    const fresh = wire({ re: [root.seq], side: true, body: "second" })
    const named = wire({ from: "maya", re: [root.seq], side: true, body: "@jow look" })
    const yours = wire({ from: "jow", re: [root.seq], side: true, body: "thanks" })
    const log = [root, seen, fresh, named, yours]
    const [t] = threads(log, { [threadSeenKey(root.seq)]: seen.seq })
    expect(t).toMatchObject({ root: root.seq, replies: 4, unread: 2, mentions: 1, lastSeq: yours.seq, people: ["win", "maya", "jow"] })
  })

  test("threads list newest activity first", () => {
    const older = wire({ from: "jow", body: "a" })
    const newer = wire({ from: "jow", body: "b" })
    const newerReply = wire({ re: [newer.seq], side: true })
    const olderReply = wire({ re: [older.seq], side: true })
    expect(threads([older, newer, newerReply, olderReply]).map((t) => t.root)).toEqual([older.seq, newer.seq])
  })
})
