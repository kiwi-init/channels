import { useEffect, useMemo, useRef } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import { unreadAll } from "@kiwi/core/standup.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { roomLast, roomSeenKey, roomUnread } from "@/lib/rooms"
import { markSeenIn, placeFromKey, placeKey, seenIn, useSeen } from "@/lib/threads"
import type { Here, Unread } from "./types"

export function usePlaces({
  here,
  roomId,
  cardRoom,
  messages,
  me,
  state,
  shownTask,
}: {
  here: string
  roomId: string
  cardRoom: string
  messages: Message[]
  me: string
  state: ChannelState
  shownTask: number | null
}) {
  const { places } = state
  const place: Here = useMemo(() => {
    const p = placeFromKey(here)
    return p?.kind === "dm" ? p : { kind: "main" }
  }, [here])
  const hereKey = placeKey(place)
  const rooms = state.rooms.size > 1
  const openRoom = hereKey === "main" && rooms ? cardRoom : null
  const lastByRoom = useMemo(() => (rooms ? roomLast(state, messages) : null), [rooms, state, messages])

  const seen = useSeen(roomId)
  const firstVisit = useRef(Object.keys(seenIn(roomId)).length === 0)
  useEffect(() => {
    if (!firstVisit.current || !messages.length) return
    firstVisit.current = false
    markSeenIn(roomId, { ...Object.fromEntries([...places].map(([k, v]) => [k, v.last])), ...Object.fromEntries([...(lastByRoom ?? [])].map(([id, seq]) => [roomSeenKey(id), seq])) })
  }, [messages.length, places, lastByRoom, roomId])
  const unreadIn: (key: string) => Unread = useMemo(() => unreadAll(state, messages, me, seen), [seen, messages, me, state])
  const unreadInRoom: (id: string) => Unread = useMemo(() => (rooms ? roomUnread(state, messages, me, seen) : () => unreadIn("main")), [rooms, state, messages, me, seen, unreadIn])
  const seenHere = openRoom === null ? hereKey : roomSeenKey(openRoom)
  const lastHere = openRoom === null ? (places.get(hereKey)?.last ?? 0) : (lastByRoom?.get(openRoom) ?? 0)
  useEffect(() => {
    if (!document.hidden && lastHere) markSeenIn(roomId, { [seenHere]: lastHere })
  }, [seenHere, lastHere, roomId])
  const taskKey = shownTask === null ? null : placeKey({ kind: "task", task: shownTask })
  const lastInTask = (taskKey && places.get(taskKey)?.last) || 0
  useEffect(() => {
    if (!document.hidden && taskKey && lastInTask) markSeenIn(roomId, { [taskKey]: lastInTask })
  }, [taskKey, lastInTask, roomId])

  return { place, hereKey, openRoom, unreadIn, unreadInRoom, taskKey }
}
