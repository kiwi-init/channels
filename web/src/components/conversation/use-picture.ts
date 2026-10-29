import { useEffect, useMemo, useRef } from "react"

import type { MemberPicture } from "@kiwi/core/protocol.ts"
import { isPerson, type ChannelState } from "@kiwi/core/state.ts"
import type { ChannelHandle } from "@kiwi/channel/use-channel.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"

/** People's pictures in this channel, by member name, for the faces drawn in it. */
export function usePictures(state: ChannelState): ReadonlyMap<string, MemberPicture> {
  const pictures = JSON.stringify([...state.members.values()].flatMap((m) => (m.active && m.picture ? [[m.name, m.picture] as const] : [])))
  return useMemo(() => new Map(JSON.parse(pictures) as [string, MemberPicture][]), [pictures])
}

/** Once the channel has loaded: publish the linked GitHub account's picture as yours, or clear it once GitHub is unlinked. */
export function usePublishPicture(state: ChannelState, me: string, ready: boolean, send: ChannelHandle["send"]): void {
  const done = useRef(false)
  const mine = state.members.get(me)
  const current = mine?.active && isPerson(mine) ? (mine.picture?.data ?? "") : null
  useEffect(() => {
    const b = bridge()
    if (!ready || done.current || current === null || !b?.githubPicture) return
    done.current = true
    void b
      .githubPicture()
      .then((picture) => {
        if ((picture?.data ?? "") !== current) return send(picture ? "set their picture" : "cleared their picture", { kind: "event", ev: { op: "picture.set", member: me, picture } })
      })
      .catch(() => {
        // A picture that can't be fetched or sent leaves the face as it is: the initials still say who this is.
      })
  }, [ready, current, me, send])
}
