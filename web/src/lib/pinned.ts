import { useEffect, useState } from "react"

import type { Persona } from "@kiwi/core/personality.ts"
import { pinned, type Pin } from "@kiwi/core/pin.ts"

export function usePinned(pin: Pin | undefined): Persona | null | undefined {
  const [persona, setPersona] = useState<Persona | null | undefined>(undefined)
  const id = pin?.id
  const hash = pin?.hash
  useEffect(() => {
    if (!id || !hash) return setPersona(undefined)
    let live = true
    void import("@kiwi/core/presets.ts").then(({ PRESETS }) => pinned({ id, hash }, PRESETS)).then((p) => live && setPersona(p))
    return () => {
      live = false
    }
  }, [id, hash])
  return persona
}
