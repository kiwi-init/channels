import { useEffect, useState } from "react"

import type { JoinRequest } from "@kiwi/core/membership.ts"
import { pinned, type Pin } from "@kiwi/core/pin.ts"
import { cleanPersonalities } from "@kiwi/core/personalities.ts"
import { PRESETS } from "@kiwi/core/presets.ts"
import { useSecrets } from "@/lib/secrets"

export function usePinsHere(requests: readonly JoinRequest[]): ReadonlyMap<string, string | null> {
  const kept = useSecrets().personalities
  const [found, setFound] = useState<ReadonlyMap<string, string | null>>(new Map())
  const wanted = JSON.stringify(requests.flatMap((r) => (r.pin ? [[r.id, r.pin.id, r.pin.hash]] : [])))
  useEffect(() => {
    let live = true
    const all = [...PRESETS, ...cleanPersonalities(kept)]
    const pins = JSON.parse(wanted) as [string, Pin["id"], Pin["hash"]][]
    void Promise.all(pins.map(async ([request, id, hash]) => [request, (await pinned({ id, hash }, all)) ? id : null] as const)).then((pairs) => live && setFound(new Map(pairs)))
    return () => {
      live = false
    }
  }, [wanted, kept])
  return found
}
