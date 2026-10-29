import { useEffect, useMemo, useState } from "react"

import { decodeJoinCode } from "@kiwi/core/crypto.ts"
import { ops, watches } from "../channel-ops"
import { withHeads } from "../news"
import { useSecrets } from "@kiwi/secrets/secrets.ts"
import { HEADS_SAFETY_MS } from "../watch"
import { clockNow } from "./clock"
import { channelTitle, loadRecent, type Recent } from "./recent"
import { allMembers, CHANGED, loadMember, pendingChannels } from "./store"

type ListState = "member" | "pending" | "agents" | "elsewhere"

export interface ChannelRow {
  code: string
  room: string
  title: string
  recent: Recent | null
  ts: number
  at: number
  state: ListState
  owner: boolean
  agents: number
  head?: number
  relay?: string
}

const untitled = (room: string) => `Channel ${room.slice(0, 4).toUpperCase()}`

export function useChannelList(): ChannelRow[] {
  const local = useKnownChannels()
  const [pending, setPending] = useState(pendingChannels)

  useEffect(() => {
    const update = () => setPending(pendingChannels())
    window.addEventListener(CHANGED, update)
    return () => window.removeEventListener(CHANGED, update)
  }, [])

  const rows = useMemo(() => {
    const rows = new Map<string, ChannelRow>()
    for (const c of local) {
      const m = loadMember(c.code)
      if (!m) continue
      const recent = loadRecent(c.code)
      const room = m.access.roomId
      rows.set(room, {
        code: c.code,
        room,
        title: channelTitle({ name: m.name ?? c.name }, recent),
        recent,
        ts: recent?.ts ?? c.at,
        at: c.at,
        state: m.relay ? "elsewhere" : "member",
        owner: m.identity.pk === m.access.ownerPk,
        agents: 0,
        ...(m.relay ? { relay: m.relay } : {}),
      })
    }
    for (const p of pending) {
      let room: string
      try {
        room = decodeJoinCode(p.code).roomId
      } catch {
        continue
      }
      if (rows.has(room)) continue
      rows.set(room, { code: p.code, room, title: untitled(room), recent: null, ts: clockNow(), at: Number.POSITIVE_INFINITY, state: "pending", owner: false, agents: 0 })
    }
    return [...rows.values()].sort((a, b) => b.ts - a.ts)
  }, [local, pending])

  const [heads, setHeads] = useState<Record<string, number>>({})
  const memberKey = rows
    .filter((r) => r.state === "member")
    .map((r) => `${r.room}\t${r.code}`)
    .sort()
    .join("\n")
  useEffect(() => {
    if (!memberKey) return
    const members = memberKey.split("\n").map((s) => {
      const i = s.indexOf("\t")
      return { room: s.slice(0, i), code: s.slice(i + 1) }
    })
    let stop = false
    let gen = 0
    const put = (next: Record<string, number>) =>
      setHeads((prev) => {
        const merged = { ...prev }
        for (const [k, v] of Object.entries(next)) merged[k] = Math.max(prev[k] ?? 0, v)
        const keys = Object.keys(merged)
        if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === merged[k])) return prev
        return merged
      })
    const stops = members.map(({ room, code }) =>
      watches().watch(code, (ev) => {
        if (ev._tag === "Head" && !stop) put({ [room]: ev.seq })
      })
    )
    const tick = async () => {
      const my = ++gen
      const next: Record<string, number> = {}
      await Promise.all(
        members.map(async ({ room, code }) => {
          if (!loadMember(code)) return
          try {
            next[room] = await ops().call(code, "head")
          } catch {
            return
          }
        })
      )
      if (stop || my !== gen) return
      put(next)
    }
    const id = setInterval(tick, HEADS_SAFETY_MS)
    const onVis = () => {
      if (!document.hidden) void tick()
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      stop = true
      for (const s of stops) s()
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [memberKey])

  return useMemo(() => withHeads(rows, heads), [rows, heads])
}

export function useKnownChannels(): KnownChannel[] {
  useSecrets()
  const [, setTick] = useState(0)
  useEffect(() => {
    const update = () => setTick((n) => n + 1)
    window.addEventListener(CHANGED, update)
    window.addEventListener("storage", update)
    return () => {
      window.removeEventListener(CHANGED, update)
      window.removeEventListener("storage", update)
    }
  }, [])
  return knownChannels()
}

export interface KnownChannel {
  code: string
  at: number
  name?: string
}

function knownChannels(): KnownChannel[] {
  return allMembers()
    .map((m) => ({ code: m.code, at: m.at, ...(m.name ? { name: m.name } : {}) }))
    .sort((a, b) => b.at - a.at)
}
