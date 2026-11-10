import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react"

import { watches } from "@kiwi/channel/channel-ops.ts"
import { markNeeds } from "@kiwi/channel/news.ts"
import { loadMember, type StoredMember } from "@kiwi/channel/store.ts"
import { useChannel } from "@kiwi/channel/use-channel.ts"
import { HEADS_SAFETY_MS } from "@kiwi/channel/watch.ts"
import { useSecrets } from "@kiwi/secrets/secrets.ts"
import { asksOf } from "~/live/map"
import { usePinsHere } from "~/live/pins"
import { withReach } from "~/live/reach"
import { specAsksOf, specsOf } from "~/live/specs"

const SETTLE_MS = 3_000
const GAP_MS = 60_000
const TICK_MS = 60_000
const GIVE_UP_MS = 30_000

const counted = new Map<string, number>()

export function Recount({ open }: { open: string }) {
  const { channels } = useSecrets()
  const members = useMemo(() => channels.flatMap((c) => (c.code && c.code !== open && c.access && !c.relay ? (loadMember(c.code) ?? []) : [])).filter((m) => !m.relay), [channels, open])
  const [now, setNow] = useState<string | null>(null)
  const dirty = useRef(new Set<string>())
  const member = members.find((m) => m.code === now)

  const pump = useEffectEvent(() => {
    if (member) return
    const t = Date.now()
    const next = members.find((m) => {
      const at = counted.get(m.code)
      return at === undefined || t - at >= HEADS_SAFETY_MS || (dirty.current.has(m.code) && t - at >= GAP_MS)
    })
    if (next) setNow(next.code)
  })
  const done = useCallback((code: string) => {
    counted.set(code, Date.now())
    dirty.current.delete(code)
    setNow((c) => (c === code ? null : c))
  }, [])

  useEffect(() => {
    pump()
  }, [member, members])
  useEffect(() => {
    let soon = 0
    const stops = members.map((m) =>
      watches().watch(m.code, (ev) => {
        if (ev._tag === "Open") return
        dirty.current.add(m.code)
        clearTimeout(soon)
        soon = window.setTimeout(pump, SETTLE_MS)
      })
    )
    const tick = window.setInterval(pump, TICK_MS)
    const onFocus = () => pump()
    window.addEventListener("focus", onFocus)
    return () => {
      for (const s of stops) s()
      clearTimeout(soon)
      clearInterval(tick)
      window.removeEventListener("focus", onFocus)
    }
  }, [members])
  useEffect(() => {
    if (!now) return
    const id = window.setTimeout(() => done(now), GIVE_UP_MS)
    return () => clearTimeout(id)
  }, [now, done])

  return member ? <RecountMember key={member.code} member={member} done={done} /> : null
}

const RecountMember = memo(function RecountMember({ member, done }: { member: StoredMember; done: (code: string) => void }) {
  const { state, messages: shown, reach, roster, requests, isOwner, caughtUp, gone, refreshRequests } = useChannel(member, undefined, true)
  const me = member.identity.name
  const code = member.code
  const room = member.access.roomId
  const messages = useMemo(() => withReach(reach, shown, state.openAsks), [reach, shown, state.openAsks])
  const pins = usePinsHere(requests)
  const asks = useMemo(() => asksOf(state, messages, me, isOwner, requests, roster, pins), [state, messages, me, isOwner, requests, roster, pins])
  const needs = useMemo(() => asks.asks.length + specAsksOf(specsOf(state, me)).length, [asks.asks, state, me])
  const [fresh, setFresh] = useState(false)
  const settled = caughtUp && roster.length > 0

  useEffect(() => {
    if (!settled) return
    let live = true
    void refreshRequests().finally(() => live && setFresh(true))
    return () => {
      live = false
    }
  }, [settled, refreshRequests])
  useEffect(() => {
    if (gone) return done(code)
    if (!settled || !fresh) return
    markNeeds(room, needs)
    done(code)
  }, [gone, settled, fresh, needs, room, code, done])
  return null
})
