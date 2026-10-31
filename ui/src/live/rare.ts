import { memberName } from "@kiwi/app/format.ts"
import { ANYONE, cancelTask as cancelling, changeReviewer, closedDigest, type TaskSend } from "@kiwi/channel/task-actions.ts"
import { changeTo } from "@kiwi/core/changes.ts"
import { GENERAL_ROOM, MAX_GOAL_NAME, type Event } from "@kiwi/core/protocol.ts"
import { taskId } from "@kiwi/core/state.ts"
import { announce } from "~/kit/toasts"
import { event, memberOf, need, owner } from "~/live/run"
import type { Run } from "~/live/store"

const COMPACT_ASK =
  "Please draft a /compact summary of the history so far: name every open task (T7) and open question (#123) by its id, then run `kiwi compact --file summary.md`. I'll approve it in the app."

async function sends(run: Run, ...all: TaskSend[]): Promise<void> {
  for (const { body, opts } of all) await run.send(body, opts)
}

export async function approveCompact(code: string, proposal: number): Promise<void> {
  const run = owner(code)
  const p = run.state.compactProposal
  if (p?.seq !== proposal) throw new Error("that proposal was replaced or already approved")
  await event(run, `compacted the history through #${p.through}`, { op: "compact", summary: p.summary, through: p.through, proposal: p.seq })
  announce(`History through #${p.through} compacted`)
}

export async function askCompact(code: string): Promise<void> {
  const run = need(code)
  const lead = run.state.lead && run.state.lead !== run.me ? run.state.lead : null
  await run.send(COMPACT_ASK, lead ? { to: [lead], kind: "ask" } : { kind: "ask" })
  announce(lead ? `Asked ${memberName(run.state.members.get(lead), lead)} for a summary` : "Asked the agents for a summary")
}

export async function cancelTask(code: string, id: number, why: string): Promise<void> {
  const run = need(code)
  const t = run.state.tasks.get(id)
  if (!t) throw new Error(`no task ${taskId(id)}`)
  const note = why.trim()
  if (!note) throw new Error("say why it's cancelled")
  await sends(run, cancelling(t, note, run.me), closedDigest(run.state, [...run.messages], t, { by: run.me, cancelled: note }))
}

export async function setReviewer(code: string, id: number, reviewer: string): Promise<void> {
  const run = need(code)
  const t = run.state.tasks.get(id)
  if (!t) throw new Error(`no task ${taskId(id)}`)
  if (reviewer !== ANYONE) memberOf(run, reviewer)
  await sends(run, changeReviewer(t, reviewer, run.me))
}

export async function nameGoal(code: string, ask: number, name: string | null): Promise<void> {
  const run = need(code)
  const clean = name?.trim().slice(0, MAX_GOAL_NAME) || null
  await event(run, clean ? `named the goal of #${ask}: ${clean}` : `#${ask}'s goal unnamed`, { op: "ask.name", ask, name: clean })
}

export async function change(code: string, seq: number, text: string | null): Promise<void> {
  const run = need(code)
  const original = run.messages.find((m) => m.seq === seq)
  if (!original) throw new Error("that message isn't loaded")
  const ev: Event = text === null ? { op: "msg.delete", seq } : { op: "msg.edit", seq, body: text.trim() }
  const to = changeTo(original)
  const room = run.state.roomOf.get(seq)
  await run.send(text === null ? `deleted #${seq}` : `edited #${seq}`, { kind: "event", ev, ...(to.length ? { to } : {}), ...(room && room !== GENERAL_ROOM ? { room } : {}) })
}
