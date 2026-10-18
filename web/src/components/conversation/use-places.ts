import { useCallback, useEffect, useMemo, useRef } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import { unreadIn as unreadInPlace } from "@kiwi/core/standup.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { markSeenIn, placeFromKey, placeKey, seenIn, useSeen } from "@/lib/threads"
import type { Here, Unread } from "./types"

export function usePlaces({ here, roomId, messages, me, state, shownTask }: { here: string; roomId: string; messages: Message[]; me: string; state: ChannelState; shownTask: number | null }) {
  const { places } = state
  const place: Here = useMemo(() => {
    const p = placeFromKey(here)
    return p?.kind === "dm" ? p : { kind: "main" }
  }, [here])
  const hereKey = placeKey(place)

  const seen = useSeen(roomId)
  const firstVisit = useRef(Object.keys(seenIn(roomId)).length === 0)
  useEffect(() => {
    if (!firstVisit.current || !messages.length) return
    firstVisit.current = false
    markSeenIn(roomId, Object.fromEntries([...places].map(([k, v]) => [k, v.last])))
  }, [messages.length, places, roomId])
  const unreadIn = useCallback((key: string): Unread => unreadInPlace(state, messages, me, key, seen[key] ?? 0), [seen, messages, me, state])
  const lastHere = places.get(hereKey)?.last ?? 0
  useEffect(() => {
    if (!document.hidden && lastHere) markSeenIn(roomId, { [hereKey]: lastHere })
  }, [hereKey, lastHere, roomId])
  const taskKey = shownTask === null ? null : placeKey({ kind: "task", task: shownTask })
  const lastInTask = (taskKey && places.get(taskKey)?.last) || 0
  useEffect(() => {
    if (!document.hidden && taskKey && lastInTask) markSeenIn(roomId, { [taskKey]: lastInTask })
  }, [taskKey, lastInTask, roomId])

  return { place, hereKey, unreadIn, taskKey }
}
