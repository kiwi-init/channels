import { useEffect, useMemo, useRef } from "react"

import type { MemberPicture } from "@kiwi/core/protocol.ts"
import { isPerson, type ChannelState } from "@kiwi/core/state.ts"
import type { ChannelHandle } from "@/lib/channel"
import { bridge } from "@/lib/secrets"

const samePicture = (a: MemberPicture | null | undefined, b: MemberPicture | null | undefined): boolean => (a?.mime ?? null) === (b?.mime ?? null) && (a?.data ?? null) === (b?.data ?? null)

/** People's pictures in this channel, by member name, for the faces drawn in it. */
export function usePictures(state: ChannelState): ReadonlyMap<string, MemberPicture> {
  return useMemo(() => new Map([...state.members.values()].flatMap((m) => (m.active && isPerson(m) && m.picture ? [[m.name, m.picture] as const] : []))), [state.members])
}

/** Once the channel has loaded: publish the linked GitHub account's picture as yours, or clear it once GitHub is unlinked. */
export function usePublishPicture(state: ChannelState, me: string, ready: boolean, send: ChannelHandle["send"]): void {
  const done = useRef(false)
  const mine = state.members.get(me)
  const current = mine?.picture ?? null
  const person = !!mine && mine.active && isPerson(mine)
  useEffect(() => {
    const b = bridge()
    if (!ready || done.current || !person || !b?.githubPicture) return
    done.current = true
    void b
      .githubPicture()
      .then((picture) => {
        if (samePicture(picture, current)) return
        return send(picture ? "set their picture" : "cleared their picture", { kind: "event", ev: { op: "picture.set", member: me, picture } })
      })
      .catch(() => {
        // A picture that can't be fetched or sent leaves the face as it is: the initials still say who this is.
      })
  }, [ready, person, current, me, send])
}
