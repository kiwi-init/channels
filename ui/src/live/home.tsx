import "~/i18n/en/live-later"
import { memo, useCallback, useLayoutEffect, useMemo } from "react"

import { useKnownChannels } from "@kiwi/channel/list.ts"
import { loadMember, type StoredMember } from "@kiwi/channel/store.ts"
import { useChannel } from "@kiwi/channel/use-channel.ts"
import { useSecrets } from "@kiwi/secrets/secrets.ts"
import { homeOf } from "~/home"
import { t } from "~/i18n/i18n"
import { announce } from "~/kit/toasts"
import { sendOptions } from "~/live/channel"
import { dmRoomOf } from "~/live/dm"
import { asksOf, lastSaidOf, peopleOf, tasksOf } from "~/live/map"
import { usePinsHere } from "~/live/pins"
import { specAsksOf, specsOf } from "~/live/specs"
import { withReach } from "~/live/reach"
import { publishHome, type Run } from "~/live/store"
import { changeUnsent, nextUnsentKey } from "~/live/unsent"
import { refusal } from "~/live/refused"
import { backWords, composerKey, giveBack } from "~/chat/drafts"
import { stashText } from "~/chat/stash"
import { useWakes } from "~/live/wakes"
import type { SendExtras, Where } from "~/model"
import { nicknamesOf } from "~/names"

export function HomeMembers({ except = null }: { except?: string | null }) {
  const { channels } = useSecrets()
  const members = useMemo(
    () => channels.flatMap((c) => (c.code && c.access && !c.relay && c.code !== except ? (loadMember(c.code) ?? []) : [])).filter((m) => !m.relay),
    [channels, except]
  )
  return members.map((m) => <HomeMember key={m.code} member={m} />)
}

const HomeMember = memo(function HomeMember({ member }: { member: StoredMember }) {
  const { ch, state, messages: shown, reach, roster, online, requests, isOwner, gone, ready, send, refreshRequests, refreshRoster, foldFrom, older } = useChannel(member, undefined, true)
  const messages = useMemo(() => withReach(reach, shown, state.openAsks), [reach, shown, state.openAsks])
  const me = member.identity.name
  const roomId = member.access.roomId
  const code = member.code
  const wakes = useWakes(roomId)
  const pins = usePinsHere(requests)
  const known = useKnownChannels()
  const title = known.find((c) => c.code === code)?.name ?? member.name ?? code
  const people = useMemo(() => peopleOf(state, roster, online, me, wakes), [state, roster, online, me, wakes])
  const asks = useMemo(() => asksOf(state, messages, me, isOwner, requests, roster, pins), [state, messages, me, isOwner, requests, roster, pins])
  const tasks = useMemo(() => tasksOf(state, asks.held, me, messages), [state, asks.held, me, messages])
  const specs = useMemo(() => specsOf(state, me), [state, me])
  const nicknames = useMemo(() => nicknamesOf(state.members.values()), [state.members])
  const lead = state.lead
  const said = useMemo(() => lastSaidOf(state, messages, me), [state, messages, me])
  const summary = useMemo(
    () =>
      homeOf(
        {
          code,
          title,
          ...(lead ? { lead } : {}),
          people,
          asks: [...asks.asks, ...specAsksOf(specs)],
          specs,
          tasks,
          nicknames,
          ...(ready ? {} : { loading: true as const }),
        },
        said
      ),
    [code, title, lead, people, asks.asks, specs, tasks, nicknames, ready, said]
  )

  const post = useCallback(
    async (where: Where, text: string, opts: SendExtras): Promise<number> => {
      if (where.kind === "theirs") throw new Error(t("live.channel.theirs"))
      const body = text.trim()
      const room = where.kind === "dm" ? dmRoomOf(state, me, where.with) : undefined
      try {
        return await send(body, room ? { kind: "msg", room } : sendOptions(state, messages, me, where, body, opts))
      } catch (err) {
        const refused = refusal(err)
        if (refused !== null) {
          const images = opts.images ?? []
          announce(t("live.home.refused", { title, text: backWords(refused, giveBack(composerKey(code, where, opts.inThread), body, images, stashText), images.length) }), "error")
          throw err
        }
        const why = err instanceof Error ? err.message : String(err)
        changeUnsent(roomId, (list) => [...list, { key: nextUnsentKey(), where, text: body, at: Date.now(), failed: why }])
        announce(t("live.home.not.sent", { title, why }), "error")
        throw err
      }
    },
    [state, messages, me, send, roomId, title, code]
  )
  const retry = useCallback(async (): Promise<number> => {
    throw new Error(t("live.home.open.to.retry"))
  }, [])
  const discard = useCallback((key: number) => void changeUnsent(roomId, (list) => list.filter((p) => p.key !== key)), [roomId])

  const run = useMemo(
    (): Run => ({ code, roomId, me, isOwner, ch, state, messages, roster, requests, send, post, retry, discard, refreshRequests, refreshRoster, foldFrom, older }),
    [code, roomId, me, isOwner, ch, state, messages, roster, requests, send, post, retry, discard, refreshRequests, refreshRoster, foldFrom, older]
  )

  useLayoutEffect(() => publishHome(code, gone ? null : { channel: summary, run }), [code, summary, run, gone])
  useLayoutEffect(() => () => publishHome(code, null), [code])
  return null
})
