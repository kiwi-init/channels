import { describe, expect, test } from "bun:test"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { assignTask, cancelTask, changeReviewer } from "@/lib/task-actions"
import { tasksOf } from "~/live/map"

const roster: Roster = []
const ids = new Map<string, Identity>()
const log: Message[] = []
let seq = 0

async function join(name: string, kind: "human" | "agent", owner = false): Promise<void> {
  const id = await generateIdentity(name)
  ids.set(name, id)
  roster.push({ name, pk: id.pk, owner, at: 0, active: true, kind })
}

async function post(from: string, m: { kind: "event"; ev: Event } | { kind: "chat"; body: string }): Promise<Message> {
  const id = ids.get(from)
  if (!id) throw new Error(`no identity for ${from}`)
  seq++
  const signed = await sign(id, { v: 1 as const, id: String(seq), from, body: "", ts: seq * 1000, ...m })
  const out = { ...signed, seq, rts: seq * 1000, sigOk: await verify(signed) }
  log.push(out)
  return out
}

const event = (from: string, ev: Event) => post(from, { kind: "event", ev })

const task = (id: number, me = "jow") => {
  const t = tasksOf(fold(log, roster), new Set(), me, log).find((x) => x.id === id)
  if (!t) throw new Error(`no task ${id}`)
  return t
}

const state = () => fold(log, roster)

await join("jow", "human", true)
await join("wren", "agent")
await join("atlas", "agent")
const first = await event("jow", { op: "task.add", title: "Glass avatars", owner: "wren" })
await event("wren", { op: "task.update", task: first.seq, state: "doing", areas: ["ui/avatars"] })
await event("wren", { op: "task.update", task: first.seq, state: "review", summary: "Avatars sit on glass now." })
await event("jow", { op: "task.update", task: first.seq, state: "doing", verdict: "rejected", note: "the ring is too thick", round: 1 })
await event("wren", { op: "task.update", task: first.seq, note: "thinner ring pushed" })
await post("atlas", { kind: "chat", body: "Looked at T" + first.seq + " on Linux, fine." })
await post("atlas", { kind: "chat", body: "T" + first.seq + " again, same thread? no, new message." })
const second = await event("jow", { op: "task.add", title: "Glass avatars in the rail" })
const t2 = state().tasks.get(second.seq)!
await event("jow", changeReviewer(t2, "atlas", "jow").opts.ev!)
await event("jow", assignTask(t2, "atlas", "worked the avatars").opts.ev!)
const t2b = state().tasks.get(second.seq)!
await event("jow", cancelTask(t2b, "folded into the first one", "jow").opts.ev!)
const third = await event("jow", { op: "task.add", title: "Glass avatars on the board", from: first.seq })

describe("a task's activity (T612)", () => {
  test("its own events, in order, with what each one said", () => {
    const h = task(first.seq).history.filter((e) => e.what !== "mention")
    expect(h.map((e) => e.what)).toEqual(["created", "started", "review", "rejected", "note"])
    expect(h[0]).toMatchObject({ by: "jow", to: "wren" })
    expect(h[2]).toMatchObject({ round: 1 })
    expect(h[3]).toMatchObject({ round: 1, note: "the ring is too thick" })
    expect(h[4]).toMatchObject({ by: "wren", note: "thinner ring pushed" })
  })

  test("messages elsewhere that name it, one row each", () => {
    const named = task(first.seq).history.filter((e) => e.what === "mention")
    expect(named).toHaveLength(2)
    expect(named[0]).toMatchObject({ by: "atlas", where: { kind: "room", room: "general" } })
  })

  test("reviewer, reassign and cancel read as themselves, without the wire's prefixes", () => {
    const h = task(second.seq).history
    expect(h.map((e) => e.what)).toEqual(["created", "reviewer", "assigned", "cancelled"])
    expect(h[1]).toMatchObject({ to: "atlas" })
    expect(h[2]).toMatchObject({ to: "atlas", note: "worked the avatars" })
    expect(h[3]).toMatchObject({ note: "folded into the first one" })
    expect(task(second.seq)).toMatchObject({ status: "done", cancelled: true, owner: "atlas", reviewer: "atlas" })
  })

  test("the open round carries its summary", () => {
    expect(task(first.seq).rounds[0]).toMatchObject({ n: 1, result: "rejected", summary: "Avatars sit on glass now." })
  })

  test("an unowned task suggests the agent with its context, and only to a person", () => {
    expect(task(third.seq).suggested?.name).toBe("wren")
    expect(task(third.seq, "atlas").suggested).toBeUndefined()
    expect(task(first.seq).suggested).toBeUndefined()
  })
})
