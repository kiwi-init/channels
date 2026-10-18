import { useEffect, useState } from "react"

import type { MemberPicture } from "@kiwi/core/protocol.ts"
import { bridge } from "./secrets"

/** Your linked GitHub account's picture, for your own face outside a channel; null when nothing is linked or on the web. */
export function useOwnPicture(): MemberPicture | null {
  const [picture, setPicture] = useState<MemberPicture | null>(null)
  useEffect(() => {
    const b = bridge()
    if (!b?.githubPicture) return
    const load = () => void b.githubPicture().then(setPicture, () => setPicture(null))
    load()
    return b.onStore(load)
  }, [])
  return picture
}
