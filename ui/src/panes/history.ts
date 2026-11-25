import type { Edge } from "~/panes/store"

type Act = "open" | "move" | "close" | "resize" | "replace"

export type By = "app" | "hand"

interface Spot {
  pane: string
  what: string
  x: number
  y: number
  w: number
  h: number
}

export interface Note {
  act: Act
  pane: string
  what: string
  target?: string
  edge?: Edge | "fill"
}

export interface Step extends Note {
  at: number
  code: string
  by: By
  screen: { w: number; h: number }
  panes: Spot[]
}

export interface Fix {
  placed: Step
  fixed: Step
}

const HISTORY = "mc.tiling"
const KEEP = 400
const SETTLE = 1500
const FIX = 15_000

export function remember(steps: readonly Step[], step: Step): Step[] {
  const last = steps.at(-1)
  const same = step.act === "resize" && last?.act === "resize" && last.pane === step.pane && last.code === step.code && step.at - last.at < SETTLE
  return [...(same ? steps.slice(0, -1) : steps), step].slice(-KEEP)
}

const placed = (step: Step): boolean => step.by === "app" && (step.act === "open" || step.act === "replace")

export function fixes(steps: readonly Step[]): Fix[] {
  const out: Fix[] = []
  steps.forEach((step, i) => {
    if (!placed(step)) return
    for (const next of steps.slice(i + 1)) {
      if (next.code !== step.code) continue
      if (next.at - step.at > FIX || placed(next)) return
      if (next.by === "hand" && (next.pane === step.pane || next.act === "resize")) return void out.push({ placed: step, fixed: next })
    }
  })
  return out
}

let held: Step[] | null = null
let saving = 0

function load(): Step[] {
  try {
    const got: unknown = JSON.parse(localStorage.getItem(HISTORY) ?? "[]")
    return Array.isArray(got) ? (got as Step[]) : []
  } catch {
    // A damaged or unreadable history starts empty; the next step writes a fresh one.
    return []
  }
}

export function note(step: Step): void {
  held = remember(held ?? load(), step)
  window.clearTimeout(saving)
  saving = window.setTimeout(() => {
    try {
      localStorage.setItem(HISTORY, JSON.stringify(held))
    } catch {
      // Storage is off: the history lasts until the app restarts.
    }
  }, 1000)
}
