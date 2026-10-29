import { memo, useEffect, useLayoutEffect, useMemo, useState } from "react"

import { decodeJoinCode } from "@kiwi/core/crypto.ts"
import { checkJoin } from "@kiwi/channel/join.ts"
import { type PendingJoin } from "@kiwi/channel/store.ts"
import { isJoinBlip } from "@/lib/join-blip"
import { announce } from "~/kit/toasts"
import { inviteOwner } from "~/live/invites"
import { closeOpened, publish } from "~/live/store"
import type { Channel } from "~/model"

const POLL_MS = 2000

export function pendingTitle(code: string): string {
  const owner = inviteOwner(code)
  if (owner) return `${owner}'s channel`
  try {
    return `Channel ${decodeJoinCode(code).roomId.slice(0, 4).toUpperCase()}`
  } catch {
    return "A channel"
  }
}

export const OpenPending = memo(function OpenPending({ pending }: { pending: PendingJoin }) {
  const [verify, setVerify] = useState<string | null>(null)
  const [state, setState] = useState<"waiting" | "unreachable" | "declined">("waiting")
  const [since] = useState(() => Date.now())
  const [owner] = useState(() => inviteOwner(pending.code))
  const code = pending.code

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (stop) return
      try {
        const r = await checkJoin(pending)
        if (stop) return
        if (r === "denied") return setState("declined")
        if ("access" in r) return
        setState("waiting")
        setVerify(r.code)
      } catch (err) {
        if (stop) return
        if (isJoinBlip(err)) setState("unreachable")
        else announce(`Couldn't check the request: ${err instanceof Error ? err.message : String(err)}`)
      }
      timer = setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [pending, code])

  const channel = useMemo(
    (): Channel => ({
      code,
      title: pendingTitle(code),
      youOwn: false,
      you: pending.identity.name,
      repos: [],
      rooms: [],
      directs: [],
      theirs: [],
      people: [],
      nicknames: new Map(),
      messages: [],
      tasks: [],
      taskGroups: [],
      asks: [],
      connection: "live",
      waiting: { code: verify ?? "", since, state, ...(owner ? { owner } : {}) },
    }),
    [code, pending.identity.name, verify, since, state, owner]
  )

  useLayoutEffect(() => publish({ code, channel, run: null }), [code, channel])
  useLayoutEffect(() => () => closeOpened(code), [code])
  return null
})
