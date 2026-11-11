import { useSyncExternalStore } from "react"

import { store } from "~/live/value"
import type { Message } from "~/model"

interface Activity {
  runs: readonly Message[][]
  here: number | null
  target: number | null
}

const shown = store<Activity | null>(null)

export function showActivity(next: Activity | null): void {
  if (next || shown.get()) shown.set(next)
}

export const useActivity = (): Activity | null => useSyncExternalStore(shown.subscribe, shown.get, shown.get)
