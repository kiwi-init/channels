import { beforeAll, expect, test } from "bun:test"

import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"

import { trimmed } from "./trim"

const ids: Record<string, Identity> = {}
let roster: Roster
const log: Message[] = []

async function post(from: string, body: string, ev?: Event): Promise<void> {
  const seq = log.length + 1
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: ev ? ("event" as const) : ("msg" as const), body, ...(ev ? { ev } : {}), ts: seq })
  log.push({ ...p, seq, rts: seq, sigOk: await verify(p) } as Message)
}

beforeAll(async () => {
  for (const n of ["jon", "bot"]) ids[n] = await generateIdentity(n)
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human", sponsor: { user: "u-jon", name: "Jon", handle: "jon" } },
    { name: "bot", pk: ids.bot!.pk, owner: false, at: 1, active: true, kind: "agent" },
  ]
  for (let i = 0; i < 40; i++) await post("bot", "", { op: "task.add", title: `task ${i}` } as Event)
  await post("jon", "", { op: "fact.set", key: "relay", value: "v1" } as Event)
  for (let i = 0; i < 2_600; i++) await post(i % 2 ? "jon" : "bot", `message ${i}`)
}, 60_000)

test("a window under the limit plus its slack stays as it is", () => {
  expect(trimmed(log.slice(0, 2_500), roster, 10_000, null, null, null, 2_000)).toBeNull()
})

test("a long session folds what it drops into the base, so tasks and facts from before the window stay", () => {
  const whole = fold(log, roster, 10_000)
  const base = trimmed(log, roster, 10_000, null, null, null, 2_000)
  expect(base?.n).toBe(log.length - 2_000)
  const kept = log.filter((m) => m.seq > base!.n)
  expect(kept).toHaveLength(2_000)
  const after = fold(kept, roster, 10_000, null, null, base)
  expect([...after.tasks.values()].map((t) => t.title)).toEqual([...whole.tasks.values()].map((t) => t.title))
  expect(after.tasks.size).toBe(40)
  expect(after.facts.get("relay")?.value).toBe("v1")
  expect(after.head).toBe(whole.head)
})
