import { useSyncExternalStore } from "react"

import type { ColorTheme } from "./derive"

let themes: readonly ColorTheme[] = []
let loading: Promise<readonly ColorTheme[]> | null = null
const listeners = new Set<() => void>()

export const rexThemes = (): readonly ColorTheme[] => themes

export function loadRex(): Promise<readonly ColorTheme[]> {
  loading ??= import("./rex-themes").then((m) => {
    themes = m.REX_THEMES
    for (const l of listeners) l()
    return themes
  })
  return loading
}

export const useRex = (): readonly ColorTheme[] =>
  useSyncExternalStore((l) => {
    listeners.add(l)
    return () => void listeners.delete(l)
  }, rexThemes)
