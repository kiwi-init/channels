import { useEffect, useState } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import type { ChannelState, Member } from "@kiwi/core/state.ts"
import { loadRecent, saveRecent, type StoredMember } from "@/lib/channel"
import { excerpt, memberName } from "@/lib/format"
import { markSeen, setOpenNews } from "@/lib/news"
import { lastPreview } from "@/lib/preview"

export function useChannelNews(room: string, top: number, arrivals: number, inOtherRooms: number, needs: number) {
  const [mark, setMark] = useState(arrivals)
  const [hidden, setHidden] = useState(() => document.hidden)
  useEffect(() => {
    const onChange = () => {
      if (document.hidden) setMark(arrivals)
      setHidden(document.hidden)
    }
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [arrivals])
  const unread = hidden ? arrivals - mark : inOtherRooms
  useEffect(() => {
    if (!hidden && top > 0) markSeen(room, top, needs)
  }, [room, top, needs, hidden])
  useEffect(() => setOpenNews({ room, unread, needs }), [room, unread, needs])
  useEffect(() => () => setOpenNews(null), [room])
}

export function useRecentPreview({
  member,
  messages,
  others,
  state,
  me,
  nameOf,
  reaches,
}: {
  member: StoredMember
  messages: Message[]
  others: Member[]
  state: ChannelState
  me: string
  nameOf: (name: string) => string
  reaches: (m: Message) => boolean
}) {
  useEffect(() => {
    const last = lastPreview(messages, reaches, (seq) => state.trust.get(seq))
    const prior = loadRecent(member.code)
    if (!last && !others.length) return
    saveRecent(member.code, {
      from: last ? (last.from === me ? "You" : nameOf(last.from)) : (prior?.from ?? ""),
      text: last ? (last.imgs?.length && last.body === last.imgs.map((i) => i.name).join(", ") ? "Image" : excerpt(last.body, 120)) : (prior?.text ?? ""),
      ts: last?.ts ?? prior?.ts ?? member.at,
      people: others.length ? others.map((m) => memberName(m)) : (prior?.people ?? []),
      ...(last && state.coordinator && last.from === state.coordinator ? { byCoordinator: true } : {}),
    })
  }, [messages, others, state.trust, state.coordinator, member.code, member.at, nameOf, me, reaches])
}
