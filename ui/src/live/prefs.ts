import { useMemo, useSyncExternalStore } from "react"

import { setAccessibilityOption, useAccessibilityOption } from "@kiwi/app/accessibility.ts"
import { setAppearance, setTextFont, setTextSize, useAppearance, useTextFont, useTextSize, type TextSize } from "@kiwi/app/theme.ts"
import { afkMinutes, DEFAULT_AFK } from "~/afk/wait"
import type { CustomTheme, Prefs } from "~/model"
import { cleanFolders } from "~/shell/rail-items"
import { cleanThemes, deletedTheme, movedDark, savedTheme, type ThemePrefs } from "~/theme/themes"

type Own = Pick<Prefs, "muted" | "enterSends" | "darkTheme" | "lightTheme" | "customThemes" | "folders" | "afk">

const KEY = "ui.prefs"
const MOVED = "ui.prefs.oled"
const CINDER = "ui.prefs.cinder"
const DEFAULTS: Own = {
  muted: [],
  enterSends: true,
  darkTheme: "cinder-peak",
  lightTheme: "channels-light",
  customThemes: [],
  folders: [],
  afk: DEFAULT_AFK,
}
const SIZES: readonly TextSize[] = ["small", "default", "large", "larger", "largest"]
const listeners = new Set<() => void>()
let own: Own | null = null

type Store = Pick<Storage, "getItem" | "setItem">

export function readPrefs(store: Store): Own {
  const raw = JSON.parse(store.getItem(KEY) ?? "{}") as Partial<Own> & { calm?: unknown }
  const moved = { oled: store.getItem(MOVED) === "1", cinder: store.getItem(CINDER) === "1" }
  const read: Own = {
    muted: Array.isArray(raw.muted) ? [...new Set(raw.muted.filter((k): k is string => typeof k === "string" && !!k))].slice(0, 500) : [],
    enterSends: typeof raw.enterSends === "boolean" ? raw.enterSends : DEFAULTS.enterSends,
    darkTheme: typeof raw.darkTheme === "string" ? movedDark(raw.darkTheme, moved) : DEFAULTS.darkTheme,
    lightTheme: typeof raw.lightTheme === "string" ? raw.lightTheme : DEFAULTS.lightTheme,
    customThemes: cleanThemes(raw.customThemes),
    folders: cleanFolders(raw.folders),
    afk: afkMinutes(raw.afk ?? raw.calm),
  }
  if (!moved.oled || !moved.cinder) {
    try {
      if (typeof raw.darkTheme === "string" && raw.darkTheme !== read.darkTheme) store.setItem(KEY, JSON.stringify(read))
      store.setItem(MOVED, "1")
      store.setItem(CINDER, "1")
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

const OWN_KEYS = ["muted", "enterSends", "darkTheme", "lightTheme", "customThemes", "folders", "afk"] as const satisfies readonly (keyof Own)[]

export const saveTheme = (theme: CustomTheme): void => writeOwn({ ...readOwn(), ...savedTheme(readOwn(), theme) })

export const deleteTheme = (id: string): void => writeOwn({ ...readOwn(), ...deletedTheme(readOwn(), id) })
