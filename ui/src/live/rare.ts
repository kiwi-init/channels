import { memberName } from "@kiwi/app/format.ts"
import { ANYONE, approveTask as approving, cancelTask as cancelling, changeReviewer, closedDigest, sendBackTask, type TaskSend } from "@kiwi/channel/task-actions.ts"
import { ALLOW_ONCE, DENY } from "@kiwi/app/permission-settled.ts"
import { changeTo } from "@kiwi/core/changes.ts"
import { permissionReply } from "@kiwi/core/permission.ts"
import { GENERAL_ROOM, MAX_GOAL_NAME, type Event, type StepReply } from "@kiwi/core/protocol.ts"
import { taskId } from "@kiwi/core/state.ts"
import { bridge, type KiwiBridge, type TermEvent, type TermOpenView } from "@kiwi/secrets/secrets.ts"
import { stepReplyText } from "~/chat/step"
import { announce } from "~/kit/toasts"
import { ownPrefs, setPrefs } from "~/live/prefs"
import { muteKey, snoozeEnd, type SnoozeFor } from "~/live/snooze"
import { event, memberOf, need, owner } from "~/live/run"
import { seatOf } from "~/live/seats"
import type { Run } from "~/live/store"
import type { TaskStatus, TermOpened, TermWatch, UpdateCheck } from "~/model"

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

export async function answerStep(code: string, id: string, reply: StepReply): Promise<void> {
  const run = need(code)
  const m = run.messages.find((x) => x.seq === Number(id))
  if (!m) throw new Error("that step is gone")
  await run.send(stepReplyText(reply), { to: [m.from], re: [m.seq], kind: "msg", stepReply: reply })
}

async function streamTerm(b: KiwiBridge, open: () => Promise<TermOpenView>, watch: TermWatch): Promise<TermOpened> {
  const early: TermEvent[] = []
  let mine: string | null = null
  const deliver = (e: TermEvent) => ("out" in e ? watch.out(e.out) : watch.ended())
  const off = b.onTerm((e) => (mine === null ? early.push(e) : e.term === mine && deliver(e)))
  const r = await open().catch((err: unknown): TermOpenView => ({ ok: false, detail: err instanceof Error ? err.message : String(err) }))
  if (!r.ok) {
    off()
    return { error: r.detail }
  }
  const term = r.term
  mine = term
  queueMicrotask(() => early.filter((e) => e.term === term).forEach(deliver))
  return {
    screen: { cols: r.cols, rows: r.rows, seed: r.seed, dead: r.dead, pane: r.pane },
    link: {
      keys: (text) => void b.termKeys(term, text).catch(() => {}),
      size: (c, w) => void b.termSize(term, c, w).catch(() => {}),
      close: () => {
        off()
        void b.termClose(term).catch(() => {})
      },
    },
  }
}

export async function openTerm(code: string, name: string, cols: number, rows: number, watch: TermWatch): Promise<TermOpened> {
  const b = bridge()
  const seat = seatOf(need(code).roomId, name)
  if (!b) return { error: "Terminals open in the Channels desktop app." }
  if (typeof b.termOpen !== "function") return { error: "Update Channels to open its terminals here." }
  if (seat?.place !== "hosted") return { error: "It isn't running in Channels' own terminal on this computer." }
  return streamTerm(b, () => b.termOpen(seat.pane, cols, rows), watch)
}

export async function openMyTerm(code: string, want: string | null, cols: number, rows: number, watch: TermWatch): Promise<TermOpened> {
  const b = bridge()
  if (!b) return { error: "Your terminal opens in the Channels desktop app." }
  if (typeof b.termMine !== "function") return { error: "Update Channels to open your own terminal here." }
  const room = need(code).roomId
  return streamTerm(b, () => b.termMine(room, want, cols, rows), watch)
}

export function setMute(code: string, room: string | null, on: boolean): void {
  const key = muteKey(code, room)
  const rest = ownPrefs().muted.filter((k) => k !== key)
  setPrefs({ muted: on ? [...rest, key] : rest })
}

export const snooze = (until: SnoozeFor | null): void => setPrefs({ snoozeUntil: until ? snoozeEnd(until, Date.now()) : null })

export async function checkUpdate(): Promise<UpdateCheck | null> {
  const b = bridge()
  if (!b) return null
  try {
    const u = await b.checkUpdate()
    if (u.state === "current" || u.state === "failed") return u
    return { state: u.state, version: u.version, ...(u.blocked ? { blocked: true } : {}) }
  } catch {
    // A check that throws is shown the same as one that couldn't reach GitHub.
    return { state: "failed" }
  }
}

export async function answerPermission(code: string, id: string, allow: boolean): Promise<void> {
  const run = need(code)
  const m = run.messages.find((x) => x.seq === Number(id))
  if (!m) throw new Error("that request is gone")
  const perm = permissionReply(m, allow, run.state)
  if (!perm) throw new Error("this one can only be answered in the terminal")
  await run.send(allow ? ALLOW_ONCE : DENY, { to: [m.from], re: [m.seq], kind: "msg", perm })
}

const STATES: Partial<Record<TaskStatus, "todo" | "doing" | "review" | "done">> = { todo: "todo", doing: "doing", review: "review", done: "done" }

export async function approveTask(code: string, id: number, approve: boolean, why?: string): Promise<void> {
  const run = need(code)
  const t = run.state.tasks.get(id)
  if (!t) throw new Error(`no task ${taskId(id)}`)
  if (approve) await sends(run, approving(t), closedDigest(run.state, [...run.messages], t, { by: run.me }))
  else await sends(run, sendBackTask(t, why?.trim() || "sent back for another look"))
}

export async function setTaskStatus(code: string, id: number, status: TaskStatus): Promise<void> {
  const run = need(code)
  const t = run.state.tasks.get(id)
  if (!t) throw new Error(`no task ${taskId(id)}`)
  const state = STATES[status]
  if (!state) throw new Error("a task waits on its own, when something holds it")
  const to = t.owner && t.owner !== run.me ? [t.owner] : undefined
  await event(run, `${taskId(id)} ${state}`, { op: "task.update", task: id, state }, to)
}
