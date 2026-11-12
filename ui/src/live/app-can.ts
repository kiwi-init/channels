import { useEffect, useState } from "react"

import { compareVersions } from "@kiwi/core/versions.ts"
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

export async function contractOf(b: Pick<KiwiBridge, "capabilities"> | null): Promise<string | null> {
  if (!b) return null
  if (typeof b.capabilities !== "function") return "0.0.0"
  try {
    return (await b.capabilities()).contract
  } catch {
    // An app that can't say its contract is treated as the oldest.
    return "0.0.0"
  }
}

let served: Promise<ReadonlySet<string> | null> | null = null
let contract: Promise<string | null> | null = null

async function appSince(version: string): Promise<boolean> {
  contract ??= contractOf(bridge())
  const has = await contract
  return has === null || compareVersions(has, version) >= 0
}

export function useAppSince(version: string): boolean {
  const [since, setSince] = useState(() => bridge() === null)
  useEffect(() => {
    let live = true
    void appSince(version).then((yes) => live && setSince(yes))
    return () => {
      live = false
    }
  }, [version])
  return since
}

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
