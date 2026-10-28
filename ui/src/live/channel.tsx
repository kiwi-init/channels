import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import type { SendOptions } from "@kiwi/core/client.ts"
import { GENERAL_ROOM, type Message as Wire } from "@kiwi/core/protocol.ts"
import { dmPlace, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import { channelTitle, loadRecent, saveRecent, useChannel, useKnownChannels, type StoredMember } from "@/lib/channel"
import { useIcons, useLiveIcon } from "@/lib/icons"
import { markSeen, setOpenNews } from "@/lib/news"
import { lastPreview } from "@/lib/preview"
import { roomLast, roomSeenKey } from "@/lib/rooms"
import { bridge } from "@/lib/secrets"
import { sendsInTurn } from "@/lib/send-order"
import { markSeenIn, roomsFrom, seenIn, sendFrom, useSeen } from "@/lib/threads"
import { announce } from "~/kit/toasts"
import { useNewMembers, useNewPowers } from "~/live/defaults"
import { kept } from "~/live/keep"
import { asksOf, directsOf, messagesOf, formerOf, peopleOf, roomsOf, tasksOf, type Pending } from "~/live/map"
import { iconUrl } from "~/live/icon"
import { usePinsHere } from "~/live/pins"
import { usePublishFace } from "~/live/face"
import { usePictures } from "~/live/pictures"
import { ownPrefs } from "~/live/prefs"
import { closeOpened, publish, type Run } from "~/live/store"
import { useWakes } from "~/live/wakes"
import type { Channel, Upload, Where } from "~/model"
import { nicknamesOf } from "~/names"
import { named as withNicknames } from "~/chat/linked"

export interface View {
  where: Where | null
  task: number | null
}

const PENDING_MAX = 50

const LEADING = /^(?:\s*@([\p{L}\p{N}_.-]+)[\s,]*)+/u

function named(body: string, names: ReadonlySet<string>): string[] {
  const lead = LEADING.exec(body)?.[0] ?? ""
  return [...lead.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].flatMap((m) => (m[1] && names.has(m[1]) ? [m[1]] : []))
}

function sendOptions(state: ChannelState, messages: readonly Wire[], me: string, where: Where, body: string, opts: { replyTo?: number; inThread?: number }): SendOptions {
  const names = new Set([...state.members.values()].filter((m) => m.active && m.name !== me).map((m) => m.name))
  const re = opts.replyTo ?? opts.inThread
  const target = opts.replyTo !== undefined ? messages.find((m) => m.seq === opts.replyTo) : undefined
  const mentioned = named(body, names)
  const to = mentioned.length ? mentioned : target && target.from !== me ? [target.from] : undefined
  const base: SendOptions = { kind: "msg", ...(re !== undefined ? { re: [re] } : {}), ...(to ? { to } : {}) }
  if (where.kind === "dm") return { ...base, ...sendFrom(state, dmPlace(me, where.with), me) }
  if (where.kind === "task") return { ...base, ...sendFrom(state, { kind: "task", task: where.task }, me) }
  return where.room === GENERAL_ROOM ? base : { ...base, room: where.room }
}

function seenKeyOf(where: Where, me: string): string {
  if (where.kind === "room") return roomSeenKey(where.room)
  if (where.kind === "dm") return placeKey(dmPlace(me, where.with))
  return placeKey({ kind: "task", task: where.task })
}

function lastIn(messages: readonly Wire[], state: ChannelState, me: string, where: Where): number {
  const key = seenKeyOf(where, me)
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.kind === "event") continue
    const place = state.placeOf.get(m.seq) ?? { kind: "main" as const }
    const at = place.kind === "main" ? roomSeenKey(state.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM) : placeKey(place)
    if (at === key) return m.seq
  }
  return 0
}

function useShown(): boolean {
  return useSyncExternalStore(
    (l) => {
      document.addEventListener("visibilitychange", l)
      return () => document.removeEventListener("visibilitychange", l)
    },
    () => !document.hidden
  )
}

export const OpenMember = memo(function OpenMember({ member, view }: { member: StoredMember; view: View }) {
  const live = useChannel(member)
  const { ch, state, messages, roster, online, requests, isOwner, connection, gone, send, refreshRequests, refreshRoster, foldFrom } = live
  const me = member.identity.name
  const roomId = member.access.roomId
  const code = member.code
  const seen = useSeen(roomId)
  const wakes = useWakes(roomId)
  const newMembers = useNewMembers(roomId)
  const newPowers = useNewPowers(roomId)
  const pictures = usePictures(ch, messages)
  const known = useKnownChannels()
  const icon = iconUrl(useIcons().get(roomId) ?? null)
  useLiveIcon(member)
  const [pending, setPending] = useState<Pending[]>([])
  const counter = useRef(0)
  const [inTurn] = useState(sendsInTurn)
  const shown = useShown()

  usePublishFace(state, me, connection === "live", send)
  const people = useMemo(() => peopleOf(state, roster, online, me, wakes), [state, roster, online, me, wakes])
  const former = useMemo(() => formerOf(state, me), [state, me])
  const nicknameKey = [...state.members.values()].map((m) => `${m.name}\u0000${m.display ?? ""}`).join("\n")
  const nicknames = useMemo(() => nicknamesOf(nicknameKey ? nicknameKey.split("\n").map((line) => ({ name: line.split("\u0000")[0] ?? "", display: line.split("\u0000")[1] })) : []), [nicknameKey])
  const pins = usePinsHere(requests)
  const asks = useMemo(() => asksOf(state, messages, me, isOwner, requests, roster, pins), [state, messages, me, isOwner, requests, roster, pins])
  const mapped = useMemo(() => kept(code, messagesOf(state, messages, me, asks.askOf, pictures, pending)), [code, state, messages, me, asks.askOf, pictures, pending])
  const tasks = useMemo(() => tasksOf(state, asks.held), [state, asks.held])
  const from = roomsFrom(roomId)
  const rooms = useMemo(() => roomsOf(state, messages, me, seen, from), [state, messages, me, seen, from])
  const directs = useMemo(() => directsOf(state, messages, me, seen), [state, messages, me, seen])
  const others = useMemo(() => people.filter((p) => !p.you), [people])
  const title = channelTitle(
    { name: known.find((c) => c.code === code)?.name ?? member.name },
    others.length ? { from: "", text: "", ts: 0, people: others.map((p) => p.display ?? p.name) } : loadRecent(code)
  )

  const channel = useMemo(
    (): Channel => ({
      code,
      title,
      ...(icon ? { icon } : {}),
      youOwn: isOwner,
      you: me,
      ...(state.lead ? { lead: state.lead } : {}),
      ...(state.charter ? { goal: state.charter.text } : {}),
      ...(state.hold ? { hold: { ...(state.hold.note ? { note: state.hold.note } : {}), by: state.hold.by, at: state.hold.at } } : {}),
      newMembers,
      newPowers,
      repos: state.repos,
      rooms,
      directs,
      people,
      former,
      nicknames,
      messages: mapped,
      tasks,
      asks: asks.asks,
      connection,
    }),
    [code, title, icon, isOwner, me, state.lead, state.charter, state.hold, newMembers, newPowers, state.repos, rooms, directs, people, former, nicknames, mapped, tasks, asks.asks, connection]
  )

  const post = useCallback(
    async (where: Where, text: string, opts: { replyTo?: number; inThread?: number; images?: Upload[] }): Promise<number> => {
      const key = ++counter.current
      const body = text.trim()
      const sending = { ...sendOptions(state, messages, me, where, body, opts), ...(opts.images?.length ? { imgs: opts.images } : {}) }
      const landed = new Set(messages.map((m) => m.seq))
      const next: Pending = {
        key,
        where,
        text: body,
        at: Date.now(),
        ...(opts.inThread !== undefined ? { inThread: opts.inThread } : {}),
        ...(opts.replyTo !== undefined ? { replyTo: opts.replyTo } : {}),
        ...(opts.images?.length ? { images: opts.images } : {}),
      }
      setPending((list) => [...list.filter((p) => p.seq === undefined || !landed.has(p.seq)), next].slice(-PENDING_MAX))
      try {
        const seq = await inTurn(() => send(body, sending))
        setPending((list) => list.map((p) => (p.key === key ? { ...p, seq } : p)))
        return seq
      } catch (err) {
        setPending((list) => list.map((p) => (p.key === key ? { ...p, failed: err instanceof Error ? err.message : String(err) } : p)))
        throw err
      }
    },
    [state, messages, me, send, inTurn]
  )

  const discard = useCallback((key: number) => setPending((list) => list.filter((p) => p.key !== key)), [])
  const retry = useCallback(
    async (key: number): Promise<number> => {
      const p = pending.find((x) => x.key === key)
      if (!p) throw new Error("that message is gone")
      discard(key)
      return post(p.where, p.text, {
        ...(p.inThread !== undefined ? { inThread: p.inThread } : {}),
        ...(p.replyTo !== undefined ? { replyTo: p.replyTo } : {}),
        ...(p.images?.length ? { images: p.images } : {}),
      })
    },
    [pending, discard, post]
  )

  const run = useMemo(
    (): Run => ({ code, roomId, me, isOwner, ch, state, messages, roster, requests, send, post, retry, discard, refreshRequests, refreshRoster, foldFrom }),
    [code, roomId, me, isOwner, ch, state, messages, roster, requests, send, post, retry, discard, refreshRequests, refreshRoster, foldFrom]
  )

  useLayoutEffect(() => publish({ code, channel, run }), [code, channel, run])
  useLayoutEffect(() => () => closeOpened(code), [code])

  useEffect(() => {
    if (gone) announce(gone === "closed" ? `${title} was closed by its owner` : `You're no longer in ${title}`)
  }, [gone, title])

  const firstVisit = useRef(Object.keys(seenIn(roomId)).length === 0)
  useEffect(() => {
    if (!firstVisit.current || !messages.length) return
    firstVisit.current = false
    markSeenIn(roomId, {
      ...Object.fromEntries([...state.places].map(([k, v]) => [k, v.last])),
      ...Object.fromEntries([...roomLast(state, messages)].map(([id, seq]) => [roomSeenKey(id), seq])),
    })
  }, [firstVisit, messages, state, roomId])

  const where = view.where
  const lastHere = useMemo(() => (where ? lastIn(messages, state, me, where) : 0), [messages, state, me, where])
  useEffect(() => {
    if (!where || !lastHere || !shown) return
    markSeenIn(roomId, { [seenKeyOf(where, me)]: lastHere })
  }, [where, lastHere, roomId, me, shown])
  const task = view.task
  const lastInTask = useMemo(() => (task === null ? 0 : (state.places.get(placeKey({ kind: "task", task }))?.last ?? 0)), [task, state.places])
  useEffect(() => {
    if (task !== null && lastInTask && shown) markSeenIn(roomId, { [placeKey({ kind: "task", task })]: lastInTask })
  }, [task, lastInTask, roomId, shown])

  const needs = useMemo(() => asks.asks.filter((a) => !("answer" in a && a.answer) && !(a.kind === "question" && a.idle)).length, [asks.asks])
  const top = Math.max(live.head, messages.at(-1)?.seq ?? 0)
  const unreadHere = rooms.reduce((n, r) => n + r.unread, 0) + directs.reduce((n, d) => n + d.unread, 0)
  useEffect(() => {
    if (top > 0 && shown) markSeen(roomId, top, needs)
  }, [roomId, top, needs, shown])
  useEffect(() => setOpenNews({ room: roomId, unread: unreadHere, needs }), [roomId, unreadHere, needs])
  useEffect(() => () => setOpenNews(null), [roomId])

  useEffect(() => {
    const last = lastPreview(messages, (seq) => state.trust.get(seq))
    const prior = loadRecent(code)
    if (!last && !others.length) return
    const lead = last ? state.lead : prior?.lead
    saveRecent(code, {
      from: last ? (last.from === me ? "You" : last.from) : (prior?.from ?? ""),
      text: last ? last.body.slice(0, 120) : (prior?.text ?? ""),
      ts: last?.ts ?? prior?.ts ?? member.at,
      people: others.length ? others.map((p) => p.display ?? p.name) : (prior?.people ?? []),
      ...(lead ? { lead } : {}),
    })
  }, [messages, others, state, code, me, member.at])

  useNotify(messages, me, title, state.members)

  return null
})

function useNotify(messages: readonly Wire[], me: string, title: string, members: ChannelState["members"]) {
  const told = useRef(messages.at(-1)?.seq ?? 0)
  useEffect(() => {
    const fresh = messages.filter((m) => m.seq > told.current && m.kind !== "event" && m.from !== me)
    told.current = Math.max(told.current, messages.at(-1)?.seq ?? 0)
    if (!fresh.length || !document.hidden) return
    const { notify } = ownPrefs()
    const worth = fresh.filter((m) => notify === "all" || (notify === "mentions" && (m.to?.includes(me) || m.body.includes(`@${me}`))))
    const last = worth.at(-1)
    if (!last) return
    const b = bridge()
    const body = withNicknames(last.body, nicknamesOf(members.values())).slice(0, 200)
    const who = members.get(last.from)?.display || last.from
    if (b) void b.notify(`${who} in ${title}`, body).catch(() => {})
    else if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(`${who} in ${title}`, { body })
  }, [messages, me, title, members])
}
