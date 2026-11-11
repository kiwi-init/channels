import { useSyncExternalStore } from "react"

import { store } from "~/live/value"
import type { Message } from "~/model"

interface Activity {
  runs: readonly Message[][]
  here: number | null
  target: number | null
}

const shown = store<Activity | null>(null)

const sameRuns = (a: readonly Message[][], b: readonly Message[][]): boolean => a.length === b.length && a.every((run, i) => run.length === b[i]!.length && run.every((m, j) => m === b[i]![j]))

export function showActivity(next: Activity | null): void {
  const now = shown.get()
  if (next === now || (next && now && next.here === now.here && next.target === now.target && sameRuns(next.runs, now.runs))) return
  shown.set(next)
}

export const useActivity = (): Activity | null => useSyncExternalStore(shown.subscribe, shown.get, shown.get)
