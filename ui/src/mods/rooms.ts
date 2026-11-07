import type { ModRoomGrant } from "~/mods/protocol"

interface Granted {
  name: string
  state: string
  needs: readonly string[]
  rooms?: readonly { code: string; room: string }[]
}

const roomOf = (need: string, kind: "post" | "read"): string | null => (need.startsWith(`${kind}:`) ? need.slice(kind.length + 1).replace(/^#/, "") : null)

export const asksRooms = (needs: readonly string[]): string[] => [...new Set(needs.flatMap((n) => roomOf(n, "post") ?? roomOf(n, "read") ?? []))]

export function mayPost(mod: Granted | undefined, code: string, room: string): boolean {
  if (mod?.state !== "on" || !mod.needs.some((n) => roomOf(n, "post") === room)) return false
  return !!mod.rooms?.some((r) => r.code === code && r.room === room)
}

export function grantsOf(mod: Granted | undefined, titleOf: (code: string) => string | null): ModRoomGrant[] {
  if (mod?.state !== "on") return []
  const asked = new Set(asksRooms(mod.needs))
  return (mod.rooms ?? []).filter((r) => asked.has(r.room)).map((r) => ({ channel: r.code, title: titleOf(r.code) ?? r.code, room: r.room }))
}

export function postBody(name: string, text: string): string | null {
  const said = text.trim()
  return said ? `${said}\n\nvia ${name}` : null
}

export function pacer(every: number): (name: string, now: number) => number {
  const last = new Map<string, number>()
  return (name, now) => {
    const wait = (last.get(name) ?? -Infinity) + every - now
    if (wait > 0) return wait
    last.set(name, now)
    return 0
  }
}

export function startPick(rooms: readonly string[], here: { code: string; rooms: readonly { id: string }[] } | null): { code: string; room: string }[] {
  if (!here) return []
  return rooms.filter((r) => r === "general" || here.rooms.some((x) => x.id === r)).map((room) => ({ code: here.code, room }))
}
