import { describe, expect, test } from "bun:test"

import { arrivals, wantPersona } from "~/live/persona-later"

const agent = (name: string, joined: number, display?: string) => ({ name, kind: "agent" as const, joined, ...(display ? { display } : {}) })

describe("a manager's pick waits for the agent to join (T1656)", () => {
  test("the agent that arrives under that nickname gets it, once", () => {
    wantPersona("a", "scout", "builder", 100)
    expect(arrivals("a", [agent("gentle-otter", 150, "scout")])).toEqual([{ name: "gentle-otter", persona: "builder" }])
    expect(arrivals("a", [agent("gentle-otter", 150, "scout")])).toEqual([])
  })

  test("an older agent with the same nickname doesn't take it, nor another channel's", () => {
    wantPersona("a", "scout", "builder", 100)
    expect(arrivals("a", [agent("old-otter", 50, "scout")])).toEqual([])
    expect(arrivals("b", [agent("gentle-otter", 150, "scout")])).toEqual([])
    expect(arrivals("a", [agent("gentle-otter", 150, "scout")])).toEqual([{ name: "gentle-otter", persona: "builder" }])
  })

  test("choosing None takes the wish back, and no name means nothing to match", () => {
    wantPersona("a", "scout", "builder", 100)
    wantPersona("a", "scout", "", 100)
    wantPersona("a", "  ", "builder", 100)
    expect(arrivals("a", [agent("gentle-otter", 150, "scout"), agent("  ", 150)])).toEqual([])
  })
})
