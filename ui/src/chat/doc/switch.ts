import { useSyncExternalStore } from "react"

const KEY = "kiwi:thread-docs"
const heard = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    // Storage can be off (private windows, blocked site data): threads keep the composer.
    return false
  }
}

let on = read()

export function threadDocsOn(): boolean {
  return on
}

export function setThreadDocs(next: boolean): void {
  on = next
  try {
    localStorage.setItem(KEY, next ? "1" : "0")
  } catch {
    // Storage can be off: the switch lasts until the window reloads.
  }
  for (const f of heard) f()
}

export function useThreadDocs(): boolean {
  return useSyncExternalStore((f) => {
    heard.add(f)
    return () => heard.delete(f)
  }, threadDocsOn)
}
