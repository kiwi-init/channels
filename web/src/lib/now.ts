import { prChecks, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { statusOf, type TaskStatus } from "@kiwi/core/status.ts"
import { FAILED } from "@kiwi/core/prs.ts"
import { startOfDay } from "@kiwi/app/views.ts"

const NEXT_NOTE = "next"
export const WORKING_SHOWN = 5
export const DONE_SHOWN = 3

export interface NowTask {
  id: number
  title: string
  owner: string | null
  stage: string
  red: boolean
  needsYou: boolean
}

export interface NowCard {
  next: string | null
  working: NowTask[]
  moreWorking: number
  done: NowTask[]
  doneCount: number
}

function stageWords(state: ChannelState, { stage: s, release }: TaskStatus): { text: string; red: boolean } {
  const pr = s.pr ? `PR #${s.pr.number}` : null
  const runs = s.pr ? prChecks(state.github, s.pr) : []
  switch (s.stage) {
    case "red": {
      const failed = runs.filter((r) => r.conclusion && FAILED.has(r.conclusion)).map((r) => r.name)
      return { text: `${pr} · ${failed.length === 1 ? `${failed[0]} failed` : `${failed.length} checks failed`}`, red: true }
    }
    case "proving": {
      const running = runs.filter((r) => !r.conclusion).length
      return { text: `${pr} · ${running ? "checks running" : runs.length ? "checks passed" : "no checks yet"}`, red: false }
    }
    case "yours":
      return { text: pr ? `${pr} · review owed` : "review owed", red: false }
    case "done":
      if (release) return { text: pr ? `${pr} · shipped in ${release}` : `shipped in ${release}`, red: false }
      return { text: pr && s.pr?.state === "merged" ? `${pr} merged` : "done", red: false }
    default:
      return { text: pr ?? "no PR yet", red: false }
  }
}

function row(state: ChannelState, t: Task, status: TaskStatus): NowTask {
  const { text, red } = stageWords(state, status)
  return { id: t.id, title: t.title, owner: t.owner ?? null, stage: text, red, needsYou: status.status === "needs you" }
}

const doneAt = (t: Task, s: TaskStatus): number => (s.stage.pr?.state === "merged" ? s.stage.pr.at : t.updatedAt)

export function nowCard(state: ChannelState, now: number): NowCard {
  const note = state.facts.get(NEXT_NOTE)
  const next = note && (!note.expires || note.expires > now) ? note.value.trim() || null : null
  const tasks = [...state.tasks.values()].filter((t) => !t.archived).map((t) => ({ t, s: statusOf(state, t) }))
  const working = tasks.filter(({ s }) => s.status === "working" || s.status === "needs you").sort((a, b) => b.t.updatedAt - a.t.updatedAt)
  const since = startOfDay(now)
  const done = tasks.filter(({ t, s }) => (s.status === "done" || s.status === "shipped") && doneAt(t, s) >= since).sort((a, b) => doneAt(b.t, b.s) - doneAt(a.t, a.s))
  return {
    next,
    working: working.slice(0, WORKING_SHOWN).map(({ t, s }) => row(state, t, s)),
    moreWorking: Math.max(0, working.length - WORKING_SHOWN),
    done: done.slice(0, DONE_SHOWN).map(({ t, s }) => row(state, t, s)),
    doneCount: done.length,
  }
}
