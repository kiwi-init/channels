import { useSyncExternalStore } from "react"

import { SCOPES, type Scope } from "@kiwi/core/scopes.ts"

const KEY = (roomId: string) => `mc.scopes.${roomId}`
const listeners = new Set<() => void>()

export function newMemberScopes(roomId: string): Scope[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(roomId)) ?? "null") as unknown
    return Array.isArray(raw) && raw.length === 0 ? [] : [...SCOPES]
  } catch {
    return [...SCOPES]
  }
}

export function setNewMemberScopes(roomId: string, can: "read" | "write"): void {
  try {
    localStorage.setItem(KEY(roomId), JSON.stringify(can === "read" ? [] : [...SCOPES]))
  } catch {
    // Without storage the choice lasts until the page reloads: nothing else to keep it in.
  }
  for (const l of listeners) l()
}

export function useNewMembers(roomId: string): "read" | "write" {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => (newMemberScopes(roomId).length === 0 ? "read" : "write")
  )
}
