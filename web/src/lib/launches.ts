import { bridge } from "./secrets"

export function canStartAgents(): boolean {
  const b = bridge()
  return !!b?.launchAgent && !!b.harnesses
}

export type LaunchSeen = { stage: "asked"; pk: string; name: string } | { stage: "joined"; pk: string; name: string }

const followers = new Map<string, Map<string, Set<(seen: LaunchSeen) => void>>>()
const asked = new Map<string, Map<string, string>>()

export function followLaunch(code: string, launch: string, cb: (seen: LaunchSeen) => void): () => void {
  const room = followers.get(code) ?? new Map<string, Set<(seen: LaunchSeen) => void>>()
  followers.set(code, room)
  const cbs = room.get(launch) ?? new Set<(seen: LaunchSeen) => void>()
  room.set(launch, cbs)
  cbs.add(cb)
  return () => {
    cbs.delete(cb)
    if (!cbs.size) room.delete(launch)
    if (!room.size) followers.delete(code)
  }
}

export function followedLaunches(code: string): string[] {
  return [...(followers.get(code)?.keys() ?? [])]
}

function tell(code: string, launch: string, seen: LaunchSeen): void {
  for (const cb of followers.get(code)?.get(launch) ?? []) cb(seen)
}

export function sawRequests(code: string, requests: readonly { pk: string; name: string; launch?: string }[]): void {
  const followed = new Set(followedLaunches(code))
  for (const r of requests) {
    if (!r.launch || !followed.has(r.launch)) continue
    const room = asked.get(code) ?? new Map<string, string>()
    asked.set(code, room)
    room.set(r.pk, r.launch)
    tell(code, r.launch, { stage: "asked", pk: r.pk, name: r.name })
  }
}

export function sawMembers(code: string, members: readonly { pk: string; name: string; active?: boolean }[]): void {
  const room = asked.get(code)
  if (!room) return
  for (const m of members) {
    const launch = room.get(m.pk)
    if (!launch || m.active === false) continue
    room.delete(m.pk)
    tell(code, launch, { stage: "joined", pk: m.pk, name: m.name })
  }
  if (!room.size) asked.delete(code)
}
