import { wellFormed } from "@mc/protocol.ts"
import { fold } from "@mc/state.ts"

import { viewOf } from "../lib/channel"
import { fixtureKinds, fixtureMessages, fixtureRoster, SELF } from "./channel"

describe("channel fixtures", () => {
  it("cover every message kind", () => {
    const seen = new Set(fixtureMessages.map((m) => m.kind))
    expect(fixtureKinds.filter((k) => !seen.has(k))).toEqual([])
  })

  it("have contiguous seqs from 1", () => {
    expect(fixtureMessages.map((m) => m.seq)).toEqual(fixtureMessages.map((_, i) => i + 1))
  })

  it("are well formed protocol messages", () => {
    const bad = fixtureMessages.filter((m) => !wellFormed(m as unknown)).map((m) => m.seq)
    expect(bad).toEqual([])
  })

  it("carry a thread, a direct message, a room, an image, an escalation with a handoff and reactions", () => {
    expect(fixtureMessages.some((m) => m.task !== undefined)).toBe(true)
    expect(fixtureMessages.some((m) => m.dm)).toBe(true)
    expect(fixtureMessages.some((m) => m.room)).toBe(true)
    expect(fixtureMessages.some((m) => m.imgs?.length)).toBe(true)
    expect(fixtureMessages.some((m) => m.esc && m.handoff)).toBe(true)
    expect(fixtureMessages.filter((m) => m.ev?.op === "react").length).toBeGreaterThan(1)
  })

  it("fold into a task, facts and members", () => {
    const state = fold(fixtureMessages, fixtureRoster, Date.now())
    expect(state.tasks.get(fixtureMessages.findIndex((m) => m.ev?.op === "task.add") + 1)?.state).toBe("doing")
    expect(state.facts.get("branch")?.value).toBe("mobile")
    expect(state.members.size).toBe(4)
  })

  it("show unread for someone who has read nothing", () => {
    expect(viewOf(fixtureMessages, fixtureRoster, 0, SELF).unread).toBeGreaterThan(5)
  })
})
