import { isRunning, type GithubNote } from "@kiwi/core/protocol.ts"
import { sameDay } from "~/kit/time"
import type { Message, Task } from "~/model"

export interface GithubPart {
  ref?: string
  url?: string
  text: string
}

export interface TaskRun {
  id: number
  list: Message[]
}

export type EventLine =
  | { kind: "one"; m: Message }
  | { kind: "events"; list: Message[] }
  | { kind: "tasks"; tasks: TaskRun[]; list: Message[] }
  | { kind: "github"; parts: GithubPart[]; updates: number; list: Message[] }

const FOLD_AT = 3

const isEvent = (m: Message | undefined): m is Message => !!m?.system && !m.leftOut

const joins = (a: Message | undefined, b: Message | undefined, breaks: ReadonlySet<number>): boolean => isEvent(a) && isEvent(b) && sameDay(a.at, b.at) && !breaks.has(b.seq)

export function continuesRun(list: readonly Message[], i: number, from: number, breaks: ReadonlySet<number>): boolean {
  return i > from && joins(list[i - 1], list[i], breaks)
}

export function eventRun(list: readonly Message[], i: number, to: number, breaks: ReadonlySet<number>): Message[] | null {
  if (!isEvent(list[i])) return null
  let end = i + 1
  while (end < to && joins(list[end - 1], list[end], breaks)) end++
  return list.slice(i, end)
}

export function linesOf(run: readonly Message[], tasks: ReadonlyMap<number, Task>): EventLine[] {
  const out: (EventLine | null)[] = []
  let events: Extract<EventLine, { kind: "events" }> | null = null
  let work: Extract<EventLine, { kind: "tasks" }> | null = null
  let github: { list: Message[] } | null = null
  let githubAt = -1
  const yours = new Map<number, number>()
  for (const m of run) {
    const task = m.task !== undefined ? tasks.get(m.task) : undefined
    if (m.mentionsYou) out.push({ kind: "one", m })
    else if (task?.youReview) {
      const at = yours.get(task.id)
      if (at === undefined) yours.set(task.id, out.push({ kind: "one", m }) - 1)
      else out[at] = { kind: "one", m }
    } else if (task) {
      if (!work) out.push((work = { kind: "tasks", tasks: [], list: [] }))
      work.list.push(m)
      const at = work.tasks.find((t) => t.id === task.id)
      if (at) at.list.push(m)
      else work.tasks.push({ id: task.id, list: [m] })
    } else if (m.github) {
      if (!github) {
        github = { list: [] }
        githubAt = out.length
        out.push(null)
      }
      github.list.push(m)
    } else {
      if (!events) out.push((events = { kind: "events", list: [] }))
      events.list.push(m)
    }
  }
  if (github) {
    const items = github.list.flatMap((m) => m.github ?? []).filter((i) => !isRunning(i))
    out[githubAt] = { kind: "github", parts: githubSummary(items), updates: items.length, list: github.list }
  }
  return out.flatMap((line): EventLine[] => {
    if (!line) return []
    if (line.kind === "events" && line.list.length < FOLD_AT) return line.list.map((m) => ({ kind: "one", m }))
    if (line.kind === "tasks" && line.list.length === 1) return [{ kind: "one", m: line.list[0]! }]
    return [line]
  })
}

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"])

const PR_WORD: Record<string, string> = { opened: "opened", reopened: "reopened", closed: "closed", ready_for_review: "ready for review", converted_to_draft: "back to draft", edited: "edited" }

function checkWord(i: GithubNote): string | null {
  if (!i.conclusion) return null
  if (i.conclusion === "success") return "passed"
  if (FAILED.has(i.conclusion)) return "failed"
  return i.conclusion.replace(/_/g, " ")
}

export function githubSummary(items: readonly GithubNote[]): GithubPart[] {
  const prs = new Map<string, GithubPart>()
  const issues = new Map<string, GithubPart>()
  const checks = new Map<string, string>()
  let pushes = 0
  let syncs = 0
  for (const i of items) {
    if (i.event === "pull_request" && i.number) {
      const key = `${i.repo}#${i.number}`
      const was = prs.get(key)
      const word = i.merged ? "merged" : PR_WORD[i.action ?? ""]
      if (i.action === "synchronize") syncs++
      const url = i.url ?? was?.url
      prs.set(key, { ref: `#${i.number}`, ...(url ? { url } : {}), text: word ?? was?.text ?? "updated" })
    } else if (i.event === "issues" && i.number) {
      issues.set(`${i.repo}#${i.number}`, { ref: `issue #${i.number}`, ...(i.url ? { url: i.url } : {}), text: i.action ?? "updated" })
    } else if ((i.event === "check_run" || i.event === "workflow_run") && i.name) {
      const word = checkWord(i)
      if (word) checks.set(i.name, word)
    } else if (i.event === "push") pushes++
  }
  const pushed = pushes || syncs
  return [...prs.values(), ...issues.values(), ...(pushed ? [{ text: pushed === 1 ? "1 push" : `${pushed} pushes` }] : []), ...[...checks].map(([name, word]) => ({ text: `${name} ${word}` }))]
}
