import { useEffect, useSyncExternalStore } from "react"

import type { HookRow, HookState, KnownHarness } from "@kiwi/core/harnesses.ts"
import { harnessName } from "@/lib/harness"
import { bridge } from "@/lib/secrets"
import { store } from "~/live/value"
import type { Finding, ThisComputer } from "~/model"

const computer = store<ThisComputer | null>(null)

const shown = (rows: HookRow[]): ThisComputer["hooks"] =>
  rows.filter((r): r is HookRow & { state: Exclude<HookState, "absent"> } => r.state !== "absent").map((r) => ({ harness: r.harness, label: harnessName(r.harness), state: r.state }))

function need() {
  const b = bridge()
  if (!b) throw new Error("this needs the Channels desktop app")
  return b
}

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

export async function setHooks(harness: KnownHarness, on: boolean): Promise<void> {
  const hooks = shown(await need().setHooks(harness, on ? "on" : "off"))
  const now = computer.get()
  if (now) computer.set({ ...now, hooks })
}

export const checkComputer = (): Promise<Finding[] | null> => need().doctor()

export async function setContextLine(on: boolean): Promise<void> {
  const got = await need().setContextLine(on ? "on" : "off")
  if (!got) throw new Error("kiwi didn't change it")
  const now = computer.get()
  if (now) computer.set({ ...now, contextLine: got === "on" })
}
