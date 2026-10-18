import { useMemo } from "react"

import { cleanPersonalities } from "@kiwi/core/personalities.ts"
import { type Personality } from "@kiwi/core/personality.ts"
import { PRESETS } from "@kiwi/core/presets.ts"

import { writeLocal } from "./local-store"
import { bridge, useSecrets } from "./secrets"

export function useOwnPersonalities(): Personality[] {
  const kept = useSecrets().personalities
  return useMemo(() => cleanPersonalities(kept), [kept])
}

export function usePersonalities(): Personality[] {
  const own = useOwnPersonalities()
  return [...PRESETS, ...own]
}

export async function savePersonalities(list: Personality[]): Promise<void> {
  const b = bridge()
  if (b) {
    if (typeof b.setPersonalities !== "function") throw new Error("Update Channels to keep personalities on this Mac.")
    return b.setPersonalities(list)
  }
  const clean = cleanPersonalities(list)
  if (clean.length !== list.length) throw new Error("A personality isn't valid: check its name, role, capabilities, areas and instructions.")
  writeLocal({ personalities: clean })
}
