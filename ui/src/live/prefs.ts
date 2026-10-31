import { useMemo, useSyncExternalStore } from "react"

import { setAccessibilityOption, useAccessibilityOption } from "@kiwi/app/accessibility.ts"
import { setAppearance, setTextFont, setTextSize, useAppearance, useTextFont, useTextSize, type TextSize } from "@kiwi/app/theme.ts"
import type { CustomTheme, Prefs, Quiet } from "~/model"
import { cleanFolders } from "~/shell/rail-items"
import { cleanThemes, deletedTheme, movedDark, savedTheme, type ThemePrefs } from "~/theme/themes"

type Own = Pick<Prefs, "notify" | "muted" | "snoozeUntil" | "quiet" | "mentionSound" | "enterSends" | "darkTheme" | "lightTheme" | "customThemes" | "folders">

const KEY = "ui.prefs"
const MOVED = "ui.prefs.oled"
const DEFAULTS: Own = {
  notify: "mentions",
  muted: [],
  snoozeUntil: null,
  quiet: { on: false, from: 22 * 60, to: 8 * 60 },
  mentionSound: true,
  enterSends: true,
  darkTheme: "channels-oled",
  lightTheme: "channels-light",
  customThemes: [],
  folders: [],
}
const SIZES: readonly TextSize[] = ["small", "default", "large", "larger", "largest"]
const listeners = new Set<() => void>()
let own: Own | null = null

type Store = Pick<Storage, "getItem" | "setItem">

const minuteOfDay = (x: unknown, fallback: number): number => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 1440 ? x : fallback)

function quietOf(x: unknown): Quiet {
  const q = x && typeof x === "object" ? (x as Partial<Record<keyof Quiet, unknown>>) : {}
  return { on: q.on === true, from: minuteOfDay(q.from, DEFAULTS.quiet.from), to: minuteOfDay(q.to, DEFAULTS.quiet.to) }
}

export function readPrefs(store: Store): Own {
  const raw = JSON.parse(store.getItem(KEY) ?? "{}") as Partial<Own>
  const moved = store.getItem(MOVED) === "1"
  const read: Own = {
    notify: raw.notify === "all" || raw.notify === "none" || raw.notify === "mentions" ? raw.notify : DEFAULTS.notify,
    muted: Array.isArray(raw.muted) ? [...new Set(raw.muted.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 200))].slice(0, 500) : [],
    snoozeUntil: typeof raw.snoozeUntil === "number" && Number.isFinite(raw.snoozeUntil) ? raw.snoozeUntil : null,
    quiet: quietOf(raw.quiet),
    mentionSound: typeof raw.mentionSound === "boolean" ? raw.mentionSound : DEFAULTS.mentionSound,
    enterSends: typeof raw.enterSends === "boolean" ? raw.enterSends : DEFAULTS.enterSends,
    darkTheme: typeof raw.darkTheme === "string" ? movedDark(raw.darkTheme, moved) : DEFAULTS.darkTheme,
    lightTheme: typeof raw.lightTheme === "string" ? raw.lightTheme : DEFAULTS.lightTheme,
    customThemes: cleanThemes(raw.customThemes),
    folders: cleanFolders(raw.folders),
  }
  if (!moved) {
    try {
      if (typeof raw.darkTheme === "string" && raw.darkTheme !== read.darkTheme) store.setItem(KEY, JSON.stringify(read))
      store.setItem(MOVED, "1")
    } catch {
      // Without storage the move runs again on the next load and lands the same way.
    }
  }
  return read
}

function readOwn(): Own {
  if (own) return own
  try {
    own = readPrefs(localStorage)
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

export function storedThemePrefs(): ThemePrefs {
  const mode = document.documentElement.dataset.theme
  const { darkTheme, lightTheme, customThemes } = readOwn()
  return { theme: mode === "dark" || mode === "light" ? mode : "system", darkTheme, lightTheme, customThemes }
}

export function usePrefs(): Prefs {
  const theme = useAppearance()
  const size = useTextSize()
  const font = useTextFont()
  const reduceMotion = useAccessibilityOption("reduce-motion")
  const mine = useSyncExternalStore((l) => {
    listeners.add(l)
    return () => void listeners.delete(l)
  }, readOwn)
  return useMemo(() => ({ theme, textSize: SIZES.indexOf(size) - 1, font, reduceMotion, ...mine }), [theme, size, font, reduceMotion, mine])
}

export function setPrefs(p: Partial<Prefs>): void {
  if (p.theme) setAppearance(p.theme)
  if (p.textSize !== undefined) setTextSize(SIZES[Math.min(Math.max(Math.round(p.textSize) + 1, 0), SIZES.length - 1)] ?? "default")
  if (p.font !== undefined) setTextFont(p.font)
  if (p.reduceMotion !== undefined) setAccessibilityOption("reduce-motion", p.reduceMotion)
  const changed: Partial<Own> = Object.fromEntries(OWN_KEYS.flatMap((k) => (p[k] !== undefined ? [[k, p[k]]] : [])))
  if (Object.keys(changed).length) writeOwn({ ...readOwn(), ...changed })
}

const OWN_KEYS = ["notify", "muted", "snoozeUntil", "quiet", "mentionSound", "enterSends", "darkTheme", "lightTheme", "customThemes", "folders"] as const satisfies readonly (keyof Own)[]

export const saveTheme = (theme: CustomTheme): void => writeOwn({ ...readOwn(), ...savedTheme(readOwn(), theme) })

export const deleteTheme = (id: string): void => writeOwn({ ...readOwn(), ...deletedTheme(readOwn(), id) })
