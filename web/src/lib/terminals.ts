import { useEffect, useState } from "react"

import type { KiwiBridge } from "./secrets"

type Terminals = Pick<KiwiBridge, "terminals" | "terminalHelpers" | "terminalPrefer" | "setLaunches">

export function terminalsBridge(): Terminals | null {
  try {
    const k = (window as unknown as { kiwi?: Partial<Terminals> }).kiwi
    return k && typeof k.terminals === "function" && typeof k.terminalHelpers === "function" && typeof k.terminalPrefer === "function" && typeof k.setLaunches === "function" ? (k as Terminals) : null
  } catch {
    // No window (a test or a worker): no terminals to set.
    return null
  }
}

export function useLaunchesHere(): boolean {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const b = terminalsBridge()
    if (!b) return
    let live = true
    void b.terminals().then(
      (s) => live && setOn(s?.launch !== "off"),
      () => {}
    )
    return () => {
      live = false
    }
  }, [])
  return on
}
