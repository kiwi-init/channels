import { useEffect, useState } from "react"

import { compareVersions } from "@kiwi/core/versions.ts"
import { bridge, type KiwiBridge } from "@kiwi/secrets/secrets.ts"

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
