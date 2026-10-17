import type { SendOptions } from "../../../src/client.ts"
import { openRound, taskId, type Task } from "../../../src/state.ts"

type ReviewAction = "none" | "send-back" | "verdict"

export type TaskActions = { kind: "hidden" } | { kind: "open"; review: ReviewAction }

export interface TaskSend {
  body: string
  opts: SendOptions
}

function reviewsMe(t: Task, me: string): boolean {
  return t.state === "review" && !!t.review && (t.review === me || (t.review === "*" && t.owner !== me && !t.workedBy.includes(me)))
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
  const waiting = t.state === "review" && t.review && t.review !== "*" ? [t.review] : []
  const to = [...new Set([...(t.owner ? [t.owner] : []), ...waiting])].filter((n) => n !== me)
  return {
    body: `${taskId(t.id)} cancelled: ${note}`,
    opts: { kind: "event", ev: { op: "task.update", task: t.id, state: "cancelled", note }, ...(to.length ? { to } : {}) },
  }
}
