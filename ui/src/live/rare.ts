import "~/i18n/en/live-later"
import { memberName } from "@kiwi/app/format.ts"
import { ANYONE, approveTask as approving, cancelTask as cancelling, changeReviewer, closeLanding, sendBackTask, type TaskSend } from "@kiwi/channel/task-actions.ts"
import { closedDigest } from "@kiwi/channel/task-digest.ts"
import { ALLOW_ONCE, DENY } from "@kiwi/app/permission-settled.ts"
import { changeTo } from "@kiwi/core/changes.ts"
import { permissionReply } from "@kiwi/core/permission.ts"
import { GENERAL_ROOM, MAX_GOAL_NAME, MAX_SPEC, MAX_SPEC_NOTE, TASK_BODY_MAX_LENGTH, TASK_TITLE_MAX_LENGTH, type Event, type StepReply } from "@kiwi/core/protocol.ts"
import { taskId } from "@kiwi/core/state.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { changeBlock } from "~/chat/doc/change-block"
export { restoreOf, versionsOf } from "~/chat/doc/restore-version"
import { stepReplyText } from "~/chat/step"
import { t } from "~/i18n/i18n"
import { Plain, plainly } from "~/kit/failed"
import { announce } from "~/kit/toasts"
import { ownPrefs, setPrefs } from "~/live/prefs"
import { muteKey } from "~/live/mute"
import { event, memberOf, need, owner } from "~/live/run"
import type { Run } from "~/live/store"
import type { TaskStatus, UpdateCheck } from "~/model"
import { SENT } from "~/sent"

async function sends(run: Run, ...all: TaskSend[]): Promise<void> {
  for (const { body, opts } of all) await run.send(body, opts)
}

export async function approveCompact(code: string, proposal: number): Promise<void> {
  const run = plainly(() => owner(code))
  const p = run.state.compactProposal
  if (p?.seq !== proposal) throw new Plain(t("live.rare.proposal.replaced"))
  await event(run, `compacted the history through #${p.through}`, { op: "compact", summary: p.summary, through: p.through, proposal: p.seq })
  announce(t("live.rare.compacted", { through: String(p.through) }))
}

export async function askCompact(code: string): Promise<void> {
  const run = need(code)
  const lead = run.state.lead && run.state.lead !== run.me ? run.state.lead : null
  await run.send(SENT.compactAsk, lead ? { to: [lead], kind: "ask" } : { kind: "ask" })
  announce(lead ? t("live.rare.asked.summary", { name: memberName(run.state.members.get(lead), lead) }) : t("live.rare.asked.agents.summary"))
}

export async function cancelTask(code: string, id: number, why: string): Promise<void> {
  const run = need(code)
  const task = run.state.tasks.get(id)
  if (!task) throw new Error(t("live.run.no.task", { id: taskId(id) }))
  const note = why.trim()
  if (!note) throw new Error(t("live.rare.say.why.cancelled"))
  await sends(run, cancelling(task, note, run.me), closedDigest(run.state, [...run.messages], task, { by: run.me, cancelled: note }))
}

export async function closeTask(code: string, id: number, why: string): Promise<void> {
  const run = need(code)
  const task = run.state.tasks.get(id)
  if (!task) throw new Error(t("live.run.no.task", { id: taskId(id) }))
  const note = why.trim()
  if (!note) throw new Error(t("live.rare.say.why.closed"))
  await sends(run, closeLanding(task, note))
}

export async function editTask(code: string, id: number, change: { title?: string; detail?: string }): Promise<void> {
  const run = need(code)
  const task = run.state.tasks.get(id)
  if (!task) throw new Error(t("live.run.no.task", { id: taskId(id) }))
  const title = change.title?.trim().slice(0, TASK_TITLE_MAX_LENGTH)
  if (change.title !== undefined && !title) throw new Error(t("live.run.task.needs.title"))
  const detail = change.detail?.trim()
  if (detail && detail.length > TASK_BODY_MAX_LENGTH) throw new Error(t("live.rare.body.too.long", { max: String(TASK_BODY_MAX_LENGTH) }))
  const renamed = title && title !== task.title ? { title } : {}
  const rewritten = detail !== undefined && detail !== (task.detail ?? "") ? { detail } : {}
  if (!("title" in renamed) && !("detail" in rewritten)) return
  await event(run, `edited ${taskId(id)}`, { op: "task.update", task: id, ...renamed, ...rewritten }, task.owner && task.owner !== run.me ? [task.owner] : undefined)
  announce(t("live.rare.saved", { task: taskId(id) }))
}

export async function deleteTask(code: string, id: number): Promise<void> {
  const run = need(code)
  const task = run.state.tasks.get(id)
  if (!task) throw new Error(t("live.run.no.task", { id: taskId(id) }))
  const to = [...new Set([task.owner, task.createdBy].filter((n): n is string => !!n && n !== run.me))]
  await event(run, `deleted ${taskId(id)}`, { op: "task.delete", task: id }, to)
  announce(t("live.rare.deleted", { task: taskId(id) }))
}

export async function deleteSpec(code: string, ask: number): Promise<void> {
  const run = need(code)
  if (!run.state.specs.has(ask)) throw new Error(t("live.rare.no.spec", { ask: String(ask) }))
  await event(run, `deleted #${ask}'s spec`, { op: "spec.delete", ask })
  announce(t("live.rare.spec.deleted", { ask: String(ask) }))
}

export async function setReviewer(code: string, id: number, reviewer: string): Promise<void> {
  const run = need(code)
  const task = run.state.tasks.get(id)
  if (!task) throw new Error(t("live.run.no.task", { id: taskId(id) }))
  if (reviewer !== ANYONE) memberOf(run, reviewer)
  await sends(run, changeReviewer(task, reviewer, run.me))
}

export async function nameGoal(code: string, ask: number, name: string | null): Promise<void> {
  const run = need(code)
  const clean = name?.trim().slice(0, MAX_GOAL_NAME) || null
  await event(run, clean ? `named the goal of #${ask}: ${clean}` : `#${ask}'s goal unnamed`, { op: "ask.name", ask, name: clean })
}

export async function newSpec(code: string, words: string, text: string): Promise<number> {
  const run = plainly(() => need(code))
  const said = words.trim()
  if (!said) throw new Plain(t("live.rare.say.what"))
  const ask = await run.post({ kind: "room", room: GENERAL_ROOM }, said, {})
  await writeSpec(code, ask, text.trim() || `# ${said.split("\n")[0]!.slice(0, 120)}`)
  return ask
}

export async function writeSpec(code: string, ask: number, text: string): Promise<void> {
  const run = need(code)
  const clean = text.trim()
  if (!clean) throw new Error(t("live.rare.spec.empty"))
  if (clean.length > MAX_SPEC) throw new Error(t("live.rare.spec.too.long", { max: String(MAX_SPEC) }))
  if (run.state.specs.get(ask)?.text.trim() === clean) return
  await event(run, `spec of #${ask}`, { op: "spec.set", ask, text: clean })
}

export async function approveSpec(code: string, ask: number, v: number): Promise<void> {
  const run = need(code)
  const spec = run.state.specs.get(ask)
  if (!spec) throw new Error(t("live.rare.no.spec", { ask: String(ask) }))
  if (spec.v !== v) throw new Error(t("live.rare.spec.changed"))
  await event(run, `approved the spec of #${ask}`, { op: "spec.approve", ask, v })
  announce(t("live.rare.approved"))
}

export async function judgeSpec(code: string, ask: number, verdict: "accepted" | "back" | "dropped", note?: string): Promise<void> {
  const run = need(code)
  const clean = note?.trim().slice(0, MAX_SPEC_NOTE)
  if (verdict === "back" && !clean) throw new Error(t("live.rare.say.missing"))
  await event(run, verdict === "accepted" ? `accepted #${ask}` : verdict === "back" ? `sent #${ask} back` : `dropped #${ask}`, { op: "spec.result", ask, verdict, ...(clean ? { note: clean } : {}) })
  announce(t(verdict === "accepted" ? "live.rare.accepted" : verdict === "back" ? "live.rare.sent.back" : "live.rare.dropped"))
}

export async function change(code: string, seq: number, text: string | null): Promise<void> {
  const run = need(code)
  const original = run.messages.find((m) => m.seq === seq)
  if (!original) throw new Error(t("live.rare.message.not.loaded"))
  const ev: Event = text === null ? { op: "msg.delete", seq } : { op: "msg.edit", seq, body: text.trim() }
  const to = changeTo(original)
  const room = run.state.roomOf.get(seq)
  await run.send(text === null ? `deleted #${seq}` : `edited #${seq}`, { kind: "event", ev, ...(to.length ? { to } : {}), ...(room && room !== GENERAL_ROOM ? { room } : {}) })
  if (original.block) await changeBlock((thread, th, on) => run.ch.doc(thread, th, on), run.state.docs, original.block, text === null ? null : text.trim())
}

export async function answerStep(code: string, id: string, reply: StepReply): Promise<void> {
  const run = need(code)
  const m = run.messages.find((x) => x.seq === Number(id))
  if (!m) throw new Error(t("live.rare.step.gone"))
  await run.send(stepReplyText(reply), { to: [m.from], re: [m.seq], kind: "msg", side: true, stepReply: reply })
}

export function setMute(code: string, room: string | null, on: boolean): void {
  const key = muteKey(code, room)
  const rest = ownPrefs().muted.filter((k) => k !== key)
  setPrefs({ muted: on ? [...rest, key] : rest })
}

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
  if (!m) throw new Error(t("live.run.request.gone"))
  const perm = permissionReply(m, allow, run.state)
  if (!perm) throw new Error(t("live.rare.terminal.only"))
  await run.send(allow ? ALLOW_ONCE : DENY, { to: [m.from], re: [m.seq], kind: "msg", side: true, perm })
}

const STATES: Partial<Record<TaskStatus, "todo" | "doing" | "review" | "done">> = { todo: "todo", doing: "doing", review: "review", done: "done" }

export async function approveTask(code: string, id: number, approve: boolean, why?: string): Promise<void> {
  const run = need(code)
  const task = run.state.tasks.get(id)
  if (!task) throw new Error(t("live.run.no.task", { id: taskId(id) }))
  if (approve) await sends(run, approving(task), closedDigest(run.state, [...run.messages], task, { by: run.me }))
  else await sends(run, sendBackTask(task, why?.trim() || "sent back for another look"))
}

export async function setTaskStatus(code: string, id: number, status: TaskStatus): Promise<void> {
  const run = need(code)
  const task = run.state.tasks.get(id)
  if (!task) throw new Error(t("live.run.no.task", { id: taskId(id) }))
  const state = STATES[status]
  if (!state) throw new Error(t("live.rare.task.waits"))
  const to = task.owner && task.owner !== run.me ? [task.owner] : undefined
  await event(run, `${taskId(id)} ${state}`, { op: "task.update", task: id, state }, to)
}
