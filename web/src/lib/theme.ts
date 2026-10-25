import { useSyncExternalStore } from "react"
import { bridge } from "@/lib/secrets"
import type { TextStep } from "../../../desktop/src/text-size.ts"

// Light, dark, or whatever the system says, and how large the text reads.
// Both are per browser. "system" leaves <html> without data-theme so the CSS
// media query decides; the text size scales the type steps (--text-scale), not the page.

export type Appearance = "system" | "light" | "dark"

const KEY = "mc.appearance"
const listeners = new Set<() => void>()

function read(): Appearance {
  const v = localStorage.getItem(KEY)
  return v === "light" || v === "dark" ? v : "system"
}

function apply(a: Appearance) {
  if (a === "system") delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = a
  void bridge()
    ?.setAppearance(a)
    .catch(() => undefined)
}

export function showFrost(on: boolean) {
  if (on) document.documentElement.dataset.frost = ""
  else delete document.documentElement.dataset.frost
}

export function setAppearance(a: Appearance) {
  if (a === "system") localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, a)
  apply(a)
  for (const l of listeners) l()
}

export type TextSize = "small" | "default" | "large" | "larger"
const TEXT_SIZES: Record<TextSize, number> = { small: 0.92, default: 1, large: 1.1, larger: 1.22 }
const SIZE_KEY = "mc.text-size"

function readSize(): TextSize {
  const v = localStorage.getItem(SIZE_KEY)
  return v === "small" || v === "large" || v === "larger" ? v : "default"
}

/**
 * Text size scales the type, not the page: index.css's type steps multiply by --text-scale, so words
 * grow while the layout (header row, controls, gaps, the traffic lights' place) stays put. (It used to
 * zoom the whole page, which moved and stretched everything.)
 */
function applySize(t: TextSize) {
  const z = TEXT_SIZES[t]
  const root = document.documentElement.style
  root.removeProperty("zoom")
  if (z === 1) root.removeProperty("--text-scale")
  else root.setProperty("--text-scale", String(z))
}

export function setTextSize(t: TextSize) {
  if (t === "default") localStorage.removeItem(SIZE_KEY)
  else localStorage.setItem(SIZE_KEY, t)
  applySize(t)
  for (const l of listeners) l()
}

const SIZE_ORDER: TextSize[] = ["small", "default", "large", "larger"]

export function nextTextSize(t: TextSize, step: TextStep): TextSize {
  if (step === "reset") return "default"
  const i = SIZE_ORDER.indexOf(t) + (step === "bigger" ? 1 : -1)
  return SIZE_ORDER[Math.min(Math.max(i, 0), SIZE_ORDER.length - 1)] ?? t
}

export function stepTextSize(step: TextStep) {
  setTextSize(nextTextSize(readSize(), step))
}

export type Tint = "ink" | "violet" | "moss" | "amber" | "pine" | "accent"

export const TINTS: readonly { value: Tint; label: string }[] = [
  { value: "ink", label: "Ink" },
  { value: "violet", label: "Violet" },
  { value: "moss", label: "Moss" },
  { value: "amber", label: "Amber" },
  { value: "pine", label: "Pine" },
  { value: "accent", label: "Accent Color" },
]

const TINT_KEY = "mc.tint"

const TINT_BASES: Record<Exclude<Tint, "accent">, readonly [number, number, number]> = {
  ink: [0x09, 0x09, 0x0b],
  violet: [0x16, 0x12, 0x18],
  moss: [0x10, 0x15, 0x12],
  amber: [0x17, 0x13, 0x0e],
  pine: [0x02, 0x2c, 0x22],
}

export interface TintColors {
  accent: string
  text: string
  wash: string
  ring: string
  glass: string | null
}

const HEX = /^#[0-9a-f]{6}$/

function hueAndSaturation([r8, g8, b8]: readonly [number, number, number]): [number, number] {
  const [r, g, b] = [r8 / 255, g8 / 255, b8 / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const range = max - min
  if (range === 0) return [0, 0]
  const lightness = (max + min) / 2
  const saturation = lightness > 0.5 ? range / (2 - max - min) : range / (max + min)
  const sector = max === r ? ((g - b) / range) % 6 : max === g ? (b - r) / range + 2 : (r - g) / range + 4
  return [(sector * 60 + 360) % 360, saturation]
}

const rgbOf = (hex: string): readonly [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

export function tintColors(tint: Tint, systemAccent: string | null): TintColors {
  if (tint === "accent" && systemAccent && HEX.test(systemAccent)) {
    const [r, g, b] = rgbOf(systemAccent)
    return { accent: systemAccent, text: systemAccent, wash: `rgb(${r} ${g} ${b} / 0.18)`, ring: `rgb(${r} ${g} ${b} / 0.6)`, glass: systemAccent }
  }
  const [hue, saturation] = hueAndSaturation(TINT_BASES[tint === "accent" ? "ink" : tint])
  const s = Math.round(Math.min(saturation, 0.75) * 1000) / 10
  const h = Math.round(hue * 10) / 10
  return {
    accent: `hsl(${h} ${s}% 46%)`,
    text: `hsl(${h} ${s}% 72%)`,
    wash: `hsl(${h} ${s}% 46% / 0.18)`,
    ring: `hsl(${h} ${s}% 46% / 0.6)`,
    glass: tint === "ink" || tint === "accent" ? null : `hsl(${h} ${s}% 46%)`,
  }
}

function readTint(): Tint {
  const v = localStorage.getItem(TINT_KEY)
  return TINTS.some((t) => t.value === v) ? (v as Tint) : "ink"
}

let systemAccent: string | null = null
let accentWatched = false

function applyTint(t: Tint) {
  const c = tintColors(t, systemAccent)
  const root = document.documentElement.style
  root.setProperty("--tint-accent", c.accent)
  root.setProperty("--tint-text", c.text)
  root.setProperty("--tint-wash", c.wash)
  root.setProperty("--tint-ring", c.ring)
  if (c.glass) {
    root.setProperty("--tint-glass", c.glass)
    document.documentElement.dataset.glass = ""
  } else {
    root.removeProperty("--tint-glass")
    delete document.documentElement.dataset.glass
  }
  document.documentElement.dataset.tint = t
}

function watchAccent() {
  const b = bridge()
  if (accentWatched || !b || typeof b.getAccentColor !== "function") return
  accentWatched = true
  const take = (color: string | null) => {
    systemAccent = color
    if (readTint() === "accent") applyTint("accent")
    for (const l of listeners) l()
  }
  void b.getAccentColor().then(take, () => undefined)
  if (typeof b.onAccent === "function") b.onAccent(take)
}

export function setTint(t: Tint) {
  if (t === "ink") localStorage.removeItem(TINT_KEY)
  else localStorage.setItem(TINT_KEY, t)
  applyTint(t)
  for (const l of listeners) l()
}

/** Run once before the first render, so the page never paints in the wrong theme or size. */
export function applyStoredAppearance() {
  apply(read())
  applySize(readSize())
  applyTint(readTint())
  watchAccent()
}

export function tintSwatch(t: Tint, accent: string | null): string {
  return t === "ink" ? "#8e8e93" : tintColors(t, accent).accent
}

export function useSystemAccent(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => systemAccent
  )
}

export function useTint(): Tint {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, readTint)
}

export function useAppearance(): Appearance {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, read)
}

export function useTextSize(): TextSize {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, readSize)
}
