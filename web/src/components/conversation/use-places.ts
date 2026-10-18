import { useCallback, useEffect, useMemo, useRef } from "react"

import { ignored, type Message } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { markSeenIn, MAIN, placeFromKey, placeKey, seenIn, threadMembers, useSeen } from "@/lib/threads"
import type { Here, Unread } from "./types"

export function usePlaces({ here, roomId, messages, me, state, shownTask }: { here: string; roomId: string; messages: Message[]; me: string; state: ChannelState; shownTask: number | null }) {
  const { placeOf, places } = state
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
  const unreadIn = useCallback(
    (key: string): Unread => {
      const since = seen[key] ?? 0
      const p = placeFromKey(key) ?? MAIN
      const mine = p.kind === "main" || (p.kind === "dm" ? p.with.includes(me) : threadMembers(state, p).includes(me))
      let n = 0
      let named = 0
      for (const m of messages) {
        if (m.seq <= since || m.kind === "event" || m.from === me || placeKey(placeOf.get(m.seq) ?? MAIN) !== key || ignored(state.trust.get(m.seq))) continue
        n++
        if (m.to?.includes(me)) named++
      }
      return mine ? { n, forMe: n > 0 } : { n: named || n, forMe: named > 0 }
    },
    [seen, messages, me, placeOf, state]
  )
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
