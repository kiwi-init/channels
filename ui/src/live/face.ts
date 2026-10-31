import { useEffect, useRef } from "react"

import type { SendOptions } from "@kiwi/core/client.ts"
import { isPerson, type ChannelState } from "@kiwi/core/state.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { useGithubLogin } from "~/live/account"

export function faceDue(tried: string | null | undefined, login: string | null): boolean {
  return tried !== login
}

export function usePublishFace(state: ChannelState, me: string, ready: boolean, send: (body: string, opts: SendOptions) => Promise<number>): void {
  const tried = useRef<string | null | undefined>(undefined)
  const login = useGithubLogin()
  const mine = state.members.get(me)
  const current = mine?.active && isPerson(mine) ? (mine.picture?.data ?? "") : null
  useEffect(() => {
    const b = bridge()
    if (!ready || current === null || !b || !faceDue(tried.current, login)) return
    tried.current = login
    void b
      .githubPicture()
      .then((picture) => {
        if ((picture?.data ?? "") !== current) return send(picture ? "set their picture" : "cleared their picture", { kind: "event", ev: { op: "picture.set", member: me, picture } })
      })
      .catch(() => {
        // A picture that can't be fetched or sent leaves the face as it is: the initial still says who this is.
      })
  }, [ready, current, me, send, login])
}
