import { describe, expect, test } from "bun:test"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { sendBackTask } from "@kiwi/channel/task-actions.ts"
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

async function post(from: string, ev: Event): Promise<Message> {
  const id = ids.get(from)
  if (!id) throw new Error(`no identity for ${from}`)
  seq++
  const signed = await sign(id, { v: 1 as const, id: String(seq), from, kind: "event", body: "", ts: seq * 1000, ev })
  const m = { ...signed, seq, rts: seq * 1000, sigOk: await verify(signed) }
  log.push(m)
  return m
}

const task = (id: number, me: string) => {
  const t = tasksOf(fold(log, roster), new Set(), me, log).find((x) => x.id === id)
  if (!t) throw new Error(`no task ${id}`)
  return t
}

await join("jow", "human", true)
await join("maya", "human")
await join("wren", "agent")
await join("atlas", "agent")
const anyone = await post("jow", { op: "task.add", title: "Copy buttons", owner: "maya", review: "*" })
await post("maya", { op: "task.update", task: anyone.seq, state: "doing" })
await post("maya", { op: "task.update", task: anyone.seq, state: "review" })
const named = await post("jow", { op: "task.add", title: "Glass avatars", owner: "wren", review: "atlas" })
await post("wren", { op: "task.update", task: named.seq, state: "doing" })
await post("wren", { op: "task.update", task: named.seq, state: "review" })
await post("atlas", { op: "task.update", task: named.seq, state: "done", verdict: "approved", note: "approved", round: 1 })
const dropped = await post("jow", { op: "task.add", title: "Animated icons", owner: "wren" })
await post("jow", { op: "task.update", task: dropped.seq, state: "cancelled", note: "too busy" })

describe("reviews on the task page (T614)", () => {
  test("a task anyone may review keeps that reviewer, not a person called anyone", () => {
    expect(task(anyone.seq, "jow").reviewer).toBe("*")
  })

  test("someone who hasn't worked on it gives the verdict; someone who has can only send it back", () => {
    expect(task(anyone.seq, "jow").youReview).toBe("verdict")
    expect(task(anyone.seq, "maya").youReview).toBe("send-back")
  })

  test("a named reviewer's task asks nothing of others once it's done", () => {
    expect(task(named.seq, "jow").youReview).toBeUndefined()
  })

  test("a round is credited to whoever gave the verdict, not to who asked for it", () => {
    expect(task(named.seq, "jow").rounds).toEqual([{ n: 1, by: "wren", judge: "atlas", at: expect.any(Number), result: "approved" }])
  })

  test("a cancelled task says so instead of passing for done", () => {
    expect(task(dropped.seq, "jow")).toMatchObject({ status: "done", cancelled: true })
    expect(task(named.seq, "jow").cancelled).toBeUndefined()
  })

  test("sending back carries the reason in the verdict", () => {
    const t = fold(log, roster).tasks.get(anyone.seq)
    if (!t) throw new Error("no task")
    expect(sendBackTask(t, "the hint covers the code").opts.ev).toMatchObject({ verdict: "rejected", note: "the hint covers the code", round: 1 })
  })
})
