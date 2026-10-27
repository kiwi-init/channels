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

const TINT_KEY = "mc.tint"
// The tint "accent" is the system's accent colour (System Settings on a Mac, the
// desktop's Settings portal on Linux), followed as it changes. Only an app whose
// bridge reads it (the desktop app) offers it. The last one seen is kept, so the
// first paint has it before the bridge answers.
export const ACCENT_TINT = "accent"
const ACCENT_KEY = "mc.accent"
const HEX = /^#[0-9a-f]{6}$/

function readTint(): string | null {
  const v = localStorage.getItem(TINT_KEY)
  return v && (HEX.test(v) || v === ACCENT_TINT) ? v : null
}

function readAccent(): string | null {
  const v = localStorage.getItem(ACCENT_KEY)
  return v && HEX.test(v) ? v : null
}

function applyTint(t: string | null) {
  const color = t === ACCENT_TINT ? readAccent() : t
  const root = document.documentElement
  if (color) {
    root.dataset.tint = ""
    root.style.setProperty("--tint", color)
  } else {
    delete root.dataset.tint
    root.style.removeProperty("--tint")
  }
}

export function setTint(t: string | null) {
  if (t && (HEX.test(t) || t === ACCENT_TINT)) localStorage.setItem(TINT_KEY, t)
  else localStorage.removeItem(TINT_KEY)
  applyTint(readTint())
  for (const l of listeners) l()
}

function setAccent(color: string | null) {
  if (color && HEX.test(color)) localStorage.setItem(ACCENT_KEY, color)
  else localStorage.removeItem(ACCENT_KEY)
  if (readTint() === ACCENT_TINT) applyTint(ACCENT_TINT)
  for (const l of listeners) l()
}

/** Reads the system accent and follows it, when the bridge has one. */
export function followAccent() {
  const b = bridge()
  if (!b?.getAccentColor) return
  void b.getAccentColor().then(setAccent, () => {})
  b.onAccent(setAccent)
}

/** The system accent colour, or null when this app can't read one. */
export function useAccent(): string | null {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, readAccent)
}

export function useTint(): string | null {
  return useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, readTint)
}

/** Run once before the first render, so the page never paints in the wrong theme or size. */
export function applyStoredAppearance() {
  apply(read())
  applySize(readSize())
  applyTint(readTint())
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
