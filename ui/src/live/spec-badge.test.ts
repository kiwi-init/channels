import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { messagesOf, roomsOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "dev", pk: "pk-dev", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const msg = (seq: number, from: string, body: string, re?: number): Wire =>
  ({ v: 1, id: `m${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "msg", body, ts: seq * 1000, ...(re !== undefined ? { re: [re] } : {}) }) as Wire
const ev = (seq: number, from: string, e: Event): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev: e, ts: seq * 1000 }) as Wire
const pictures = { get: () => ({ spot: "", alt: "", state: "waiting" as const }) }

const general = (log: Wire[], seen: number) => roomsOf(fold(log, roster, 0), log, "jow", { "room:general": seen }, 0).find((r) => r.id === "general")
const all = (log: Wire[]) => messagesOf(fold(log, roster, 0), log, "jow", new Map(), pictures, [])
const feed = (log: Wire[]) => all(log).filter((m) => m.where.kind === "room" && !m.specLine)
const markOf = (log: Wire[], seq: number) => {
  const m = all(log).find((x) => x.seq === seq)
  return m?.specLine ? "line" : m?.onSpec !== undefined ? `reply on #${m.onSpec}` : undefined
}

describe("a room shows the replies to a message that has a spec, and its badge counts what it shows (#1779, T501)", () => {
  const ask = msg(1, "jow", "an onboarding over the AFK scene")
  const spec = ev(2, "dev", { op: "spec.set", ask: 1, text: "# Onboarding\n\n## Done when\n- [ ] it shows on the first run" })

  test("a plain reply shows in the room, marked as also on the spec, and raises the badge", () => {
    const log = [ask, spec, msg(3, "dev", "on it", 1)]
    expect(feed(log).map((m) => m.seq)).toContain(3)
    expect(markOf(log, 3)).toBe("reply on #1")
    expect(general(log, 2)?.unread).toBe(1)
  })

  test("a reply written before the spec existed stays in the room too", () => {
    const log = [ask, msg(2, "dev", "three options, sketches attached", 1), ev(3, "dev", { op: "spec.set", ask: 1, text: "# Onboarding\n\n## Done when\n- [ ] it shows on the first run" })]
    expect(feed(log).map((m) => m.seq)).toContain(2)
    expect(markOf(log, 2)).toBe("reply on #1")
    expect(general(log, 1)?.unread).toBe(1)
  })

  test("a comment on one line of the spec stays in its margin and raises no badge", () => {
    const log = [ask, spec, msg(3, "dev", "> it shows on the first run\n\nand after an update?", 1)]
    expect(feed(log).map((m) => m.seq)).not.toContain(3)
    expect(markOf(log, 3)).toBe("line")
    expect(general(log, 2)?.unread).toBe(0)
  })

  test("a reply to a comment on a line stays in the margin with it", () => {
    const log = [ask, spec, msg(3, "dev", "> it shows on the first run\n\nand after an update?", 1), msg(4, "dev", "only the first run", 3)]
    expect(feed(log).map((m) => m.seq)).not.toContain(4)
    expect(markOf(log, 4)).toBe("line")
    expect(general(log, 2)?.unread).toBe(0)
  })

  test("a reply that quotes words the spec doesn't have is a plain reply", () => {
    const log = [ask, spec, msg(3, "dev", "> an onboarding over the AFK scene\n\nwhich scene, the meadow?", 1)]
    expect(feed(log).map((m) => m.seq)).toContain(3)
    expect(markOf(log, 3)).toBe("reply on #1")
    expect(general(log, 2)?.unread).toBe(1)
  })

  test("a reply that quotes the ask's own words stays in the room, also when the spec repeats them", () => {
    const repeats = ev(2, "dev", { op: "spec.set", ask: 1, text: "# Onboarding\n\nYou asked for an onboarding over the AFK scene.\n\n## Done when\n- [ ] it shows on the first run" })
    const log = [ask, repeats, msg(3, "dev", "> an onboarding over the AFK scene\n\nwhich scene, the meadow?", 1)]
    expect(feed(log).map((m) => m.seq)).toContain(3)
    expect(markOf(log, 3)).toBe("reply on #1")
    expect(general(log, 2)?.unread).toBe(1)
  })

  test("a reply to a plain reply stays in the room, whatever it quotes", () => {
    const log = [ask, spec, msg(3, "dev", "on it", 1), msg(4, "dev", "> it shows on the first run\n\nthat one is done", 3)]
    expect(feed(log).map((m) => m.seq)).toContain(4)
    expect(markOf(log, 4)).toBe("reply on #1")
    expect(general(log, 2)?.unread).toBe(2)
  })

  test("a message still sending carries the same mark as when it lands", () => {
    const log = [ask, spec]
    const sending = (p: { replyTo?: number; inThread?: number; text: string }) =>
      messagesOf(fold(log, roster, 0), log, "jow", new Map(), pictures, [{ key: 1, where: { kind: "room", room: "general" }, at: 9000, ...p }]).find((m) => m.seq === -1)
    expect(sending({ replyTo: 1, text: "sounds right" })?.onSpec).toBe(1)
    expect(sending({ inThread: 1, text: "sounds right" })?.onSpec).toBe(1)
    expect(sending({ inThread: 1, text: "> it shows on the first run\n\nand after an update?" })?.specLine).toBe(true)
  })

  test("a message outside the spec's thread carries no mark", () => {
    const log = [ask, spec, msg(3, "dev", "T12 is merged")]
    expect(feed(log).map((m) => m.seq)).toContain(3)
    expect(markOf(log, 3)).toBeUndefined()
    expect(general(log, 2)?.unread).toBe(1)
  })

  test("a reply to a message with no spec still counts, since rooms are flat", () => {
    const log = [ask, msg(2, "dev", "on it", 1)]
    expect(feed(log).map((m) => m.seq)).toContain(2)
    expect(markOf(log, 2)).toBeUndefined()
    expect(general(log, 1)?.unread).toBe(1)
  })
})
