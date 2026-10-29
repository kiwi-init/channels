import { useEffect, useState } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import type { ChannelState, Member } from "@kiwi/core/state.ts"
import { loadRecent, saveRecent } from "@kiwi/channel/recent.ts"
import { type StoredMember } from "@kiwi/channel/store.ts"
import { excerpt, memberName } from "@/lib/format"
import { markSeen, setOpenNews } from "@kiwi/channel/news.ts"
import { lastPreview } from "@/lib/preview"

export function unreadOf(hidden: boolean, arrivals: number, mark: number, inOtherRooms: number): number {
  return hidden ? Math.max(0, arrivals - mark) : inOtherRooms
}

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
  const unread = unreadOf(hidden, arrivals, mark, inOtherRooms)
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
}: {
  member: StoredMember
  messages: Message[]
  others: Member[]
  state: ChannelState
  me: string
  nameOf: (name: string) => string
}) {
  useEffect(() => {
    const last = lastPreview(messages, (seq) => state.trust.get(seq))
    const prior = loadRecent(member.code)
    if (!last && !others.length) return
    const lead = last ? state.lead : prior?.lead
    saveRecent(member.code, {
      from: last ? (last.from === me ? "You" : nameOf(last.from)) : (prior?.from ?? ""),
      text: last ? (last.imgs?.length && last.body === last.imgs.map((i) => i.name).join(", ") ? "Image" : excerpt(last.body, 120)) : (prior?.text ?? ""),
      ts: last?.ts ?? prior?.ts ?? member.at,
      people: others.length ? others.map((m) => memberName(m)) : (prior?.people ?? []),
      ...(lead ? { lead } : {}),
    })
  }, [messages, others, state.trust, state.lead, member.code, member.at, nameOf, me])
}
