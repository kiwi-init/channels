import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import type { SendOptions } from "@kiwi/core/client.ts"
import { GENERAL_ROOM, type Message as Wire } from "@kiwi/core/protocol.ts"
import { answersDecisions, dmPlace, fullyTrusted, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import { channelTitle, loadRecent, saveRecent } from "@kiwi/channel/recent.ts"
import { useChannel } from "@kiwi/channel/use-channel.ts"
import { useKnownChannels } from "@kiwi/channel/list.ts"
import { type StoredMember } from "@kiwi/channel/store.ts"
import { useIcons, useLiveIcon } from "@kiwi/app/icons.ts"
import { markSeen, setOpenNews } from "@kiwi/channel/news.ts"
import { lastPreview } from "@kiwi/app/preview.ts"
import { roomLast, roomOfMessage, roomSeenKey } from "@kiwi/app/rooms.ts"
import { sendsInTurn } from "@kiwi/app/send-order.ts"
import { markSeenIn, roomsFrom, seenIn, sendFrom, useSeen } from "@kiwi/app/threads.ts"
import { useAskChime } from "~/live/alerts"
import { useNewMembers, useNewPowers } from "~/live/defaults"
import { kept } from "~/live/keep"
import { changeUnsent, nextUnsentKey, unsentIn } from "~/live/unsent"
import { asksOf, directsOf, groupsOf, leftOutOf, messagesOf, formerOf, nextOf, peopleOf, roomsOf, tasksOf, theirsOf, type Pending } from "~/live/map"
import { iconUrl } from "~/live/icon"
import { usePinsHere } from "~/live/pins"
import { usePublishFace } from "~/live/face"
import { usePictures } from "~/live/pictures"
import { seated, useSeats } from "~/live/seats"
import { elsewhere, type NotePlace } from "~/live/notify"
import { isMuted, tells } from "~/live/quiet"
import { tellMessage } from "~/live/notes"
import { ownPrefs, usePrefs } from "~/live/prefs"
import { receiptsOf, withReceipts } from "~/live/receipts"
import { announce } from "~/kit/toasts"
import { arrivals } from "~/live/persona-later"
import { lastIn, seenKeyOf } from "~/live/seen-place"
import { closeOpened, markGone, publish, type Run } from "~/live/store"
import { useWakes } from "~/live/wakes"
import { appCan } from "~/live/app-can"
import { useMarksSync } from "~/live/read-sync"
import { dmRoomOf, sealable } from "~/live/dm"
import { clock } from "~/kit/time"
import type { Channel, Upload, Where } from "~/model"
import { nicknamesOf } from "~/names"

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

function sendOptions(state: ChannelState, messages: readonly Wire[], me: string, where: Exclude<Where, { kind: "theirs" }>, body: string, opts: { replyTo?: number; inThread?: number }): SendOptions {
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
  const { ch, state, messages, roster, online, requests, isOwner, connection, gone, ready, send, refreshRequests, refreshRoster, foldFrom, marks, pkOf } = live
  const me = member.identity.name
  const roomId = member.access.roomId
  const code = member.code
  const seen = useSeen(roomId)
  const wakes = useWakes(roomId)
  const newMembers = useNewMembers(roomId)
  const newPowers = useNewPowers(roomId)
  const pictures = usePictures(code, ch, messages)
  useMarksSync(ch, roomId)
  const known = useKnownChannels()
  const icon = iconUrl(useIcons().get(roomId) ?? null)
  useLiveIcon(member)
  const [pending, setPendingNow] = useState<Pending[]>(() => unsentIn(roomId))
  const setPending = useCallback((change: (list: Pending[]) => Pending[]) => setPendingNow(changeUnsent(roomId, change)), [roomId])
  const [inTurn] = useState(sendsInTurn)
  const shown = useShown()

  usePublishFace(state, me, connection === "live", send)
  const seats = useSeats()
  const people = useMemo(() => seated(peopleOf(state, roster, online, me, wakes), seats, roomId), [state, roster, online, me, wakes, seats, roomId])
  const former = useMemo(() => formerOf(state, me), [state, me])
  const nicknameKey = [...state.members.values()].map((m) => `${m.name}\u0000${m.display ?? ""}`).join("\n")
  const nicknames = useMemo(() => nicknamesOf(nicknameKey ? nicknameKey.split("\n").map((line) => ({ name: line.split("\u0000")[0] ?? "", display: line.split("\u0000")[1] })) : []), [nicknameKey])
  const pins = usePinsHere(requests)
  const asks = useMemo(() => asksOf(state, messages, me, isOwner, requests, roster, pins), [state, messages, me, isOwner, requests, roster, pins])
  const rows = useMemo(() => messagesOf(state, messages, me, asks.askOf, pictures, pending), [state, messages, me, asks.askOf, pictures, pending])
  const receipts = useMemo(() => receiptsOf(state, messages, me, marks, pkOf, clock), [state, messages, me, marks, pkOf])
  const mapped = useMemo(() => kept(code, withReceipts(rows, receipts)), [code, rows, receipts])
  const leftOut = useMemo(() => (isOwner ? leftOutOf(state, messages, me) : []), [isOwner, state, messages, me])
  const tasks = useMemo(() => tasksOf(state, asks.held, me, messages), [state, asks.held, me, messages])
  const taskGroups = useMemo(() => groupsOf(state, me), [state, me])
  const from = roomsFrom(roomId)
  const { muted } = usePrefs()
  const rooms = useMemo(() => roomsOf(state, messages, me, seen, from).map((r) => (isMuted(muted, code, r.id) ? { ...r, muted: true as const } : r)), [state, messages, me, seen, from, muted, code])
  const directs = useMemo(() => directsOf(state, messages, me, seen), [state, messages, me, seen])
  const theirs = useMemo(() => theirsOf(state, messages, me), [state, messages, me])
  const others = useMemo(() => people.filter((p) => !p.you), [people])
  const title = channelTitle(
    { name: known.find((c) => c.code === code)?.name ?? member.name },
    others.length ? { from: "", text: "", ts: 0, people: others.map((p) => p.display ?? p.name) } : loadRecent(code)
  )

  const facts = useMemo(() => [...state.facts.values()].sort((a, b) => a.key.localeCompare(b.key)).map((f) => ({ key: f.key, value: f.value, by: f.by, at: f.ts })), [state.facts])
  const next = nextOf(state)
  const mergedAt = useMemo(() => [...state.github.prs.values()].flatMap((p) => (p.state === "merged" ? [p.at] : [])), [state.github.prs])

  const trusted = !isOwner && fullyTrusted(state.members.get(me))
  const channel = useMemo(
    (): Channel => ({
      code,
      title,
      ...(icon ? { icon } : {}),
      youOwn: isOwner,
      ...(!isOwner && people.some((p) => p.you && p.managesAgents) ? { youManageAgents: true } : {}),
      ...(trusted ? { youTrusted: true } : {}),
      you: me,
      ...(state.lead ? { lead: state.lead } : {}),
      ...(state.charter ? { goal: state.charter.text } : {}),
      ...(facts.length ? { facts } : {}),
      ...(next ? { next } : {}),
      mergedAt,
      ...(state.hold ? { hold: { ...(state.hold.note ? { note: state.hold.note } : {}), by: state.hold.by, at: state.hold.at } } : {}),
      ...(state.compact ? { compact: state.compact } : {}),
      ...(state.compactProposal ? { proposal: state.compactProposal } : {}),
      newMembers,
      newPowers,
      repos: state.repos,
      ...(state.githubWrite !== null ? { githubWrite: true } : {}),
      ...(state.branchPrefix ? { branchPrefix: state.branchPrefix } : {}),
      rooms,
      directs,
      theirs,
      people,
      former,
      nicknames,
      messages: mapped,
      ...(leftOut.length ? { leftOut } : {}),
      tasks,
      taskGroups,
      asks: asks.asks,
      connection,
      ...(ready ? {} : { loading: true }),
    }),
    [
      code,
      title,
      icon,
      isOwner,
      me,
      state.lead,
      state.charter,
      facts,
      next,
      mergedAt,
      state.hold,
      state.compact,
      state.compactProposal,
      newMembers,
      newPowers,
      state.repos,
      state.githubWrite,
      state.branchPrefix,
      rooms,
      directs,
      theirs,
      people,
      former,
      nicknames,
      mapped,
      leftOut,
      tasks,
      taskGroups,
      asks.asks,
      connection,
      ready,
      trusted,
    ]
  )

  const post = useCallback(
    async (where: Where, text: string, opts: { replyTo?: number; inThread?: number; images?: Upload[] }): Promise<number> => {
      if (where.kind === "theirs") throw new Error("Only the two of them write in their direct messages")
      const key = nextUnsentKey()
      const body = text.trim()
      const imgs = opts.images?.length ? { imgs: opts.images } : {}
      const plain = { ...sendOptions(state, messages, me, where, body, opts), ...imgs }
      const sealedIn = async (other: string): Promise<string | undefined> => {
        const had = dmRoomOf(state, me, other)
        if (had || !sealable(channel, other)) return had
        const seat = roster.find((r) => r.active && r.name === other)
        if (!seat?.xpk || !(await appCan("makeDm"))) return undefined
        try {
          return await ch.makeDm({ name: seat.name, pk: seat.pk, xpk: seat.xpk })
        } catch (err) {
          if (/no such call|not a call|unknown call/i.test(err instanceof Error ? err.message : String(err))) return undefined
          throw err
        }
      }
      const re = opts.replyTo ?? opts.inThread
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
        const seq = await inTurn(async () => {
          const room = where.kind === "dm" ? await sealedIn(where.with) : undefined
          return send(body, room ? { kind: "msg", room, ...(re !== undefined ? { re: [re] } : {}), ...imgs } : plain)
        })
        setPending((list) => list.map((p) => (p.key === key ? { ...p, seq } : p)))
        return seq
      } catch (err) {
        setPending((list) => list.map((p) => (p.key === key ? { ...p, failed: err instanceof Error ? err.message : String(err) } : p)))
        throw err
      }
    },
    [state, messages, me, send, inTurn, setPending, channel, roster, ch]
  )

  const discard = useCallback((key: number) => setPending((list) => list.filter((p) => p.key !== key)), [setPending])
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

  useLayoutEffect(() => {
    if (!gone) return publish({ code, channel, run })
    markGone({ code, title, why: gone })
    closeOpened(code)
  }, [code, channel, run, gone, title])
  useLayoutEffect(() => () => closeOpened(code), [code])

  const firstVisit = useRef(Object.keys(seenIn(roomId)).length === 0)
  useEffect(() => {
    if (!firstVisit.current || !messages.length) return
    firstVisit.current = false
    markSeenIn(roomId, {
      ...Object.fromEntries([...state.places].map(([k, v]) => [k, v.last])),
      ...Object.fromEntries([...roomLast(state, messages)].map(([id, seq]) => [roomSeenKey(id), seq])),
    })
  }, [firstVisit, messages, state, roomId])

  useEffect(() => {
    for (const { name, persona } of arrivals(code, people))
      void import("~/live/manage").then((m) => m.setPersona(code, name, persona)).catch((e: unknown) => announce(`Personality not set on ${name}: ${e instanceof Error ? e.message : String(e)}`))
  }, [code, people])

  const where = view.where
  const lastHere = useMemo(() => (where ? lastIn(messages, state, me, where) : 0), [messages, state, me, where])
  useEffect(() => {
    if (!where || !lastHere || !shown) return
    markSeenIn(roomId, { [seenKeyOf(state, where, me)]: lastHere })
  }, [where, lastHere, roomId, me, shown, state])
  const task = view.task
  const lastInTask = useMemo(() => (task === null ? 0 : (state.places.get(placeKey({ kind: "task", task }))?.last ?? 0)), [task, state.places])
  useEffect(() => {
    if (task !== null && lastInTask && shown) markSeenIn(roomId, { [placeKey({ kind: "task", task })]: lastInTask })
  }, [task, lastInTask, roomId, shown])

  const waiting = useMemo(() => asks.asks.filter((a) => !("answer" in a && a.answer) && !(a.kind === "question" && a.idle)), [asks.asks])
  const needs = waiting.length
  useAskChime(waiting)
  const top = Math.max(live.head, messages.at(-1)?.seq ?? 0)
  const unreadHere = rooms.reduce((n, r) => n + (r.muted ? r.mentions : r.unread), 0) + directs.reduce((n, d) => n + d.unread, 0)
  useEffect(() => {
    if (top > 0 && shown) markSeen(roomId, top, needs)
  }, [roomId, top, needs, shown])
  const mentionsHere = rooms.reduce((n, r) => n + r.mentions, 0) + directs.reduce((n, d) => n + d.unread, 0)
  useEffect(() => setOpenNews({ room: roomId, unread: unreadHere, needs, mentions: mentionsHere }), [roomId, unreadHere, needs, mentionsHere])
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

  useNotify(messages, me, title, code, state)

  return null
})

function statePlace(state: Pick<ChannelState, "placeOf" | "roomOf" | "rooms">, m: Wire): NotePlace {
  const place = state.placeOf.get(m.seq)
  if (place?.kind === "task") return { kind: "task", task: place.task }
  if (place?.kind === "dm") return { kind: "dm" }
  const id = roomOfMessage(state, m)
  return { kind: "room", name: state.rooms.get(id)?.name ?? id }
}

function useNotify(messages: readonly Wire[], me: string, title: string, code: string, state: ChannelState) {
  const told = useRef(messages.at(-1)?.seq ?? 0)
  useEffect(() => {
    const fresh = messages.filter((m) => m.seq > told.current)
    told.current = Math.max(told.current, messages.at(-1)?.seq ?? 0)
    if (!fresh.length || !elsewhere()) return
    const { members } = state
    const prefs = ownPrefs()
    const decides = answersDecisions(members, me)
    const last = fresh.findLast((m) => m.sigOk && tells(m, me, prefs, code, decides, Date.now()))
    if (last) tellMessage(last, { me, channel: title, code, place: statePlace(state, last), members: members.values(), display: members.get(last.from)?.display })
  }, [messages, me, title, code, state])
}
