import type { Channel } from "@mc/client.ts"
import type { Message } from "@mc/protocol.ts"
import { fold, type ChannelState, type Roster } from "@mc/state.ts"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { loadHistory, merge, readMark, saveMessage, setReadMark, type Room } from "./channel"
import type { HistoryDb, Sql } from "./history"
import { watchChannel } from "./relay"

export interface ChannelHandle {
  messages: readonly Message[]
  state: ChannelState
  connected: boolean
  send(body: string, to?: string[]): Promise<void>
  unread: number
}

function rosterOf(members: Awaited<ReturnType<Channel["members"]>>): Roster {
  return members.map((m) => ({
    name: m.name,
    pk: m.pk,
    role: m.role,
    about: m.about,
    owner: m.owner,
    at: m.at,
    active: m.active,
    kind: m.kind,
    display: m.display,
    sponsor: m.sponsor,
    ...(m.scopes ? { scopes: m.scopes } : {}),
    ...(m.later ? { later: m.later } : {}),
    ...(m.laterRole ? { laterRole: m.laterRole } : {}),
    ...(m.runs ? { runs: m.runs } : {}),
  }))
}

export function useChannel(channel: Channel | null, memberPk: string, history: HistoryDb, sql: Sql | null): ChannelHandle {
  const [messages, setMessages] = useState<readonly Message[]>([])
  const [roster, setRoster] = useState<Roster>([])
  const [connected, setConnected] = useState(false)
  const [mark, setMark] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const keysRef = useRef<Record<string, string>>({})

  const room: Room | null = useMemo(() => (channel ? { roomId: channel.roomId, memberPk, keys: channel.access.keys } : null), [channel, memberPk])

  useEffect(() => {
    if (!channel || !room) return
    let live = true
    keysRef.current = room.keys
    const refreshRoster = () =>
      void channel.members().then(
        (members) => live && setRoster(rosterOf(members)),
        () => {}
      )
    refreshRoster()
    let stop = () => {}
    void (async () => {
      const head = await channel.head().catch(() => 0)
      const cached = await loadHistory(history, room, head).catch(() => ({ messages: [] as Message[], since: Math.max(0, head - 1000) }))
      if (!live) return
      setMessages(cached.messages)
      if (sql) setMark(await readMark(sql, room).catch(() => 0))
      stop = watchChannel(channel, cached.since, {
        message: (m) => {
          setMessages((current) => merge(current, [m]))
          void saveMessage(history, room, channel.access.epoch, m).catch(() => {})
        },
        open: () => live && setConnected(true),
        down: () => live && setConnected(false),
        changed: (what) => what === "Roster" && refreshRoster(),
      })
    })()
    return () => {
      live = false
      stop()
    }
  }, [channel, room, history, sql])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(tick)
  }, [])

  const state = useMemo(() => fold([...messages], roster, now), [messages, roster, now])

  const send = useCallback(
    async (body: string, to?: string[]) => {
      if (!channel) return
      await channel.send(body, to && to.length ? { to } : {})
    },
    [channel]
  )

  const self = channel?.identity.name ?? ""
  const unread = useMemo(() => messages.filter((m) => m.seq > mark && m.kind !== "event" && m.from !== self).length, [messages, mark, self])

  useEffect(() => {
    if (!sql || !room || !messages.length) return
    void setReadMark(sql, room, messages[messages.length - 1]!.seq).catch(() => {})
  }, [sql, room, messages])

  return { messages, state, connected, send, unread }
}
