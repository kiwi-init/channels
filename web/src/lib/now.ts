import { prChecks, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { stageOf } from "@kiwi/core/stage.ts"
import { FAILED } from "@kiwi/core/prs.ts"
import { startOfDay } from "./views"

const NEXT_NOTE = "next"
export const WORKING_SHOWN = 5
export const DONE_SHOWN = 3

export interface NowTask {
  id: number
  title: string
  owner: string | null
  stage: string
  red: boolean
}

export interface NowCard {
  next: string | null
  working: NowTask[]
  moreWorking: number
  done: NowTask[]
  doneCount: number
}

function stageWords(state: ChannelState, t: Task): { text: string; red: boolean } {
  const s = stageOf(state, t)
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
      return { text: pr && s.pr?.state === "merged" ? `${pr} merged` : "done", red: false }
    default:
      return { text: pr ?? "no PR yet", red: false }
  }
}

function row(state: ChannelState, t: Task): NowTask {
  const { text, red } = stageWords(state, t)
  return { id: t.id, title: t.title, owner: t.owner ?? null, stage: text, red }
}

export function nowCard(state: ChannelState, now: number): NowCard {
  const note = state.facts.get(NEXT_NOTE)
  const next = note && (!note.expires || note.expires > now) ? note.value.trim() || null : null
  const tasks = [...state.tasks.values()].filter((t) => !t.archived)
  const working = tasks.filter((t) => t.state !== "done" && t.owner).sort((a, b) => b.updatedAt - a.updatedAt)
  const since = startOfDay(now)
  const done = tasks.filter((t) => t.state === "done" && !t.cancelled && t.updatedAt >= since).sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    next,
    working: working.slice(0, WORKING_SHOWN).map((t) => row(state, t)),
    moreWorking: Math.max(0, working.length - WORKING_SHOWN),
    done: done.slice(0, DONE_SHOWN).map((t) => row(state, t)),
    doneCount: done.length,
  }
}
