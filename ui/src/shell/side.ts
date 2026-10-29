import { useSyncExternalStore } from "react"

import { toggleSidebar } from "@/lib/sidebar-hidden"

const listeners = new Set<() => void>()
let drawer = false

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export const useDrawer = (): boolean => useSyncExternalStore(subscribe, () => drawer)

export function setDrawer(open: boolean): void {
  if (drawer === open) return
  drawer = open
  for (const l of listeners) l()
}

const narrow = (): boolean => matchMedia("(max-width: 760px)").matches

export function toggleSide(): void {
  if (narrow()) setDrawer(!drawer)
  else toggleSidebar()
}

export const isSideKey = (e: KeyboardEvent): boolean => e.key === "\\" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
