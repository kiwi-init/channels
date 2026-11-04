import { useSyncExternalStore } from "react"

import { store } from "~/live/value"

const KEY = "mc.debug-options"

function saved(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    // Storage is off: debug options stay off, the default.
    return false
  }
}

const debugOptions = store<boolean>(saved())

export function setDebugOptions(on: boolean): void {
  debugOptions.set(on)
  try {
    if (on) localStorage.setItem(KEY, "1")
    else localStorage.removeItem(KEY)
  } catch {
    // Storage is off: the switch holds until the app restarts.
  }
}

export const useDebugOptions = (): boolean => useSyncExternalStore(debugOptions.subscribe, debugOptions.get)
