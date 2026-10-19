import { describe, expect, test } from "bun:test"

import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts"
import { prsByTask } from "@kiwi/core/work.ts"

import { laneWork } from "./lanes"

const roster: Roster = []
const ids = new Map<string, Identity>()
const log: Message[] = []
let seq = 0

async function join(name: string, kind: "human" | "agent", owner = false): Promise<void> {
  const id = await generateIdentity(name)
  ids.set(name, id)
  roster.push({ name, pk: id.pk, owner, at: 0, active: true, kind })
}

async function post(from: string, ev: Event | null, body = "", kind: Kind = ev ? "event" : "msg"): Promise<Message> {
  const id = ids.get(from)!
  seq++
  const signed = await sign(id, { v: 1 as const, id: String(seq), from, kind, body, ts: seq * 1000, ...(ev ? { ev } : {}) })
  const m = { ...signed, seq, rts: seq * 1000, sigOk: await verify(signed) }
  log.push(m)
  return m
}

const state = (): ChannelState => fold(log, roster)
const lane = (name: string) => {
  const s = state()
  return laneWork(s, log, name, prsByTask(s, log))
}

await join("jow", "human", true)
await join("wren", "agent")
await join("puma", "agent")
await post("jow", { op: "role.set", member: "puma", role: "lead" })
const doing = await post("puma", { op: "task.add", title: "Flaky smoke", owner: "wren" })
const queued = await post("puma", { op: "task.add", title: "CI red becomes a task", owner: "wren" })
const review = await post("puma", { op: "task.add", title: "Copy buttons", owner: "wren" })
const other = await post("puma", { op: "task.add", title: "Glass avatars", owner: "puma" })
await post("wren", { op: "task.update", task: doing.seq, state: "doing" })
await post("wren", { op: "task.update", task: doing.seq, note: "PR https://github.com/ojow/channels/pull/368" })
await post("wren", { op: "task.update", task: review.seq, state: "doing" })
await post("wren", { op: "task.update", task: review.seq, state: "review", note: "PR https://github.com/ojow/channels/pull/370" })
await post("puma", { op: "task.update", task: other.seq, state: "doing", note: "PR https://github.com/ojow/channels/pull/369" })
await post("jow", { op: "github", items: [{ event: "check_run", repo: "ojow/channels", name: "ci-ok", branch: `T${doing.seq}-flaky`, sha: "abc", conclusion: "failure", at: 1 }] })

describe("an agent's lane", () => {
  test("its tasks in progress and in review, each with its PR, then what's queued", () => {
    const w = lane("wren")
    expect(w.current.map((c) => [c.task.id, c.task.state, c.pr?.number])).toEqual([
      [doing.seq, "doing", 368],
      [review.seq, "review", 370],
    ])
    expect(w.next.map((t) => t.id)).toEqual([queued.seq])
    expect(w.watching).toEqual([])
  })

  test("since when a task has been in its state comes from the update that put it there", () => {
    const w = lane("wren")
    const started = log.find((m) => m.ev?.op === "task.update" && m.ev.task === doing.seq && m.ev.state === "doing")!
    expect(w.current[0]!.since).toBe(started.rts!)
  })

  test("its last three moves, newest first, said the way the log says them", () => {
    const w = lane("wren")
    expect(w.events).toHaveLength(3)
    expect(w.events[0]!.text).toContain(`T${review.seq}`)
    expect(w.events.map((e) => e.seq)).toEqual([...w.events.map((e) => e.seq)].sort((a, b) => b - a))
  })

  test("the lead also watches the other open PRs on the board", () => {
    const p = lane("puma")
    expect(p.current.map((c) => c.pr?.number)).toEqual([369])
    expect(p.watching.map((pr) => pr.number).sort()).toEqual([368, 370])
  })

  test("someone with nothing has an empty lane", () => {
    expect(lane("jow")).toEqual({ current: [], next: [], watching: [], events: [] })
  })
})
