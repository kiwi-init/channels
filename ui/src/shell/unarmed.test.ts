import { describe, expect, test } from "bun:test"

import type { Channel, Person } from "~/model"
import { statusOf } from "~/shell/sidebar"

const channel = { tasks: [] } as unknown as Channel
const agent = (more: Partial<Person>): Person => ({ name: "lead", kind: "agent", presence: "online", lastSeen: 0, reach: "wakes", ...more }) as Person

describe("the member list flags an agent whose listener hasn't armed (#2502)", () => {
  test("it says why, ahead of the usual status", () => {
    expect(statusOf(agent({ unarmed: "the listen slot for lead in alpha is held by session L" }), channel)).toBe("listener not armed: the listen slot for lead in alpha is held by session L")
  })

  test("without a failure the usual status shows", () => {
    expect(statusOf(agent({}), channel)).not.toContain("listener not armed")
  })
})
