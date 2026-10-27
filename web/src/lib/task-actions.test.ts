import { describe, expect, test } from "bun:test"

import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { taskDigest } from "@kiwi/core/work.ts"
import { fold, type ChannelState, type Roster, type Task } from "@kiwi/core/state.ts"

import { ANYONE, approveTask, assignTask, cancelTask, changeReviewer, closedDigest, reviewerChoices, reviewsFor, sendBackTask, taskActions, type TaskSend } from "./task-actions"

const roster: Roster = []
const ids = new Map<string, Identity>()
let seq = 0
const log: Message[] = []

async function join(name: string, kind: "human" | "agent"): Promise<void> {
  const id = await generateIdentity(name)
  ids.set(name, id)
  roster.push({ name, pk: id.pk, owner: false, at: 0, active: true, kind })
}

async function post(from: string, ev: Event, to?: string[]): Promise<number> {
  const id = ids.get(from)
  if (!id) throw new Error(`no identity for ${from}`)
  seq++
  const signed = await sign(id, { v: 1 as const, id: String(seq), from, kind: "event" as const, body: "", ts: seq * 1000, ev, ...(to ? { to } : {}) })
  log.push({ ...signed, seq, rts: seq * 1000, sigOk: await verify(signed) })
  return seq
}

async function sendAs(from: string, s: TaskSend): Promise<number> {
  if (!s.opts.ev) throw new Error("not an event")
  return post(from, s.opts.ev, s.opts.to)
}

const state = (): ChannelState => fold(log, roster)
const task = (id: number): Task => {
  const t = state().tasks.get(id)
  if (!t) throw new Error(`no task ${id}`)
  return t
}

await join("jon", "human")
await join("dev", "agent")
await join("grok-reviewer", "agent")
await join("codex", "agent")

async function inReview(review: string): Promise<number> {
  const id = await post("dev", { op: "task.add", title: `checked by ${review}`, owner: "dev", review })
  await post("dev", { op: "task.update", task: id, state: "review", at: "abc123" })
  return id
}

describe("which tasks need this person's review", () => {
  test("only reviews named for the person; one open to anyone stays optional", async () => {
    const byGrok = await inReview("grok-reviewer")
    const byJon = await inReview("jon")
    const byAnyone = await inReview("*")
    const ids = reviewsFor(state().tasks.values(), "jon", true).map((t) => t.id)
    expect(ids).toContain(byJon)
    expect(ids).not.toContain(byAnyone)
    expect(taskActions(task(byAnyone), "jon", true)).toEqual({ kind: "open", review: "verdict" })
    expect(ids).not.toContain(byGrok)
    expect(reviewsFor(state().tasks.values(), "dev", false)).toEqual([])
  })
})

describe("taskActions", () => {
  test("a person may send back a round waiting on an agent reviewer, but not approve in its place", async () => {
    expect(taskActions(task(await inReview("grok-reviewer")), "jon", true)).toEqual({ kind: "open", review: "send-back" })
  })

  test("a person reviewing it, or a review with no reviewer, gets the verdict", async () => {
    expect(taskActions(task(await inReview("jon")), "jon", true)).toEqual({ kind: "open", review: "verdict" })
    const unnamed = await post("dev", { op: "task.add", title: "no reviewer", owner: "dev" })
    await post("dev", { op: "task.update", task: unnamed, state: "review" })
    expect(taskActions(task(unnamed), "jon", true)).toEqual({ kind: "open", review: "verdict" })
  })

  test("a review open to anyone isn't this person's to judge once they've worked on it", async () => {
    const id = await post("jon", { op: "task.add", title: "jon's own", owner: "jon", review: "*" })
    await post("jon", { op: "task.update", task: id, state: "review" })
    expect(taskActions(task(id), "jon", true)).toEqual({ kind: "open", review: "send-back" })
    const at = await sendAs("jon", sendBackTask(task(id), "not yet"))
    expect(state().rejected.get(at)).toBeUndefined()
    expect(task(id).state).toBe("doing")
  })

  test("a review with no reviewer is approved by the person", async () => {
    const id = await post("dev", { op: "task.add", title: "unnamed approve", owner: "dev" })
    await post("dev", { op: "task.update", task: id, state: "review" })
    const at = await sendAs("jon", approveTask(task(id)))
    expect(state().rejected.get(at)).toBeUndefined()
    expect(task(id)).toMatchObject({ state: "done" })
    expect(task(id).rounds.at(-1)?.result).toMatchObject({ kind: "approved", by: "jon" })
  })

  test("in review with only closed rounds, there's no round to approve, so only send back", async () => {
    const id = await inReview("jon")
    const t = task(id)
    const closed: Task = { ...t, rounds: t.rounds.map((r) => ({ ...r, result: { kind: "withdrawn", seq: 0 } })) }
    expect(taskActions(closed, "jon", true)).toEqual({ kind: "open", review: "send-back" })
  })

  test("work not in review can only be cancelled; done work and agents get nothing", async () => {
    const todo = await post("dev", { op: "task.add", title: "to do", owner: "dev" })
    expect(task(todo).state).toBe("todo")
    expect(taskActions(task(todo), "jon", true)).toEqual({ kind: "open", review: "none" })
    await post("dev", { op: "task.claim", task: todo })
    expect(task(todo).state).toBe("doing")
    expect(taskActions(task(todo), "jon", true)).toEqual({ kind: "open", review: "none" })
    expect(taskActions(task(todo), "dev", false)).toEqual({ kind: "hidden" })
    await post("dev", { op: "task.update", task: todo, state: "done" })
    expect(taskActions(task(todo), "jon", true)).toEqual({ kind: "hidden" })
  })
})

describe("the events a person sends from a task", () => {
  test("send back rejects the open round of an agent's review and puts the work back in doing", async () => {
    const id = await inReview("grok-reviewer")
    const sent = sendBackTask(task(id), "stale: redo on main")
    expect(sent.opts).toEqual({
      kind: "event",
      ev: { op: "task.update", task: id, state: "doing", verdict: "rejected", note: "stale: redo on main", round: 1, at: "abc123" },
      to: ["dev"],
    })
    const at = await sendAs("jon", sent)
    expect(state().rejected.get(at)).toBeUndefined()
    const t = task(id)
    expect(t.state).toBe("doing")
    expect(t.rounds.at(-1)?.result).toMatchObject({ kind: "rejected", by: "jon" })
  })

  test("cancel closes a task waiting on an agent reviewer, tells its owner and reviewer, and marks it cancelled", async () => {
    const id = await inReview("grok-reviewer")
    const sent = cancelTask(task(id), "grok-reviewer can't be woken", "jon")
    expect(sent.opts).toEqual({ kind: "event", ev: { op: "task.update", task: id, state: "cancelled", note: "grok-reviewer can't be woken" }, to: ["dev", "grok-reviewer"] })
    const at = await sendAs("jon", sent)
    expect(state().rejected.get(at)).toBeUndefined()
    const t = task(id)
    expect(t).toMatchObject({ state: "done", cancelled: true })
    expect(t.rounds.at(-1)?.result.kind).toBe("withdrawn")
    expect(t.notes.at(-1)).toMatchObject({ by: "jon", text: "grok-reviewer can't be woken" })
  })

  test("cancel tells nobody when the canceller owns it", async () => {
    const id = await post("jon", { op: "task.add", title: "mine", owner: "jon" })
    expect(cancelTask(task(id), "not needed", "jon").opts.to).toBeUndefined()
  })

  test("approve finishes the open round as its reviewer", async () => {
    const id = await inReview("jon")
    const at = await sendAs("jon", approveTask(task(id)))
    expect(state().rejected.get(at)).toBeUndefined()
    expect(task(id)).toMatchObject({ state: "done", approvedBy: "jon" })
    expect(task(id).rounds.at(-1)?.result).toMatchObject({ kind: "approved", by: "jon" })
  })
})

describe("handing a review to someone else", () => {
  test("the choices are anyone, or an active member other than the owner and the current reviewer", async () => {
    const id = await inReview("grok-reviewer")
    expect(reviewerChoices(task(id), state().members.values())).toEqual([ANYONE, "jon", "codex"])
    const open = await inReview(ANYONE)
    expect(reviewerChoices(task(open), state().members.values())).toEqual(["jon", "grok-reviewer", "codex"])
  })

  test("a person assigns a task to the suggested agent, with the reason in its note", async () => {
    const id = await inReview("grok-reviewer")
    const sent = assignTask(task(id), "codex", "worked T1, where it came from")
    expect(sent.opts).toEqual({ kind: "event", ev: { op: "task.update", task: id, owner: "codex", note: "assigned to codex: worked T1, where it came from" }, to: ["codex"] })
    const at = await sendAs("jon", sent)
    expect(state().rejected.get(at)).toBeUndefined()
    expect(task(id).owner).toBe("codex")
  })

  test("a person moves an open round to a new reviewer, whose verdict counts and the old one's doesn't", async () => {
    const id = await inReview("grok-reviewer")
    const sent = changeReviewer(task(id), "codex", "jon")
    expect(sent.opts).toEqual({ kind: "event", ev: { op: "task.update", task: id, review: "codex" }, to: ["dev", "codex"] })
    const at = await sendAs("jon", sent)
    expect(state().rejected.get(at)).toBeUndefined()
    expect(task(id)).toMatchObject({ state: "review", review: "codex" })
    expect(task(id).rounds.at(-1)?.result.kind).toBe("open")
    const stale = await sendAs("grok-reviewer", approveTask(task(id)))
    expect(state().rejected.get(stale)).toBeDefined()
    const verdict = await sendAs("codex", approveTask(task(id)))
    expect(state().rejected.get(verdict)).toBeUndefined()
    expect(task(id)).toMatchObject({ state: "done", approvedBy: "codex" })
  })

  test("a person who names themselves gets the verdict on the open round", async () => {
    const id = await inReview("grok-reviewer")
    await sendAs("jon", changeReviewer(task(id), "jon", "jon"))
    expect(taskActions(task(id), "jon", true)).toEqual({ kind: "open", review: "verdict" })
    expect(changeReviewer(task(id), ANYONE, "jon").opts.to).toEqual(["dev"])
  })

  test("an agent working on it can't move its own review", async () => {
    const id = await inReview("grok-reviewer")
    const at = await sendAs("dev", changeReviewer(task(id), "codex", "dev"))
    expect(state().rejected.get(at)).toBeDefined()
    expect(task(id).review).toBe("grok-reviewer")
  })
})

describe("the digest a person posts when they close a task", () => {
  test("says what the task will say once the approval lands", async () => {
    const id = await inReview("jon")
    const before = task(id)
    const digest = closedDigest(state(), log, before, { by: "jon" })
    await sendAs("jon", approveTask(before))
    expect(digest.opts).toEqual({ kind: "done", task: id })
    expect(digest.body).toBe(taskDigest(state(), log, task(id)))
    expect(digest.body).toContain("done: checked by jon")
    expect(digest.body).toContain("approved by jon")
  })

  test("a cancel says so, with why, and nobody approved it", async () => {
    const id = await inReview("grok-reviewer")
    const digest = closedDigest(state(), log, task(id), { by: "jon", cancelled: "not needed after all" })
    expect(digest.body).toMatch(/^T\d+ cancelled: checked by grok-reviewer · not needed after all · by dev$/)
  })
})
