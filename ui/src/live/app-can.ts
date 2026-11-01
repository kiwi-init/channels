import { useEffect, useState } from "react"

import { bridge, type KiwiBridge } from "@kiwi/secrets/secrets.ts"

export async function callsServedBy(b: Pick<KiwiBridge, "capabilities"> | null): Promise<ReadonlySet<string> | null> {
  if (!b) return null
  if (typeof b.capabilities !== "function") return new Set<string>()
  try {
    return new Set((await b.capabilities()).channelCalls)
  } catch {
    // An app that can't say what it serves is treated as serving none of the newer calls.
    return new Set<string>()
  }
}

let served: Promise<ReadonlySet<string> | null> | null = null

export async function appCan(call: string): Promise<boolean> {
  served ??= callsServedBy(bridge())
  const calls = await served
  return calls === null || calls.has(call)
}

export function useAppCan(call: string): boolean {
  const [can, setCan] = useState(() => bridge() === null)
  useEffect(() => {
    let live = true
    void appCan(call).then((yes) => live && setCan(yes))
    return () => {
      live = false
    }
  }, [call])
  return can
}
