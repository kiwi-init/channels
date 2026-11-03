import { describe, expect, test } from "bun:test"
import { DONE_FOR, moodOf, type MoodOf } from "~/kit/mood"

const NOW = 1_800_000_000_000
const here: MoodOf = { presence: "online" }
const load = (level: "free" | "busy" | "overloaded") => ({ level, doing: [], queued: [], waiting: [] })

describe("an agent's eyes show what it is doing (spec #320)", () => {
  test("each of the eight states comes from what the app already knows", () => {
    expect(moodOf(here, NOW)).toBe("free")
    expect(moodOf({ ...here, activity: { state: "working" } }, NOW)).toBe("thinking")
    expect(moodOf({ ...here, activity: { state: "working", tool: "Bash" } }, NOW)).toBe("tool")
    expect(moodOf({ ...here, activity: { state: "waiting" } }, NOW)).toBe("waiting")
    expect(moodOf({ ...here, load: load("overloaded") }, NOW)).toBe("overloaded")
    expect(moodOf({ ...here, doneAt: NOW - 1000 }, NOW)).toBe("done")
    expect(moodOf({ ...here, red: true }, NOW)).toBe("error")
    expect(moodOf({ presence: "offline" }, NOW)).toBe("offline")
  })

  test("offline wins over everything, and a person waiting on you wins over work", () => {
    expect(moodOf({ presence: "offline", activity: { state: "waiting" }, red: true }, NOW)).toBe("offline")
    expect(moodOf({ ...here, activity: { state: "waiting" }, load: load("overloaded") }, NOW)).toBe("waiting")
  })

  test("a red check shows once the agent stops working on it", () => {
    expect(moodOf({ ...here, red: true, activity: { state: "working", tool: "Bash" } }, NOW)).toBe("tool")
    expect(moodOf({ ...here, red: true, activity: { state: "idle" } }, NOW)).toBe("error")
  })

  test("just finished lasts a few seconds, then the agent is free again", () => {
    expect(moodOf({ ...here, doneAt: NOW - DONE_FOR + 1 }, NOW)).toBe("done")
    expect(moodOf({ ...here, doneAt: NOW - DONE_FOR - 1 }, NOW)).toBe("free")
    expect(moodOf({ ...here, doneAt: NOW - 1000, load: load("busy"), activity: { state: "working" } }, NOW)).toBe("thinking")
  })
})
