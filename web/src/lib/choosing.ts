import { useEffect, useState } from "react"

const SETTLE_MS = 400
const STUCK_MS = 5_000

export function choiceGate(now: () => number = Date.now) {
  let shownAt = -Infinity
  let picked = false
  let busy = false
  return {
    shown() {
      shownAt = picked ? now() : -Infinity
      picked = false
      busy = false
    },
    take(): boolean {
      if (busy || now() - shownAt < SETTLE_MS) return false
      busy = true
      picked = true
      return true
    },
    done(sent: boolean) {
      if (!sent) busy = false
    },
  }
}

export function useChoosing(key: number, onChoose: (choice: string) => Promise<boolean>): { busy: boolean; pick: (choice: string) => void } {
  const [gate] = useState(() => choiceGate())
  const [busyFor, setBusyFor] = useState<number | null>(null)
  const busy = busyFor === key
  useEffect(() => gate.shown(), [key, gate])
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => (gate.done(false), setBusyFor(null)), STUCK_MS)
    return () => clearTimeout(t)
  }, [busy, gate])
  const pick = (choice: string) => {
    if (!gate.take()) return
    setBusyFor(key)
    void onChoose(choice).then((sent) => {
      gate.done(sent)
      if (!sent) setBusyFor(null)
    })
  }
  return { busy, pick }
}
