import { useMemo, useSyncExternalStore } from "react"

import { setAccessibilityOption, useAccessibilityOption } from "@/lib/accessibility"
import { setAppearance, setTextSize, useAppearance, useTextSize, type TextSize } from "@/lib/theme"
import type { Prefs } from "~/model"

type Own = Pick<Prefs, "notify" | "sound" | "enterSends">

const KEY = "ui.prefs"
const DEFAULTS: Own = { notify: "mentions", sound: false, enterSends: true }
const SIZES: readonly TextSize[] = ["small", "default", "large", "larger"]
const listeners = new Set<() => void>()
let own: Own | null = null

function readOwn(): Own {
  if (own) return own
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Own>
    own = {
      notify: raw.notify === "all" || raw.notify === "none" || raw.notify === "mentions" ? raw.notify : DEFAULTS.notify,
      sound: typeof raw.sound === "boolean" ? raw.sound : DEFAULTS.sound,
      enterSends: typeof raw.enterSends === "boolean" ? raw.enterSends : DEFAULTS.enterSends,
    }
  } catch {
    own = DEFAULTS
  }
  return own
}

function writeOwn(next: Own): void {
  own = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Without storage the choice lasts until the page reloads: nothing else to keep it in.
  }
  for (const l of listeners) l()
}

export const ownPrefs = (): Own => readOwn()

export function usePrefs(): Prefs {
  const theme = useAppearance()
  const size = useTextSize()
  const reduceMotion = useAccessibilityOption("reduce-motion")
  const mine = useSyncExternalStore((l) => {
    listeners.add(l)
    return () => void listeners.delete(l)
  }, readOwn)
  return useMemo(() => ({ theme, textSize: SIZES.indexOf(size) - 1, reduceMotion, ...mine }), [theme, size, reduceMotion, mine])
}

export function setPrefs(p: Partial<Prefs>): void {
  if (p.theme) setAppearance(p.theme)
  if (p.textSize !== undefined) setTextSize(SIZES[Math.min(Math.max(Math.round(p.textSize) + 1, 0), SIZES.length - 1)] ?? "default")
  if (p.reduceMotion !== undefined) setAccessibilityOption("reduce-motion", p.reduceMotion)
  if (p.notify !== undefined || p.sound !== undefined || p.enterSends !== undefined)
    writeOwn({
      ...readOwn(),
      ...(p.notify !== undefined ? { notify: p.notify } : {}),
      ...(p.sound !== undefined ? { sound: p.sound } : {}),
      ...(p.enterSends !== undefined ? { enterSends: p.enterSends } : {}),
    })
}
