import { describe, expect, test } from "bun:test"
import type { Pending } from "~/live/map"
import { changeUnsent, nextUnsentKey, unsentIn } from "~/live/unsent"

const where = { kind: "main" } as Pending["where"]
const pending = (key: number, text: string, failed?: string): Pending => ({ key, where, text, at: 1, ...(failed ? { failed } : {}) })

describe("unsent messages outlive the open channel (T946)", () => {
  test("a failed message is still there when its channel opens again", () => {
    const key = nextUnsentKey()
    changeUnsent("room-a", (list) => [...list, pending(key, "the deploy is done", "offline")])
    expect(unsentIn("room-a").map((p) => [p.text, p.failed])).toEqual([["the deploy is done", "offline"]])
    expect(unsentIn("room-b")).toEqual([])
    changeUnsent("room-a", (list) => list.filter((p) => p.key !== key))
    expect(unsentIn("room-a")).toEqual([])
  })

  test("keys stay unique across channels and remounts", () => {
    const a = nextUnsentKey()
    const b = nextUnsentKey()
    expect(b).toBeGreaterThan(a)
  })
})
