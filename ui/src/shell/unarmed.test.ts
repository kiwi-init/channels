import { afterEach, describe, expect, setSystemTime, test } from "bun:test"

import { hear, sharedOnline, type Online } from "@kiwi/channel/online.ts"
import { UNARMED_ALERT_MS, type Presence } from "@kiwi/core/protocol.ts"
import type { Channel, Person } from "~/model"
import { statusOf } from "~/shell/sidebar"

const channel = { tasks: [] } as unknown as Channel
const agent = (more: Partial<Person>): Person => ({ name: "lead", kind: "agent", presence: "online", lastSeen: 0, reach: "wakes", ...more }) as Person
const start = 1_800_000_000_000
const why = "the listen slot for lead in alpha is held by session L"

afterEach(() => setSystemTime())

const presence = (more: Partial<Presence>) => ({ v: 1, type: "presence", from: "lead", client: "daemon", pk: "pk-lead", ts: start, sigOk: true, ...more }) as Presence & { sigOk: boolean }

describe("the member list flags an agent whose listener hasn't armed (#2502)", () => {
  test("a presence whose only change is the failure reaches the view: added, reason updated, cleared", () => {
    const quiet = hear(new Map(), presence({}), start)
    const was = sharedOnline(new Map(), new Map(quiet))
    const failing = sharedOnline(was, new Map(hear(was, presence({ unarmed: { since: start, why } }), start)))
    expect(failing).not.toBe(was)
    expect(failing.get("pk-lead")?.unarmed).toEqual({ since: start, why })
    const updated = sharedOnline(failing, new Map(hear(failing, presence({ unarmed: { since: start, why: "still held" } }), start)))
    expect(updated).not.toBe(failing)
    expect(updated.get("pk-lead")?.unarmed?.why).toBe("still held")
    const cleared: Map<string, Online> = sharedOnline(updated, new Map(hear(updated, presence({}), start)))
    expect(cleared).not.toBe(updated)
    expect(cleared.get("pk-lead")?.unarmed).toBeUndefined()
  })

  test("the alert ages into view at five minutes with no new data, and says why ahead of the usual status", () => {
    const p = agent({ unarmed: { since: start, why } })
    setSystemTime(new Date(start + UNARMED_ALERT_MS - 1_000))
    expect(statusOf(p, channel)).not.toContain("listener not armed")
    setSystemTime(new Date(start + UNARMED_ALERT_MS + 1_000))
    expect(statusOf(p, channel)).toBe(`listener not armed: ${why}`)
  })

  test("without a failure the usual status shows", () => {
    expect(statusOf(agent({}), channel)).not.toContain("listener not armed")
  })
})
