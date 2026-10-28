import { useEffect, useSyncExternalStore } from "react"

import type { TerminalId, TerminalsStatus } from "@kiwi/core/terminals.ts"
import { bridge } from "@/lib/secrets"
import { store } from "~/live/value"
import type { AgentStarts } from "~/model"

const starts = store<AgentStarts | null>(null)

const switches = (t: TerminalsStatus) => ({ launch: t.launch === "on", bypass: t.bypass === "on", prefer: t.prefer, terminals: t.terminals })

function patch(next: Partial<AgentStarts>): void {
  const now = starts.get()
  if (now) starts.set({ ...now, ...next })
}

function need() {
  const b = bridge()
  if (!b) throw new Error("agents start from the Channels desktop app")
  return b
}

export const startsNow = starts.get

export async function loadStarts(): Promise<void> {
  const b = bridge()
  if (!b) return
  const [t, folders] = await Promise.all([b.terminals(), b.launchRoots()])
  starts.set(t ? { folders, ...switches(t) } : null)
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

export async function addStartFolder(): Promise<void> {
  const b = need()
  const dir = await b.chooseFolder()
  if (dir) patch({ folders: await b.setLaunchRoot(dir, "add") })
}

export async function removeStartFolder(dir: string): Promise<void> {
  patch({ folders: await need().setLaunchRoot(dir, "remove") })
}

export async function allowNewAgents(on: boolean): Promise<void> {
  const t = await need().setLaunches(on ? "on" : "off")
  if (t) patch(switches(t))
}

export async function allowRemoteBypass(on: boolean): Promise<void> {
  const t = await need().setRemoteBypass(on ? "on" : "off")
  if (t) patch(switches(t))
}

export async function preferTerminal(id: TerminalId): Promise<void> {
  const t = await need().terminalPrefer(id)
  if (t) patch(switches(t))
}

export async function setTerminalHelpers(id: Exclude<TerminalId, "app">, on: boolean): Promise<void> {
  const t = await need().terminalHelpers(id, on ? "on" : "off")
  if (t) patch(switches(t))
}
