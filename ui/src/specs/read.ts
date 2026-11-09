import "~/i18n/en/specs"
import { doneWhen, type DoneWhen } from "@kiwi/core/state.ts"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import type { Channel, Message, Person, Spec, Task } from "~/model"
import { memberOf } from "~/model"
import { nickname } from "~/names"
import { wordsPlain, wordsRaw } from "~/words"

type Tone = "tone-quiet" | "tone-doing" | "tone-review" | "tone-decide" | "tone-live" | "tone-alert"

const ordinal = (n: number): string =>
  n === 1
    ? t("specs.read.next.in.line")
    : t(n % 10 === 2 && n % 100 !== 12 ? "specs.read.nd.in.line" : n % 10 === 3 && n % 100 !== 13 ? "specs.read.rd.in.line" : "specs.read.th.in.line", { place: n })

export function boxesOf(spec: Pick<Spec, "text">): DoneWhen[] {
  return doneWhen(wordsRaw(spec.text))
}

export function tasksOf(channel: Pick<Channel, "tasks">, spec: Pick<Spec, "tasks">): Task[] {
  return spec.tasks.flatMap((id) => channel.tasks.find((t) => t.id === id) ?? [])
}

const live = (t: Task): boolean => t.status !== "done" && !t.archived && !t.cancelled

export function workersOf(channel: Pick<Channel, "tasks">, spec: Pick<Spec, "tasks">): string[] {
  return [...new Set(tasksOf(channel, spec).flatMap((t) => (live(t) && t.owner ? [t.owner] : [])))]
}

export function freeCount(channel: Pick<Channel, "free">): number {
  return channel.free?.length ?? 0
}

export interface StageLine {
  word: string
  tone: Tone
  line: string
}

export function stageLine(channel: Channel, spec: Spec): StageLine {
  const asker = nickname(channel, spec.by)
  const tasks = tasksOf(channel, spec)
  const done = tasks.filter((t) => t.status === "done" && !t.cancelled).length
  switch (spec.stage) {
    case "draft":
      return { word: t("specs.read.word.draft"), tone: "tone-quiet", line: spec.canJudge ? t("specs.read.waits.your.approval") : t("specs.read.waits.approval", { who: asker }) }
    case "queued": {
      if (spec.changed) return { word: t("specs.read.word.changed"), tone: "tone-decide", line: t("specs.read.changed.since", { who: nickname(channel, spec.approved?.by ?? spec.by) }) }
      if (spec.planner) return { word: t("specs.read.word.starting"), tone: "tone-doing", line: t("specs.read.planning", { who: nickname(channel, spec.planner) }) }
      const free = freeCount(channel)
      const place = spec.queue ?? 1
      return {
        word: t("specs.read.word.approved"),
        tone: "tone-quiet",
        line: [t("specs.read.starts.when.free"), ordinal(place), free ? t("specs.read.free", { count: free }) : t("specs.read.none.free")].join(" · "),
      }
    }
    case "working": {
      const who = workersOf(channel, spec).map((n) => nickname(channel, n))
      return {
        word: t("specs.read.word.working"),
        tone: "tone-doing",
        line: [who.length ? who.join(", ") : null, t("specs.read.tasks.done", { done, total: tasks.filter((task) => !task.cancelled).length })].filter(Boolean).join(" · "),
      }
    }
    case "delivered":
      return { word: t("specs.read.word.delivered"), tone: "tone-decide", line: spec.canJudge ? t("specs.read.waits.your.verdict") : t("specs.read.waits.verdict", { who: asker }) }
    case "accepted":
      return {
        word: t("specs.read.word.accepted"),
        tone: "tone-live",
        line: spec.result?.auto ? t("specs.read.closed.by.itself") : t("specs.read.by", { who: nickname(channel, spec.result?.by ?? spec.by) }),
      }
    case "dropped":
      return {
        word: t("specs.read.word.dropped"),
        tone: "tone-quiet",
        line: spec.result?.note ? wordsPlain(spec.result.note, channel.nicknames) : t("specs.read.by", { who: nickname(channel, spec.result?.by ?? spec.by) }),
      }
  }
}

export function needsYou(spec: Spec): boolean {
  return !!spec.canJudge && !spec.result && (spec.stage === "draft" || spec.stage === "delivered" || !!spec.changed)
}

export interface Comment {
  m: Message
  quote?: string
  re?: number
  excerpt?: string
  text: string
}

const QUOTE_RE = /^>\s?(.*)$/

export function splitQuote(text: string): { quote?: string; text: string } {
  const lines = text.split("\n")
  const quoted: string[] = []
  let i = 0
  while (i < lines.length && QUOTE_RE.test(lines[i]!)) quoted.push(QUOTE_RE.exec(lines[i++]!)![1]!)
  if (!quoted.length) return { text }
  return { quote: quoted.join("\n").trim(), text: lines.slice(i).join("\n").trim() }
}

type SpecThread = Pick<Spec, "ask" | "comments">

function onSpecThread(channel: Pick<Channel, "specs">, spec: SpecThread): (m: Message) => boolean {
  const mine = new Set(spec.comments)
  const elsewhere = new Set((channel.specs ?? []).filter((s) => s.ask !== spec.ask).flatMap((s) => [s.ask, ...s.comments]))
  return (m) => mine.has(m.seq) || (m.inThread === spec.ask && !elsewhere.has(m.seq))
}

export function commentsOf(channel: Pick<Channel, "messages" | "specs">, spec: SpecThread): Comment[] {
  const on = onSpecThread(channel, spec)
  const shown = channel.messages.filter((m) => on(m) && !m.system && !m.deleted).sort((a, b) => a.seq - b.seq)
  const seqs = new Set(shown.map((m) => m.seq))
  return shown.map((m) => {
    const { quote, text } = splitQuote(wordsRaw(m.text))
    if (m.replyTo !== undefined && seqs.has(m.replyTo)) return { m, re: m.replyTo, ...(quote ? { excerpt: quote } : {}), text }
    return { m, ...(quote ? { quote } : {}), text }
  })
}

const squash = (s: string): string =>
  s
    .replace(/[*_`~#>[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

export function quoteIn(text: string, quote: string): boolean {
  const q = squash(quote)
  return !!q && squash(text).includes(q)
}

export type DiffLine = { kind: "same" | "add" | "del"; text: string }

const untick = (line: string): string => line.replace(/^(\s*[-*+]\s+)\[[xX]\]/, "$1[ ]").trimEnd()

export function lineDiff(before: string, after: string, key: (line: string) => string = untick): DiffLine[] {
  const a = before.split("\n")
  const b = after.split("\n")
  const ka = a.map(key)
  const kb = b.map(key)
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = ka[i] === kb[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (ka[i] === kb[j]) {
      out.push({ kind: "same", text: b[j]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: "del", text: a[i++]! })
    else out.push({ kind: "add", text: b[j++]! })
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! })
  while (j < m) out.push({ kind: "add", text: b[j++]! })
  return out
}

export type Alarm = { kind: "stuck" | "circling" | "red" | "changed"; task?: number; text: string }

const STUCK_MS = 45 * 60_000

export function alarmsOf(channel: Channel, spec: Spec, now = Date.now()): Alarm[] {
  const out: Alarm[] = []
  if (spec.changed) out.push({ kind: "changed", text: t("specs.read.alarm.changed", { who: nickname(channel, spec.approved?.by ?? spec.by) }) })
  if (spec.result) return out
  for (const task of tasksOf(channel, spec)) {
    if (!live(task)) continue
    const id = String(task.id)
    const rejected = task.rounds.filter((r) => r.result === "rejected").length
    if (rejected >= 2) out.push({ kind: "circling", task: task.id, text: t("specs.read.alarm.circling", { task: id, times: rejected }) })
    if (task.pr?.checks === "fail" || (task.pr?.ticks?.failed.length ?? 0) > 0) out.push({ kind: "red", task: task.id, text: t("specs.read.alarm.red", { task: id, pr: String(task.pr?.number) }) })
    if (task.status === "doing" && now - task.updatedAt > STUCK_MS)
      out.push({ kind: "stuck", task: task.id, text: t("specs.read.alarm.stuck", { task: id, minutes: Math.round((now - task.updatedAt) / 60_000) }) })
  }
  return out
}

export interface StoryLine {
  at: number
  who: string
  text: string
  tone?: Tone
  task?: number
}

const MOVE_WORDS: Partial<Record<Task["history"][number]["what"], Key>> = {
  created: "specs.read.move.created",
  took: "specs.read.move.took",
  started: "specs.read.move.started",
  review: "specs.read.move.review",
  approved: "specs.read.move.approved",
  rejected: "specs.read.move.rejected",
  done: "specs.read.move.done",
  cancelled: "specs.read.move.cancelled",
  assigned: "specs.read.move.assigned",
  proof: "specs.read.move.proof",
  checkpoint: "specs.read.move.checkpoint",
}

const MOVE_TONES: Partial<Record<Task["history"][number]["what"], Tone>> = { approved: "tone-live", done: "tone-live", rejected: "tone-alert", review: "tone-review", cancelled: "tone-quiet" }

export function storyOf(channel: Channel, spec: Spec): StoryLine[] {
  const out: StoryLine[] = [{ at: spec.at, who: spec.by, text: t("specs.read.story.asked", { words: wordsPlain(spec.words, channel.nicknames) }) }]
  if (spec.edits > 0)
    out.push({
      at: spec.edited.at,
      who: spec.edited.by,
      text: spec.edits > 1 ? t("specs.read.story.edited", { count: spec.edits, who: spec.editors.map((n) => nickname(channel, n)).join(", ") }) : t("specs.read.story.wrote"),
    })
  if (spec.approved) out.push({ at: spec.approved.at, who: spec.approved.by, text: t("specs.read.story.approved"), tone: "tone-live" })
  for (const b of spec.backs) out.push({ at: b.at, who: b.by, text: t("specs.read.story.sent.back", { note: wordsPlain(b.note, channel.nicknames) }), tone: "tone-alert" })
  for (const task of tasksOf(channel, spec)) {
    const id = String(task.id)
    for (const h of task.history) {
      const verb = MOVE_WORDS[h.what]
      if (!verb) continue
      out.push({
        at: h.at,
        who: h.by,
        text:
          h.what === "created"
            ? t(verb, { task: id, title: wordsPlain(task.title, channel.nicknames) })
            : h.what === "assigned" && h.to
              ? t("specs.read.move.assigned.to", { task: id, who: nickname(channel, h.to) })
              : t(verb, { task: id }),
        task: task.id,
        ...(MOVE_TONES[h.what] ? { tone: MOVE_TONES[h.what] } : {}),
      })
    }
    const pr = task.pr
    if (pr?.at !== undefined) out.push({ at: pr.at, who: pr.by ?? task.owner ?? task.createdBy, text: t("specs.read.story.opened.pr", { pr: String(pr.number) }), task: task.id })
    if (pr?.mergedAt !== undefined)
      out.push({ at: pr.mergedAt, who: pr.by ?? task.owner ?? task.createdBy, text: t("specs.read.story.merged.pr", { pr: String(pr.number) }), task: task.id, tone: "tone-live" })
  }
  if (spec.result)
    out.push({
      at: spec.result.at,
      who: spec.result.by,
      text: spec.result.verdict === "accepted" ? t("specs.read.story.accepted") : t("specs.read.story.dropped"),
      tone: spec.result.verdict === "accepted" ? "tone-live" : "tone-quiet",
    })
  return out.sort((a, b) => a.at - b.at)
}

export function lastMove(channel: Channel, spec: Spec): number {
  return Math.max(spec.edited.at, spec.approved?.at ?? 0, ...tasksOf(channel, spec).map((t) => t.updatedAt))
}

export function insideOf(channel: Pick<Channel, "messages" | "specs">, spec: Pick<Spec, "ask" | "tasks" | "comments">): Message[] {
  const tasks = new Set(spec.tasks)
  const on = onSpecThread(channel, spec)
  return channel.messages.filter((m) => m.seq === spec.ask || on(m) || (m.where.kind === "task" && tasks.has(m.where.task))).sort((a, b) => a.at - b.at)
}

export function faceOf(channel: Channel, name: string): Person | undefined {
  return memberOf(channel, name)
}

export const SPEC_TEMPLATE = (title: string): string => [`# ${title}`, "", "## Why", "", "## Done when", "- [ ] ", "", "## In", "- ", "", "## Out", "- ", "", "## Open questions", "- "].join("\n")

export type Run = { kind: "text" | "code" | "bold"; text: string }

export function inlineRuns(text: string): Run[] {
  const out: Run[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ kind: "text", text: text.slice(at, m.index) })
    out.push(m[1] !== undefined ? { kind: "code", text: m[1] } : { kind: "bold", text: m[2]! })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) })
  return out
}
