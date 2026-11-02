import { doneWhen, type DoneWhen } from "@kiwi/core/state.ts"

import type { Channel, Message, Person, Spec, Task } from "~/model"
import { memberOf } from "~/model"
import { nickname } from "~/names"

type Tone = "tone-quiet" | "tone-doing" | "tone-review" | "tone-decide" | "tone-live" | "tone-alert"

const ordinal = (n: number): string => (n === 1 ? "next in line" : `${n}${n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"} in line`)

export function boxesOf(spec: Pick<Spec, "text">): DoneWhen[] {
  return doneWhen(spec.text)
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
      return { word: "draft", tone: "tone-quiet", line: spec.canJudge ? "waits for your approval" : `waits for ${asker} to approve it` }
    case "queued": {
      if (spec.changed) return { word: "changed", tone: "tone-decide", line: `changed since ${nickname(channel, spec.approved?.by ?? spec.by)} approved it` }
      if (spec.planner) return { word: "starting", tone: "tone-doing", line: `${nickname(channel, spec.planner)} is planning it` }
      const free = freeCount(channel)
      const place = spec.queue ?? 1
      return { word: "approved", tone: "tone-quiet", line: `starts when an agent is free · ${ordinal(place)}${free ? ` · ${free} free` : " · none free yet"}` }
    }
    case "working": {
      const who = workersOf(channel, spec).map((n) => nickname(channel, n))
      return { word: "working", tone: "tone-doing", line: [who.length ? who.join(", ") : null, `${done} of ${tasks.filter((t) => !t.cancelled).length} tasks done`].filter(Boolean).join(" · ") }
    }
    case "delivered":
      return { word: "delivered", tone: "tone-decide", line: spec.canJudge ? "waits for your verdict" : `waits for ${asker}'s verdict` }
    case "accepted":
      return { word: "accepted", tone: "tone-live", line: `by ${nickname(channel, spec.result?.by ?? spec.by)}` }
    case "dropped":
      return { word: "dropped", tone: "tone-quiet", line: spec.result?.note ? spec.result.note : `by ${nickname(channel, spec.result?.by ?? spec.by)}` }
  }
}

export function needsYou(spec: Spec): boolean {
  return !!spec.canJudge && !spec.result && (spec.stage === "draft" || spec.stage === "delivered" || !!spec.changed)
}

export interface Comment {
  m: Message
  quote?: string
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

export function commentsOf(channel: Pick<Channel, "messages">, ask: number): Comment[] {
  return channel.messages
    .filter((m) => m.inThread === ask && !m.system && !m.deleted)
    .sort((a, b) => a.seq - b.seq)
    .map((m) => {
      const { quote, text } = splitQuote(m.text)
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
  if (spec.changed) out.push({ kind: "changed", text: `The spec changed since ${nickname(channel, spec.approved?.by ?? spec.by)} approved it: new work waits for a person to approve the change.` })
  if (spec.result) return out
  for (const t of tasksOf(channel, spec)) {
    if (!live(t)) continue
    const rejected = t.rounds.filter((r) => r.result === "rejected").length
    if (rejected >= 2) out.push({ kind: "circling", task: t.id, text: `T${t.id} was sent back ${rejected} times: the agents may be going in circles.` })
    if (t.pr?.checks === "fail" || (t.pr?.ticks?.failed.length ?? 0) > 0) out.push({ kind: "red", task: t.id, text: `T${t.id}'s checks failed on PR #${t.pr?.number}.` })
    if (t.status === "doing" && now - t.updatedAt > STUCK_MS) out.push({ kind: "stuck", task: t.id, text: `T${t.id} hasn't moved for ${Math.round((now - t.updatedAt) / 60_000)} minutes.` })
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

const MOVE_WORDS: Partial<Record<Task["history"][number]["what"], string>> = {
  created: "filed",
  took: "took",
  started: "started",
  review: "sent for review",
  approved: "approved",
  rejected: "sent back",
  done: "finished",
  cancelled: "cancelled",
  assigned: "handed on",
  proof: "added proof to",
  checkpoint: "saved where it stands on",
}

const MOVE_TONES: Partial<Record<Task["history"][number]["what"], Tone>> = { approved: "tone-live", done: "tone-live", rejected: "tone-alert", review: "tone-review", cancelled: "tone-quiet" }

export function storyOf(channel: Channel, spec: Spec): StoryLine[] {
  const out: StoryLine[] = [{ at: spec.at, who: spec.by, text: `asked: “${spec.words}”` }]
  if (spec.edits > 0)
    out.push({
      at: spec.edited.at,
      who: spec.edited.by,
      text: spec.edits > 1 ? `edited the spec (${spec.edits} edits by ${spec.editors.map((n) => nickname(channel, n)).join(", ")})` : "wrote the spec",
    })
  if (spec.approved) out.push({ at: spec.approved.at, who: spec.approved.by, text: "approved the spec", tone: "tone-live" })
  for (const b of spec.backs) out.push({ at: b.at, who: b.by, text: `sent it back: “${b.note}”`, tone: "tone-alert" })
  for (const t of tasksOf(channel, spec)) {
    for (const h of t.history) {
      const verb = MOVE_WORDS[h.what]
      if (!verb) continue
      out.push({
        at: h.at,
        who: h.by,
        text: `${verb} T${t.id}${h.what === "created" ? ` “${t.title}”` : ""}${h.what === "assigned" && h.to ? ` to ${nickname(channel, h.to)}` : ""}`,
        task: t.id,
        ...(MOVE_TONES[h.what] ? { tone: MOVE_TONES[h.what] } : {}),
      })
    }
    const pr = t.pr
    if (pr?.at !== undefined) out.push({ at: pr.at, who: pr.by ?? t.owner ?? t.createdBy, text: `opened PR #${pr.number}`, task: t.id })
    if (pr?.mergedAt !== undefined) out.push({ at: pr.mergedAt, who: pr.by ?? t.owner ?? t.createdBy, text: `merged PR #${pr.number}`, task: t.id, tone: "tone-live" })
  }
  if (spec.result)
    out.push({
      at: spec.result.at,
      who: spec.result.by,
      text: spec.result.verdict === "accepted" ? "accepted the result" : "dropped it",
      tone: spec.result.verdict === "accepted" ? "tone-live" : "tone-quiet",
    })
  return out.sort((a, b) => a.at - b.at)
}

export function lastMove(channel: Channel, spec: Spec): number {
  return Math.max(spec.edited.at, spec.approved?.at ?? 0, ...tasksOf(channel, spec).map((t) => t.updatedAt))
}

export function insideOf(channel: Pick<Channel, "messages">, spec: Pick<Spec, "ask" | "tasks">): Message[] {
  const tasks = new Set(spec.tasks)
  return channel.messages.filter((m) => m.seq === spec.ask || m.inThread === spec.ask || (m.where.kind === "task" && tasks.has(m.where.task))).sort((a, b) => a.at - b.at)
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
