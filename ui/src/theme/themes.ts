import type { Appearance, CustomTheme, Prefs, ThemeBase } from "../model"
import { CHANNELS_DARK, CHANNELS_LIGHT, CHANNELS_OLED } from "./channels"
import { compose, hex, isHex, type ColorTheme, type Colors } from "./derive"
import { REX_THEMES } from "./rex-themes"

export type ThemePrefs = Pick<Prefs, "theme" | "darkTheme" | "lightTheme" | "customThemes">

type Owned = Pick<Prefs, "darkTheme" | "lightTheme" | "customThemes">

const fallback = (a: Appearance): ColorTheme => (a === "dark" ? CHANNELS_OLED : CHANNELS_LIGHT)

export const isBuiltin = (t: ColorTheme): boolean => t.id === CHANNELS_OLED.id || t.id === CHANNELS_LIGHT.id

export function customColors(t: Pick<CustomTheme, "appearance" | "base">): Colors {
  const b = t.base
  return compose({
    appearance: t.appearance,
    bg: b.background,
    ink: b.text,
    accent: b.accent,
    live: b.success,
    doing: b.info,
    review: b.magenta,
    decide: b.warning,
    alert: b.danger,
    red: b.red,
    yellow: b.yellow,
    green: b.green,
    teal: b.cyan,
    blue: b.blue,
    violet: b.magenta,
  })
}

const toTheme = (t: CustomTheme): ColorTheme => ({ id: t.id, name: t.name, appearance: t.appearance, colors: customColors(t) })

export const allThemes = (custom: readonly CustomTheme[]): ColorTheme[] => [CHANNELS_OLED, CHANNELS_DARK, CHANNELS_LIGHT, ...REX_THEMES, ...custom.map(toTheme)]

export function resolveMode(mode: Prefs["theme"], systemDark: boolean): Appearance {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode
}

export function activeTheme(p: ThemePrefs, systemDark: boolean): ColorTheme {
  const appearance = resolveMode(p.theme, systemDark)
  const id = appearance === "dark" ? p.darkTheme : p.lightTheme
  const own = p.customThemes.find((c) => c.id === id)
  const found = own ? toTheme(own) : [CHANNELS_OLED, CHANNELS_DARK, CHANNELS_LIGHT, ...REX_THEMES].find((t) => t.id === id)
  return found && found.appearance === appearance ? found : fallback(appearance)
}

export function baseOf(c: Colors): Required<ThemeBase> {
  return {
    background: hex(c.bg),
    text: hex(c.ink),
    accent: hex(c.accent),
    success: hex(c.live),
    warning: hex(c.decide),
    danger: hex(c.alert),
    info: hex(c.doing),
    red: hex(c["c-red"]),
    yellow: hex(c["c-yellow"]),
    green: hex(c["c-green"]),
    cyan: hex(c["c-teal"]),
    blue: hex(c["c-blue"]),
    magenta: hex(c["c-violet"]),
  }
}

export const movedDark = (saved: string, moved: boolean): string => (!moved && saved === CHANNELS_DARK.id ? CHANNELS_OLED.id : saved)

export function savedTheme(p: Owned, t: CustomTheme): Owned {
  const customThemes = p.customThemes.some((c) => c.id === t.id) ? p.customThemes.map((c) => (c.id === t.id ? t : c)) : [...p.customThemes, t]
  return {
    customThemes,
    darkTheme: t.appearance === "dark" ? t.id : p.darkTheme === t.id ? CHANNELS_OLED.id : p.darkTheme,
    lightTheme: t.appearance === "light" ? t.id : p.lightTheme === t.id ? CHANNELS_LIGHT.id : p.lightTheme,
  }
}

export function deletedTheme(p: Owned, id: string): Owned {
  return {
    customThemes: p.customThemes.filter((c) => c.id !== id),
    darkTheme: p.darkTheme === id ? CHANNELS_OLED.id : p.darkTheme,
    lightTheme: p.lightTheme === id ? CHANNELS_LIGHT.id : p.lightTheme,
  }
}

const KEYS = ["background", "text", "accent", "success", "warning", "danger", "info", "red", "yellow", "green", "cyan", "blue", "magenta"] as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function cleanBase(raw: unknown): ThemeBase | null {
  if (!isRecord(raw)) return null
  const pick = (k: (typeof KEYS)[number]): string | undefined => {
    const v = raw[k]
    return typeof v === "string" && isHex(v) ? v.toLowerCase() : undefined
  }
  const background = pick("background")
  const text = pick("text")
  const accent = pick("accent")
  if (!background || !text || !accent) return null
  const base: ThemeBase = { background, text, accent }
  for (const k of KEYS.slice(3)) {
    const v = pick(k)
    if (v) base[k] = v
  }
  return base
}

export function cleanThemes(raw: unknown): CustomTheme[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((t: unknown): CustomTheme[] => {
    if (!isRecord(t) || typeof t.id !== "string" || typeof t.name !== "string" || (t.appearance !== "dark" && t.appearance !== "light")) return []
    const base = cleanBase(t.base)
    return base ? [{ id: t.id, name: t.name, appearance: t.appearance, base }] : []
  })
}
