import type { SendOptions } from "@kiwi/core/client.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { openRound, taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { taskDigest } from "@kiwi/core/work.ts"

export const ANYONE = "*"

type ReviewAction = "none" | "send-back" | "verdict"

export type TaskActions = { kind: "hidden" } | { kind: "open"; review: ReviewAction }

export interface TaskSend {
  body: string
  opts: SendOptions
}

function reviewsMe(t: Task, me: string): boolean {
  return t.state === "review" && !!t.review && (t.review === me || (t.review === ANYONE && t.owner !== me && !t.workedBy.includes(me)))
}

export function reviewsFor(tasks: Iterable<Task>, me: string, person: boolean): Task[] {
  return person ? [...tasks].filter((t) => reviewsMe(t, me)) : []
}

export function taskActions(t: Task, me: string, person: boolean): TaskActions {
  if (!person || t.state === "done") return { kind: "hidden" }
  if (t.state !== "review") return { kind: "open", review: "none" }
  const judges = (!t.review || reviewsMe(t, me)) && (!!openRound(t) || t.rounds.length === 0)
  return { kind: "open", review: judges ? "verdict" : "send-back" }
}

function roundOf(t: Task): { round: number; at?: string } | Record<string, never> {
  const open = openRound(t)
  return open ? { round: open.n, ...(open.at ? { at: open.at } : {}) } : {}
}

function toOwner(t: Task): { to: string[] } | Record<string, never> {
  return t.owner ? { to: [t.owner] } : {}
}

export function approveTask(t: Task): TaskSend {
  return {
    body: `${taskId(t.id)} approved`,
    opts: { kind: "event", ev: { op: "task.update", task: t.id, state: "done", verdict: "approved", note: "approved", ...roundOf(t) }, ...toOwner(t) },
  }
}

export function sendBackTask(t: Task, why: string): TaskSend {
  return {
    body: `${taskId(t.id)} rejected`,
    opts: { kind: "event", ev: { op: "task.update", task: t.id, state: "doing", verdict: "rejected", note: why, ...roundOf(t) }, ...toOwner(t) },
  }
}

export function cancelTask(t: Task, note: string, me: string): TaskSend {
  const waiting = t.state === "review" && t.review && t.review !== ANYONE ? [t.review] : []
  const to = [...new Set([...(t.owner ? [t.owner] : []), ...waiting])].filter((n) => n !== me)
  return {
    body: `${taskId(t.id)} cancelled: ${note}`,
    opts: { kind: "event", ev: { op: "task.update", task: t.id, state: "cancelled", note }, ...(to.length ? { to } : {}) },
  }
}

export function reviewerChoices(t: Task, members: Iterable<{ name: string; active: boolean }>): string[] {
  const named = [...members].filter((m) => m.active && m.name !== t.owner && m.name !== t.review).map((m) => m.name)
  return t.review === ANYONE ? named : [ANYONE, ...named]
}

export function changeReviewer(t: Task, review: string, me: string): TaskSend {
  const to = [...new Set([...(t.owner ? [t.owner] : []), ...(review === ANYONE ? [] : [review])])].filter((n) => n !== me)
  return {
    body: `${taskId(t.id)} review: ${review === ANYONE ? "anyone who hasn't worked on it" : review}`,
    opts: { kind: "event", ev: { op: "task.update", task: t.id, review }, ...(to.length ? { to } : {}) },
  }
}

export function closedDigest(state: ChannelState, messages: Message[], t: Task, how: { by: string; cancelled?: string }): TaskSend {
  const closed: Task = how.cancelled
    ? { ...t, state: "done", cancelled: true, notes: [...t.notes, { seq: 0, by: how.by, ts: 0, text: how.cancelled }] }
    : { ...t, state: "done", ...(t.review ? { approvedBy: how.by } : {}) }
  return { body: taskDigest(state, messages, closed), opts: { kind: "done" } }
}
