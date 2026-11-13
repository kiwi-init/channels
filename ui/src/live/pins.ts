import { useEffect, useState } from "react"

import type { JoinRequest } from "@kiwi/core/membership.ts"
import { pinned, type Pin } from "@kiwi/core/pin.ts"
import { cleanPersonalities } from "@kiwi/core/personalities.ts"
import { PRESETS } from "@kiwi/core/presets.ts"
import { useSecrets } from "@kiwi/secrets/secrets.ts"

const NONE: ReadonlyMap<string, string | null> = new Map()

const same = (a: ReadonlyMap<string, string | null>, b: ReadonlyMap<string, string | null>): boolean => a.size === b.size && [...a].every(([k, v]) => b.has(k) && b.get(k) === v)

export function usePinsHere(requests: readonly JoinRequest[]): ReadonlyMap<string, string | null> {
  const kept = useSecrets().personalities
  const [found, setFound] = useState<ReadonlyMap<string, string | null>>(NONE)
  const wanted = JSON.stringify(requests.flatMap((r) => (r.pin && !("invalid" in r.pin) ? [[r.id, r.pin.id, r.pin.hash]] : [])))
  useEffect(() => {
    let live = true
    const all = [...PRESETS, ...cleanPersonalities(kept)]
    const pins = JSON.parse(wanted) as [string, Pin["id"], Pin["hash"]][]
    if (!pins.length) return
    void Promise.all(pins.map(async ([request, id, hash]) => [request, (await pinned({ id, hash }, all)) ? id : null] as const)).then((pairs) => {
      if (!live) return
      const next = new Map(pairs)
      setFound((was) => (same(was, next) ? was : next))
    })
    return () => {
      live = false
    }
  }, [wanted, kept])
  return wanted === "[]" ? NONE : found
}
