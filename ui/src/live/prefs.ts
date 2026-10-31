import { useMemo, useSyncExternalStore } from "react"

import { setAccessibilityOption, useAccessibilityOption } from "@kiwi/app/accessibility.ts"
import { setAppearance, setTextFont, setTextSize, useAppearance, useTextFont, useTextSize, type TextSize } from "@kiwi/app/theme.ts"
import type { CustomTheme, Prefs } from "~/model"
import { cleanFolders } from "~/shell/rail-items"
import { cleanThemes, deletedTheme, movedDark, savedTheme, type ThemePrefs } from "~/theme/themes"

type Own = Pick<Prefs, "notify" | "enterSends" | "darkTheme" | "lightTheme" | "customThemes" | "folders">

const KEY = "ui.prefs"
const MOVED = "ui.prefs.oled"
const DEFAULTS: Own = { notify: "mentions", enterSends: true, darkTheme: "channels-oled", lightTheme: "channels-light", customThemes: [], folders: [] }
const SIZES: readonly TextSize[] = ["small", "default", "large", "larger", "largest"]
const listeners = new Set<() => void>()
let own: Own | null = null

type Store = Pick<Storage, "getItem" | "setItem">

export function readPrefs(store: Store): Own {
  const raw = JSON.parse(store.getItem(KEY) ?? "{}") as Partial<Own>
  const moved = store.getItem(MOVED) === "1"
  const read: Own = {
    notify: raw.notify === "all" || raw.notify === "none" || raw.notify === "mentions" ? raw.notify : DEFAULTS.notify,
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
  if (p.notify !== undefined || p.enterSends !== undefined || p.darkTheme !== undefined || p.lightTheme !== undefined || p.customThemes !== undefined || p.folders !== undefined)
    writeOwn({
      ...readOwn(),
      ...(p.notify !== undefined ? { notify: p.notify } : {}),
      ...(p.enterSends !== undefined ? { enterSends: p.enterSends } : {}),
      ...(p.darkTheme !== undefined ? { darkTheme: p.darkTheme } : {}),
      ...(p.lightTheme !== undefined ? { lightTheme: p.lightTheme } : {}),
      ...(p.customThemes !== undefined ? { customThemes: p.customThemes } : {}),
      ...(p.folders !== undefined ? { folders: p.folders } : {}),
    })
}

export const saveTheme = (theme: CustomTheme): void => writeOwn({ ...readOwn(), ...savedTheme(readOwn(), theme) })

export const deleteTheme = (id: string): void => writeOwn({ ...readOwn(), ...deletedTheme(readOwn(), id) })
