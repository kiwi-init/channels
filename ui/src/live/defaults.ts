import { useMemo, useSyncExternalStore } from "react"

import { SCOPES, type Scope } from "@kiwi/core/scopes.ts"
import type { Powers } from "~/model"

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

const POWER_KEY = (roomId: string, power: keyof Powers) => `mc.${power}.${roomId}`

function powerOn(roomId: string, power: keyof Powers): boolean {
  try {
    return localStorage.getItem(POWER_KEY(roomId, power)) === "1"
  } catch {
    // Without storage nobody gets a power by default: the owner turns it on at Let in.
    return false
  }
}

export function newMemberPowers(roomId: string): Powers {
  return { addsAgents: powerOn(roomId, "addsAgents"), answersDecisions: powerOn(roomId, "answersDecisions"), managesAgents: powerOn(roomId, "managesAgents") }
}

export function setNewMemberPowers(roomId: string, powers: Powers): void {
  try {
    for (const power of ["addsAgents", "answersDecisions", "managesAgents"] as const) localStorage.setItem(POWER_KEY(roomId, power), powers[power] ? "1" : "0")
  } catch {
    // Without storage the choice lasts until the page reloads: nothing else to keep it in.
  }
  for (const l of listeners) l()
}

const powersKey = (p: Powers): string => `${p.addsAgents ? 1 : 0}${p.answersDecisions ? 1 : 0}${p.managesAgents ? 1 : 0}`

export function useNewPowers(roomId: string): Powers {
  const key = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => powersKey(newMemberPowers(roomId))
  )
  return useMemo(() => ({ addsAgents: key[0] === "1", answersDecisions: key[1] === "1", managesAgents: key[2] === "1" }), [key])
}
