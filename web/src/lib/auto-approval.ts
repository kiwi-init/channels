import { useEffect } from "react"

import type { ChannelRow } from "./channel"

export function useAutoApproval(rows: ChannelRow[], tell?: (title: string, body: string) => void): void {
  const key = rows
    .filter((r) => r.owner && r.state === "member")
    .map((r) => r.code)
    .join(" ")
  useEffect(() => {
    if (!key) return
    let stop: (() => void) | null = null
    let gone = false
    void import("./approval")
      .then((m) => {
        if (!gone) stop = m.startAutoApproval(key.split(" "), tell ?? m.notify)
      })
      .catch(() => {
        // The chunk didn't load (offline, an update mid-session): the next launch watches again.
      })
    return () => {
      gone = true
      stop?.()
    }
  }, [key, tell])
}
