import { useSyncExternalStore } from "react"

import { TOKENS, type ColorTheme, type Colors } from "~/theme/derive"
import { activeTheme, isBuiltin, type ThemePrefs } from "~/theme/themes"

let preview: ColorTheme | null = null
const listeners = new Set<() => void>()

export function setPreview(theme: ColorTheme | null): void {
  preview = theme
  for (const l of listeners) l()
}

export const usePreview = (): ColorTheme | null =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => preview
  )

const query = (): MediaQueryList => matchMedia("(prefers-color-scheme: dark)")

const systemDark = (): boolean => query().matches

export const useSystemDark = (): boolean =>
  useSyncExternalStore((l) => {
    const m = query()
    m.addEventListener("change", l)
    return () => m.removeEventListener("change", l)
  }, systemDark)

export function applyTheme(colors: Colors | null): void {
  const style = document.documentElement.style
  for (const t of TOKENS) {
    if (colors) style.setProperty(`--${t}`, colors[t])
    else style.removeProperty(`--${t}`)
  }
}

export const colorsOf = (t: ColorTheme): Colors | null => (isBuiltin(t) ? null : t.colors)

export function bootTheme(p: ThemePrefs): void {
  const root = document.documentElement
  if (p.theme === "system") delete root.dataset.theme
  else root.dataset.theme = p.theme
  applyTheme(colorsOf(activeTheme(p, systemDark())))
}
