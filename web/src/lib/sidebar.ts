// Whether the channel list is open beside the conversation (on a wide window; a phone shows one or
// the other). Per browser, shared by the list, the conversation's header and the app shell through a
// tiny store, so the toggle in either header moves them all. ⌘B (Ctrl+B) toggles it, and ⌃⌘S as in macOS apps.

import { useEffect, useSyncExternalStore } from "react"

const KEY = "mc.sidebar"
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "closed"
  } catch {
    return true
  }
}

function setSidebarOpen(open: boolean): void {
  try {
    if (open) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, "closed")
  } catch {
    // Not kept: it still moves for this session.
  }
  for (const l of listeners) l()
}

export const toggleSidebar = () => setSidebarOpen(!read())

export function useSidebarOpen(): boolean {
  return useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), read)
}

/** ⌘B (Ctrl+B elsewhere) shows or hides the list; so does ⌃⌘S, the macOS convention. */
export function useSidebarShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mac = /Mac/.test(navigator.platform)
      const key = e.key.toLowerCase()
      const cmdB = key === "b" && !e.shiftKey && !e.altKey && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
      const ctrlCmdS = key === "s" && (mac ? e.metaKey && e.ctrlKey : e.ctrlKey && e.altKey)
      if (cmdB || ctrlCmdS) {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
