import { useEffect, useSyncExternalStore } from "react"

import type { HookRow, HookState } from "@kiwi/core/harnesses.ts"
import { harnessName } from "@kiwi/app/harness.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { store } from "~/live/value"
import type { ThisComputer } from "~/model"

export const computer = store<ThisComputer | null>(null)

export const shown = (rows: HookRow[]): ThisComputer["hooks"] =>
  rows.filter((r): r is HookRow & { state: Exclude<HookState, "absent"> } => r.state !== "absent").map((r) => ({ harness: r.harness, label: harnessName(r.harness), state: r.state }))

export const computerNow = computer.get

export async function loadComputer(): Promise<void> {
  const b = bridge()
  if (!b) return
  const [daemon, hooks, line] = await Promise.all([b.daemonStatus(), b.hooks().catch((): HookRow[] => []), b.contextLine().catch(() => null)])
  computer.set({ kiwi: { running: daemon.running, ...(daemon.version ? { version: daemon.version } : {}) }, hooks: shown(hooks), contextLine: line === null ? null : line === "on" })
}

export function useComputer(): ThisComputer | null {
  useEffect(() => {
    const again = () => void loadComputer().catch(() => {})
    again()
    window.addEventListener("focus", again)
    return () => window.removeEventListener("focus", again)
  }, [])
  return useSyncExternalStore(computer.subscribe, computer.get)
}
