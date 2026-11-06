import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { messagesOf, roomsOf } from "~/live/map"
import { specsOf } from "~/live/specs"
import { inSpecThread } from "~/model"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "dev", pk: "pk-dev", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const msg = (seq: number, from: string, body: string, re?: number): Wire =>
  ({ v: 1, id: `m${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "msg", body, ts: seq * 1000, ...(re !== undefined ? { re: [re] } : {}) }) as Wire
const ev = (seq: number, from: string, e: Event): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev: e, ts: seq * 1000 }) as Wire
const pictures = { get: () => ({ spot: "", alt: "", state: "waiting" as const }) }

const general = (log: Wire[], seen: number) => roomsOf(fold(log, roster, 0), log, "jow", { "room:general": seen }, 0).find((r) => r.id === "general")
const feed = (log: Wire[]) => {
  const state = fold(log, roster, 0)
  const specAsks = new Set(specsOf(state, "jow").map((s) => s.ask))
  return messagesOf(state, log, "jow", new Map(), pictures, []).filter((m) => m.where.kind === "room" && !inSpecThread(m, specAsks))
}

describe("a room's badge counts only what the room shows (#1779)", () => {
  const ask = msg(1, "jow", "an onboarding over the Calm scene")
  const spec = ev(2, "dev", { op: "spec.set", ask: 1, text: "# Onboarding\n\n## Done when\n- [ ] it shows" })

  test("a reply in a spec's thread raises no badge, since the room doesn't show it", () => {
    const log = [ask, spec, msg(3, "dev", "on it", 1)]
    expect(feed(log).map((m) => m.seq)).not.toContain(3)
    expect(general(log, 2)?.unread).toBe(0)
  })

  test("a message the room shows still raises it", () => {
    const log = [ask, spec, msg(3, "dev", "on it", 1), msg(4, "dev", "T12 is merged")]
    expect(feed(log).map((m) => m.seq)).toContain(4)
    expect(general(log, 2)?.unread).toBe(1)
  })

  test("a reply to a message with no spec still counts, since rooms are flat", () => {
    const log = [ask, msg(2, "dev", "on it", 1)]
    expect(feed(log).map((m) => m.seq)).toContain(2)
    expect(general(log, 1)?.unread).toBe(1)
  })
})
