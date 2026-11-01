import { useEffect } from "react"
import { markSeenIn, seenIn } from "@kiwi/app/threads.ts"
import type { ChannelLink } from "@kiwi/channel/channel-ops.ts"

const WRITE_EVERY_MS = 45_000

export function useMarksSync(ch: ChannelLink, roomId: string): void {
  useEffect(() => {
    let live = true
    let wrote = JSON.stringify(seenIn(roomId))
    const take = (marks: Readonly<Record<string, number>> | null) => {
      if (live && marks) markSeenIn(roomId, { ...marks })
    }
    const pull = () => {
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
      ch.syncMarks(now)
        .then(take)
        .catch(() => {
          // A write that fails is tried again at the next blur or interval, with whatever has moved since.
          wrote = ""
        })
    }
    const hidden = () => {
      if (document.visibilityState === "hidden") push()
    }
    pull()
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
