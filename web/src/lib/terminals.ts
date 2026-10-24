import { useEffect, useState } from "react"

import type { KiwiBridge } from "./secrets"

type Terminals = Pick<KiwiBridge, "terminals" | "terminalHelpers" | "terminalPrefer" | "setLaunches"> & Partial<Pick<KiwiBridge, "setRemoteBypass">>

export function terminalsBridge(): Terminals | null {
  try {
    const k = (window as unknown as { kiwi?: Partial<Terminals> }).kiwi
    return k && typeof k.terminals === "function" && typeof k.terminalHelpers === "function" && typeof k.terminalPrefer === "function" && typeof k.setLaunches === "function" ? (k as Terminals) : null
  } catch {
    // No window (a test or a worker): no terminals to set.
    return null
  }
}

type Hooks = Pick<KiwiBridge, "hooks" | "setHooks">

export function hooksBridge(): Hooks | null {
  try {
    const k = (window as unknown as { kiwi?: Partial<Hooks> }).kiwi
    return k && typeof k.hooks === "function" && typeof k.setHooks === "function" ? (k as Hooks) : null
  } catch {
    // No window (a test or a worker): no hooks to set.
    return null
  }
}

type ContextLine = Pick<KiwiBridge, "contextLine" | "setContextLine">

export function contextLineBridge(): ContextLine | null {
  try {
    const k = (window as unknown as { kiwi?: Partial<ContextLine> }).kiwi
    return k && typeof k.contextLine === "function" && typeof k.setContextLine === "function" ? (k as ContextLine) : null
  } catch {
    // No window (a test or a worker): no context line to set.
    return null
  }
}

export function useLaunchesHere(): boolean | null {
  const [on, setOn] = useState<boolean | null>(() => (terminalsBridge() ? null : true))
  useEffect(() => {
    const b = terminalsBridge()
    if (!b) return
    let live = true
    void b.terminals().then(
      (s) => live && setOn(s?.launch !== "off"),
      () => live && setOn(true)
    )
    return () => {
      live = false
    }
  }, [])
  return on
}
