import { describe, expect, test } from "bun:test"

import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, folded, type ChannelState } from "@kiwi/core/state.ts"
import { rendered } from "~/live/rendered"
import { keptBoard, PER_MESSAGE, SEAT_COUNTERS } from "~/live/board"
import { groupsOf, historyOf, issuesOf, prsOf, tasksFrom } from "~/live/map"
import { freeOf, specsOf } from "~/live/specs"
import { rng, roster, SEC, stream, T0 } from "../../../test/fold-stream.ts"

const boardOf = (board: ChannelState, state: ChannelState, messages: readonly Wire[], me: string, now: number) => ({
  groups: groupsOf(board, me, now),
  tasks: tasksFrom(board, new Set(), me, historyOf(state, messages, me), now),
  specs: specsOf(board, me),
  free: freeOf(board),
  prs: prsOf(board),
  issues: issuesOf(board),
})

const ALLOWED: Record<string, (state: ChannelState, key: unknown) => boolean> = {
  placeOf: (state, key) => state.openAsks.some((m) => m.seq === key),
  askHeads: (state, key) => [...state.tasks.values()].some((t) => t.ask === key),
}

function audited(state: ChannelState, wrong: string[]): ChannelState {
  const watchMap = (name: string, map: ReadonlyMap<unknown, unknown>) =>
    new Proxy(map, {
      get(target, k) {
        const own = Reflect.get(target, k, target) as unknown
        if (k === "get" || k === "has") {
          return (key: unknown) => {
            if (!ALLOWED[name]?.(state, key)) wrong.push(`${name}.${k}(${String(key)})`)
            return (own as (key: unknown) => unknown).call(target, key)
          }
        }
        if (k !== "size") wrong.push(`${name}.${String(k)}`)
        return typeof own === "function" ? (own as () => unknown).bind(target) : own
      },
    })
  const members = new Map(
    [...state.members].map(([name, m]) => [
      name,
      new Proxy(
        { ...m },
        {
          get(target, f) {
            if (typeof f === "string" && SEAT_COUNTERS.has(f)) wrong.push(`members.${f}`)
            return Reflect.get(target, f)
          },
        }
      ),
    ])
  )
  return new Proxy(
    { ...state, members },
    {
      get(target, k) {
        const v = Reflect.get(target, k)
        if (typeof k !== "string" || !PER_MESSAGE.has(k) || k === "members") return v
        if (v instanceof Map && ALLOWED[k]) return watchMap(k, v)
        wrong.push(k)
        return v
      },
    }
  ) as ChannelState
}

describe("the task board is kept between chat messages (T17818)", () => {
  test("board functions read the per-message parts of the state only through the board key", () => {
    const wrong: string[] = []
    for (let seed = 1; seed <= 20; seed++) {
      const { messages, times } = stream(seed, 200)
      const now = times.at(-1)! + 60 * SEC
      const state = fold(messages, roster(seed % 2 ? undefined : T0 + 50 * SEC), now)
      boardOf(audited(state, wrong), state, messages, "jow", now)
      boardOf(audited(state, wrong), state, messages, "win", now)
    }
    expect([...new Set(wrong)]).toEqual([])
  })

  test("the audit catches a read outside the board key", () => {
    const { messages, times } = stream(1, 80)
    const wrong: string[] = []
    const state = audited(fold(messages, roster(), times.at(-1)!), wrong)
    void state.trust.get(1)
    void state.members.get("jow")?.lastSeen
    void state.placeOf.get(-1)
    expect(wrong).toEqual(["trust", "members.lastSeen", "placeOf.get(-1)"])
  })

  test("over seeded streams, the board from the kept state equals the board from the newest state", () => {
    let kept = 0
    let steps = 0
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed * 13)
      const { messages, times } = stream(seed, 160)
      const people = roster()
      let f = folded(messages.slice(0, 20), people, times[19]!)
      let board = keptBoard(null, f.state)
      for (let at = 20; at < messages.length;) {
        const batch = messages.slice(at, at + 1 + Math.floor(r() * 3))
        at += batch.length
        const now = times[at - 1]! + (r() < 0.2 ? 500 * SEC : 0)
        const held = messages.slice(0, at)
        const state = f.next(batch, now) ?? (f = folded(held, people, now)).state
        const was = board
        board = keptBoard(board, state)
        if (board === was) kept++
        const me = r() < 0.2 ? "win" : "jow"
        expect(rendered(boardOf(board.state, state, held, me, now))).toEqual(rendered(boardOf(state, state, held, me, now)))
        steps++
      }
    }
    expect(steps).toBeGreaterThan(500)
    expect(kept).toBeGreaterThan(50)
  }, 120_000)

  const start = () => {
    const { messages, times } = stream(3, 120)
    const f = folded(messages, roster(), times.at(-1)!)
    const task = [...f.state.tasks.values()].find((t) => t.state !== "done")!
    let seq = messages.at(-1)!.seq
    const chat = (over: Partial<Wire>): Wire =>
      ({ ...messages.at(-1)!, id: `x${++seq}`, seq, kind: "msg", body: `chat ${seq}`, from: "win", pk: "w".repeat(43), ts: times.at(-1)! + seq, rts: times.at(-1)! + seq, ...over }) as Wire
    return { f, task, chat, now: times.at(-1)! }
  }

  test("a chat message in a room keeps the board state, so the board memos hit", () => {
    const { f, chat, now } = start()
    const first = f.state
    const board = keptBoard(null, first)
    const next = f.next([chat({ room: "general" })], now + 1)!
    expect(next).not.toBe(first)
    expect(keptBoard(board, next)).toBe(board)
  })

  test("a chat in a task's thread builds the board again", () => {
    const { f, task, chat, now } = start()
    const first = f.state
    const board = keptBoard(null, first)
    const inTask = f.next([chat({ task: task.id })], now + 1)!
    expect(inTask.tasks.get(task.id)).not.toEqual(first.tasks.get(task.id))
    const after = keptBoard(board, inTask)
    expect(after).not.toBe(board)
    expect(after.state).toBe(inTask)
  })

  test("a chat message long after the last one rolls the timed tasks and builds the board again wherever they change", () => {
    let rolled = 0
    for (let seed = 1; seed <= 20; seed++) {
      const { messages, times } = stream(seed, 160)
      const f = folded(messages, roster(), times.at(-1)!)
      const first = f.state
      const board = keptBoard(null, first)
      const at = times.at(-1)! + 3 * 86_400_000
      const last = messages.at(-1)!
      const late = { ...last, id: `late-${seed}`, seq: last.seq + 1, kind: "msg", body: "late", from: "win", pk: "w".repeat(43), ts: at, rts: at, room: "general" } as Wire
      delete (late as Partial<Wire>).ev
      const later = f.next([late], at)
      if (!later) continue
      const after = keptBoard(board, later)
      if (later.tasks !== first.tasks) {
        rolled++
        expect(after).not.toBe(board)
      }
      expect(rendered(boardOf(after.state, later, [...messages, late], "jow", at))).toEqual(rendered(boardOf(later, later, [...messages, late], "jow", at)))
    }
    expect(rolled).toBeGreaterThan(0)
  })
})
