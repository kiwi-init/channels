import { useEffect, useMemo, useState } from "react"

import type { HumanSession } from "@kiwi/core/client.ts"
import { ChannelStore, type ChannelHandle } from "./channel-store"
import type { StoredMember } from "./store"

export type { ChannelHandle }

export function useChannel(member: StoredMember, human?: HumanSession | null): ChannelHandle {
  const store = useMemo(() => new ChannelStore(member, human), [member, human])
  const [handle, setHandle] = useState(store.snapshot)
  useEffect(() => {
    const stop = store.subscribe(() => setHandle(store.snapshot()))
    const close = store.open()
    return () => {
      close()
      stop()
    }
  }, [store])
  return handle.ch === store.ch ? handle : store.snapshot()
}
