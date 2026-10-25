import { describe, expect, test } from "bun:test"

import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import { PROTOCOL_VERSION, type Event, type Message, type Payload } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"

import { DONE_SHOWN, WORKING_SHOWN, nowCard } from "./now"

const YESTERDAY = new Date(2026, 9, 23, 22, 0).getTime()
const TODAY = new Date(2026, 9, 24, 9, 0).getTime()
const R = "o/r"

const ids: Record<string, Identity> = { jow: await generateIdentity("jow"), ann: await generateIdentity("ann") }
const roster: Roster = [
  { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
  { name: "ann", pk: ids.ann!.pk, owner: false, at: 0, active: true, kind: "agent", scopes: ["post", "tasks", "facts"] },
]
const log: Message[] = []
let clock = YESTERDAY

async function say(from: string, ev: Event): Promise<number> {
  const seq = log.length + 1
  clock += 1_000
  const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind: "event", body: "", ts: clock, ev }
  const p = await sign(ids[from]!, payload)
  log.push({ ...p, seq, rts: clock, sigOk: await verify(p) })
  return seq
}

const github = (items: Record<string, unknown>[]) => say("jow", { op: "github", items: items.map((i) => ({ repo: R, at: clock, ...i })) } as Event)
const add = (title: string, owner?: string) => say("ann", { op: "task.add", title, ...(owner ? { owner } : {}) })
const done = (task: number) => say("ann", { op: "task.update", task, state: "done" })
const card = () => nowCard(fold(log, roster, clock), clock)

await say("jow", { op: "branch.prefix.set", prefix: "T" })
await done(await add("Yesterday's fix", "ann"))
clock = TODAY

describe("the Now card", () => {
  test("with nothing going on: no next line, nobody working, nothing done today", () => {
    expect(card()).toEqual({ next: null, working: [], moreWorking: 0, done: [], doneCount: 0 })
  })

  test("the next line is the note the lead sets, and goes when it's cleared or runs out", async () => {
    await say("ann", { op: "fact.set", key: "next", value: "0.27.7 · the AppImage runs on stock Fedora" })
    expect(card().next).toBe("0.27.7 · the AppImage runs on stock Fedora")
    await say("ann", { op: "fact.del", key: "next" })
    expect(card().next).toBeNull()
    await say("ann", { op: "fact.set", key: "next", value: "soon gone", ttl: 60 })
    expect(card().next).toBe("soon gone")
    clock += 61_000
    expect(card().next).toBeNull()
  })

  test("working rows say each task's stage from its PR, newest first; unowned tasks aren't working", async () => {
    const quiet = await add("No PR yet", "ann")
    const red = await add("Red one", "ann")
    const green = await add("Green one", "ann")
    await add("Nobody holds this")
    await github([{ event: "pull_request", action: "opened", number: 7, state: "open", branch: `T${red}-red`, sha: "r1" }])
    await github([{ event: "check_run", action: "completed", name: "test / unit", status: "completed", conclusion: "failure", sha: "r1", run: 1 }])
    await github([{ event: "pull_request", action: "opened", number: 8, state: "open", branch: `T${green}-green`, sha: "g1" }])
    await github([{ event: "check_run", action: "created", name: "ci-ok", status: "queued", sha: "g1", run: 2 }])
    await say("ann", { op: "task.update", task: green, state: "doing" })
    const c = card()
    expect(c.working.map((t) => [t.id, t.owner, t.stage, t.red])).toEqual([
      [green, "ann", "PR #8 · checks running", false],
      [red, "ann", "PR #7 · test / unit failed", true],
      [quiet, "ann", "no PR yet", false],
    ])
    await github([{ event: "check_run", action: "completed", name: "ci-ok", status: "completed", conclusion: "success", sha: "g1", run: 2 }])
    expect(card().working[0]?.stage).toBe("PR #8 · checks passed")
  })

  test("a merged PR moves its task to done today; yesterday's done and cancelled tasks aren't counted", async () => {
    const green = card().working[0]!.id
    await github([{ event: "pull_request", action: "closed", number: 8, state: "closed", merged: true }])
    await done(green)
    const dropped = await add("Dropped", "ann")
    await say("ann", { op: "task.update", task: dropped, state: "cancelled" })
    const c = card()
    expect(c.working.map((t) => t.id)).not.toContain(green)
    expect(c.doneCount).toBe(1)
    expect(c.done.map((t) => [t.title, t.stage])).toEqual([["Green one", "PR #8 merged"]])
  })

  test(`on a busy day it keeps to the top ${WORKING_SHOWN} working and the last ${DONE_SHOWN} done, with counts for the rest`, async () => {
    for (let i = 0; i < WORKING_SHOWN + 2; i++) await add(`Busy ${i}`, "ann")
    for (let i = 0; i < DONE_SHOWN + 3; i++) await done(await add(`Shipped ${i}`, "ann"))
    const c = card()
    expect(c.working).toHaveLength(WORKING_SHOWN)
    expect(c.working[0]?.title).toBe(`Busy ${WORKING_SHOWN + 1}`)
    expect(c.moreWorking).toBe(4)
    expect(c.done.map((t) => t.title)).toEqual(["Shipped 5", "Shipped 4", "Shipped 3"])
    expect(c.doneCount).toBe(DONE_SHOWN + 4)
  })
})
