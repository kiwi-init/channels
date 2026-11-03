import { useEffect, useSyncExternalStore } from "react"

import type { TerminalId } from "@kiwi/core/terminals.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { store } from "~/live/value"
import type { AgentStarts } from "~/model"

const starts = store<AgentStarts | null>(null)

export const startsNow = starts.get

export async function loadStarts(): Promise<void> {
  const b = bridge()
  if (!b) return
  const t = await b.terminals()
  starts.set(t ? { terminals: t.terminals } : null)
}

export function useStarts(): AgentStarts | null {
  useEffect(() => {
    const again = () => void loadStarts().catch(() => {})
    again()
    window.addEventListener("focus", again)
    return () => window.removeEventListener("focus", again)
  }, [])
  return useSyncExternalStore(starts.subscribe, starts.get)
}

export async function setTerminalHelpers(id: TerminalId, on: boolean): Promise<void> {
  const b = bridge()
  if (!b) throw new Error("terminal helpers are set from the Channels desktop app")
  const t = await b.terminalHelpers(id, on ? "on" : "off")
  if (t && starts.get()) starts.set({ terminals: t.terminals })
}
