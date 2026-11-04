import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { specAsksOf, specsOf } from "~/live/specs"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "dev", pk: "pk-dev", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const msg = (seq: number, from: string, body: string): Wire => ({ v: 1, id: `m${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "msg", body, ts: seq * 1000 }) as Wire
const ev = (seq: number, from: string, e: Event): Wire => ({ v: 1, id: `e${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, kind: "event", body: "", ev: e, ts: seq * 1000 }) as Wire
const SPEC = "# Export\n\n## Done when\n- [ ] it exports"

const cards = (wires: Wire[], why: "approve" | "changed") => specAsksOf(specsOf(fold(wires, roster, 0), "jow")).filter((a) => a.why === why)
const approveCards = (wires: Wire[]) => cards(wires, "approve")

describe("the owner's approve card waits for a spec marked ready (#1625)", () => {
  test("a draft nobody marked ready asks the owner nothing", () => {
    expect(approveCards([msg(1, "jow", "export please"), ev(2, "dev", { op: "spec.set", ask: 1, text: SPEC })])).toEqual([])
  })

  test("a version marked ready brings the card, and an edit after it takes the card away again", () => {
    const ready = [msg(1, "jow", "export please"), ev(2, "dev", { op: "spec.set", ask: 1, text: SPEC }), ev(3, "dev", { op: "spec.ready", ask: 1, v: 2 })]
    expect(approveCards(ready).map((a) => a.ask)).toEqual([1])
    expect(approveCards([...ready, ev(4, "dev", { op: "spec.set", ask: 1, text: `${SPEC}\n- [ ] and a test` })])).toEqual([])
  })

  test("an approved spec changed afterwards asks for the change only once that version is marked ready", () => {
    const changed = [
      msg(1, "jow", "export please"),
      ev(2, "dev", { op: "spec.set", ask: 1, text: SPEC }),
      ev(3, "dev", { op: "spec.ready", ask: 1, v: 2 }),
      ev(4, "jow", { op: "spec.approve", ask: 1, v: 2 }),
      ev(5, "dev", { op: "spec.set", ask: 1, text: `${SPEC}\n- [ ] and a test` }),
    ]
    expect(cards(changed, "changed")).toEqual([])
    expect(cards([...changed, ev(6, "dev", { op: "spec.ready", ask: 1, v: 5 })], "changed").map((a) => a.ask)).toEqual([1])
  })
})
