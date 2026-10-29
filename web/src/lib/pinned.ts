import { useEffect, useState } from "react"

import type { Persona } from "@kiwi/core/personality.ts"
import { pinned, type Pin } from "@kiwi/core/pin.ts"
import { useSecrets } from "@kiwi/secrets/secrets.ts"

export function usePinned(pin: Pin | undefined): Persona | null | undefined {
  const [got, setGot] = useState<{ key: string; persona: Persona | null } | null>(null)
  const kept = useSecrets().personalities
  const id = pin?.id
  const hash = pin?.hash
  const key = id && hash ? `${id}:${hash}` : null
  useEffect(() => {
    if (!key || !id || !hash) return
    let live = true
    void Promise.all([import("@kiwi/core/presets.ts"), import("@kiwi/core/personalities.ts")])
      .then(([{ PRESETS }, { cleanPersonalities }]) => pinned({ id, hash }, [...PRESETS, ...cleanPersonalities(kept)]))
      .then((persona) => live && setGot({ key, persona }))
    return () => {
      live = false
    }
  }, [key, id, hash, kept])
  return key && got?.key === key ? got.persona : undefined
}
