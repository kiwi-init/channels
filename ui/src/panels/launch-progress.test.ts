import { describe, expect, test } from "bun:test"

import { joinedAs, seen, stallOf, starting, stepOf, STALL_MS } from "~/panels/launch-progress"

const people = [{ name: "jow" }, { name: "lucid-bison", display: "nova" }]

describe("Add agent follows the launch it started, step by step", () => {
  test("an agent let in under a random handle, with the name typed as its nickname, is in", () => {
    const l = seen(starting("lead", people, 0), { stage: "started" }, 1)
    const after = [...people, { name: "polite-toucan", display: "lead" }]
    expect(joinedAs(l, after)).toBe("polite-toucan")
    expect(stepOf(l, true, true)).toBe(3)
  })

  test("someone already in under that nickname isn't taken for it", () => {
    const before = [...people, { name: "old-lead", display: "lead" }]
    expect(joinedAs(starting("lead", before, 0), before)).toBeNull()
  })

  test("the handle it asked under, or the one the owner's app let in, is the one it's in as", () => {
    const asked = seen(seen(starting("lead", people, 0), { stage: "started" }, 1), { stage: "asked", name: "polite-toucan" }, 2)
    expect(joinedAs(asked, [...people, { name: "polite-toucan" }])).toBe("polite-toucan")
    expect(joinedAs(seen(asked, { stage: "joined", name: "polite-toucan" }, 3), people)).toBe("polite-toucan")
  })

  test("Started and asked to join are ticked only once they happen", () => {
    const l = starting("lead", people, 0)
    expect(stepOf(l, true, false)).toBe(0)
    expect(stepOf(seen(l, { stage: "started" }, 1), true, false)).toBe(1)
    expect(stepOf(seen(seen(l, { stage: "started" }, 1), { stage: "asked", name: "x" }, 2), true, false)).toBe(2)
    expect(stepOf(seen(l, { stage: "started" }, 1), false, false)).toBe(1)
  })

  test("a launch that fails stays failed, with why, at the step it failed", () => {
    const l = seen(starting("lead", people, 0), { stage: "failed", why: "Claude Code stopped as it started (exit 1)" }, 5)
    expect(l).toMatchObject({ stage: "failed", why: "Claude Code stopped as it started (exit 1)" })
    expect(seen(l, { stage: "started" }, 6)).toBe(l)
    expect(stepOf(l, true, false)).toBe(0)
    expect(joinedAs(l, [...people, { name: "x", display: "lead" }])).toBeNull()
    expect(stallOf(l, true, false, 10 * 60_000)).toBeNull()
  })

  test("no step waits in silence: each says so once it's taken too long", () => {
    const l = starting("lead", people, 0)
    expect(stallOf(l, true, false, STALL_MS["slow-start"] - 1)).toBeNull()
    expect(stallOf(l, true, false, STALL_MS["slow-start"])).toBe("slow-start")
    const up = seen(l, { stage: "started" }, 1_000)
    expect(stallOf(up, true, false, 1_000 + STALL_MS["not-asking"])).toBe("not-asking")
    expect(stallOf(up, false, false, 1_000 + STALL_MS["owner-waiting"])).toBe("owner-waiting")
    const asked = seen(up, { stage: "asked", name: "x" }, 2_000)
    expect(stallOf(asked, true, false, 2_000 + STALL_MS["not-let-in"])).toBe("not-let-in")
    expect(stallOf(asked, true, true, 2_000 + STALL_MS["not-let-in"])).toBeNull()
  })

  test("asking before the launch answers still counts, and a late Started doesn't step it back", () => {
    const asked = seen(starting("lead", people, 0), { stage: "asked", name: "x" }, 1)
    expect(seen(asked, { stage: "started" }, 2)).toBe(asked)
  })
})
