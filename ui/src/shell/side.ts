import { useSyncExternalStore } from "react"

import { toggleSidebar } from "@kiwi/app/sidebar-hidden.ts"

const listeners = new Set<() => void>()
let drawer = false

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export const useDrawer = (): boolean => useSyncExternalStore(subscribe, () => drawer)

export function setDrawer(open: boolean): void {
  if (drawer === open) return
  drawer = open
  for (const l of listeners) l()
}

const narrow = (): boolean => matchMedia("(max-width: 760px)").matches || matchMedia("(orientation: portrait)").matches

export function toggleSide(): void {
  if (narrow()) setDrawer(!drawer)
  else toggleSidebar()
}

const TALL = "(orientation: portrait) and (min-width: 761px)"

const onResize = (l: () => void) => (window.addEventListener("resize", l), () => window.removeEventListener("resize", l))

/** A portrait window wider than a phone: the channel is one tall page there. */
export const useTall = (): boolean => useSyncExternalStore(onResize, () => matchMedia(TALL).matches)

export const isSideKey = (e: KeyboardEvent): boolean => e.key === "\\" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
