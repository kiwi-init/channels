import { useEffect, useId, useState } from "react"

import type { Message } from "~/model"
import { useAct } from "~/nav"

export function useHold(code: string, kind: string, seq: number | null): void {
  const key = `${kind} ${useId()}`
  const { holdEarlier } = useAct().actions
  useEffect(() => holdEarlier(code, key, seq), [code, key, seq, holdEarlier])
  useEffect(() => () => holdEarlier(code, key, null), [code, key, holdEarlier])
}

export function useWhole(code: string, kind: string, messages: readonly Message[]): void {
  const key = `${kind} ${useId()}`
  const { actions } = useAct()
  const { holdEarlier, earlierTo } = actions
  const need = messages.reduce<number | null>((low, m) => (m.partial && (low === null || m.seq < low) ? m.seq : low), null)
  const [held, setHeld] = useState<{ code: string; seq: number } | null>(null)
  if (need !== null && (held === null || held.code !== code || need < held.seq)) setHeld({ code, seq: need })
  const seq = held?.code === code ? held.seq : null
  useEffect(() => {
    if (seq === null) return
    holdEarlier(code, key, seq)
    void earlierTo(code, seq)
    return () => holdEarlier(code, key, null)
  }, [code, key, seq, holdEarlier, earlierTo])
}
