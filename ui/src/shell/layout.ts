import { useSyncExternalStore } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"

export interface Shape {
  rail: number
  side: number
  start: number
  left: boolean
}

export interface Painted {
  file: string
  attrs: Record<string, string>
  vars: Record<string, string>
  shape: Shape
}

export const LAYOUT_KEY = "ui.layout"
export const BASE: Shape = { rail: 64, side: 248, start: 400, left: false }

const listeners = new Set<() => void>()
let now: Painted | null = null

export function paint(next: Painted | null): void {
  const root = document.documentElement
  for (const a of Object.keys(now?.attrs ?? {})) delete root.dataset[a]
  for (const v of Object.keys(now?.vars ?? {})) root.style.removeProperty(v)
  for (const [a, value] of Object.entries(next?.attrs ?? {})) root.dataset[a] = value
  for (const [v, value] of Object.entries(next?.vars ?? {})) root.style.setProperty(v, value)
  now = next
  for (const l of listeners) l()
}

export const painted = (): Painted | null => now

export const layoutShape = (): Shape => now?.shape ?? BASE

export const useShape = (): Shape => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), layoutShape)

const served = (): boolean => typeof bridge()?.layouts === "function"

export function paintCached(): void {
  try {
    if (served()) paint(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null"))
  } catch {
    // A cache that can't be read paints the default: nothing was picked as far as this start knows.
  }
}

paintCached()

export function startLayout(): void {
  if (now) void import("~/layout/live").then((m) => m.startLayouts())
}
