import { useEffect, useRef } from "react"
import { markSeenIn, seenIn } from "@kiwi/app/threads.ts"
import type { ChannelLink } from "@kiwi/channel/channel-ops.ts"

const WRITE_EVERY_MS = 45_000
const PULL_EVERY_MS = 60_000

const pulledAt = new Map<string, number>()

export function useMarksSync(ch: ChannelLink, roomId: string, caughtUp: boolean): void {
  const whole = useRef(caughtUp)
  useEffect(() => {
    whole.current = caughtUp
  }, [caughtUp])
  useEffect(() => {
    let live = true
    let wrote = JSON.stringify(seenIn(roomId))
    const take = (marks: Readonly<Record<string, number>> | null) => {
      if (live && marks) markSeenIn(roomId, { ...marks })
    }
    const pull = () => {
      pulledAt.set(roomId, Date.now())
      ch.syncMarks(seenIn(roomId), { write: false })
        .then(take)
        .catch(() => {
          // Reading the note is a nicety: an app without it, or offline, keeps this device's own marks.
        })
    }
    const push = () => {
      const now = seenIn(roomId)
      const text = JSON.stringify(now)
      if (text === wrote) return
      wrote = text
      ch.syncMarks(now, { make: whole.current })
        .then((marks) => {
          if (!marks) wrote = ""
          take(marks)
        })
        .catch(() => {
          // A write that fails is tried again at the next blur or interval, with whatever has moved since.
          wrote = ""
        })
    }
    const hidden = () => {
      if (document.visibilityState === "hidden") push()
    }
    if (Date.now() - (pulledAt.get(roomId) ?? -Infinity) >= PULL_EVERY_MS) pull()
    window.addEventListener("focus", pull)
    window.addEventListener("blur", push)
    document.addEventListener("visibilitychange", hidden)
    const every = window.setInterval(push, WRITE_EVERY_MS)
    return () => {
      live = false
      window.removeEventListener("focus", pull)
      window.removeEventListener("blur", push)
      document.removeEventListener("visibilitychange", hidden)
      window.clearInterval(every)
    }
  }, [ch, roomId])
}
