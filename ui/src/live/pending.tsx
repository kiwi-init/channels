import { memo, useEffect, useLayoutEffect, useMemo, useState } from "react"

import { decodeJoinCode } from "@kiwi/core/crypto.ts"
import { checkJoin, forgetPending, type PendingJoin } from "@/lib/channel"
import { isJoinBlip } from "@/lib/join-blip"
import { announce } from "~/kit/toasts"
import { closeOpened, publish } from "~/live/store"
import type { Channel } from "~/model"

const POLL_MS = 2000

export function pendingTitle(code: string): string {
  try {
    return `Channel ${decodeJoinCode(code).roomId.slice(0, 4).toUpperCase()}`
  } catch {
    return "A channel"
  }
}

export const OpenPending = memo(function OpenPending({ pending }: { pending: PendingJoin }) {
  const [verify, setVerify] = useState<string | null>(null)
  const [since] = useState(() => Date.now())
  const code = pending.code

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (stop) return
      try {
        const r = await checkJoin(pending)
        if (stop) return
        if (r === "denied") {
          announce("The owner didn't let you in")
          await forgetPending(code)
          return
        }
        if ("access" in r) return
        setVerify(r.code)
      } catch (err) {
        if (stop) return
        if (!isJoinBlip(err)) announce(`Couldn't check the request: ${err instanceof Error ? err.message : String(err)}`)
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
      people: [],
      messages: [],
      tasks: [],
      asks: [],
      connection: "live",
      waiting: { code: verify ?? "", since },
    }),
    [code, pending.identity.name, verify, since]
  )

  useLayoutEffect(() => publish({ code, channel, run: null }), [code, channel])
  useLayoutEffect(() => () => closeOpened(code), [code])
  return null
})
