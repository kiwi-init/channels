import { memo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import type { SendOptions } from "@kiwi/core/client.ts"
import { GENERAL_ROOM, QUIET_MINUTES, reviewCheckOf, type Message as Wire } from "@kiwi/core/protocol.ts"
import { reviewStillRequired } from "@kiwi/core/prs.ts"
import { dmPlace, fullyTrusted, placeKey, type ChannelState } from "@kiwi/core/state.ts"
import { channelTitle, loadRecent, saveRecent } from "@kiwi/channel/recent.ts"
import { useChannel } from "@kiwi/channel/use-channel.ts"
import { useKnownChannels } from "@kiwi/channel/list.ts"
import { type StoredMember } from "@kiwi/channel/store.ts"
import { useIcons, useLiveIcon } from "@kiwi/app/icons.ts"
import { markSeen, setOpenNews } from "@kiwi/channel/news.ts"
import { lastPreview } from "@kiwi/app/preview.ts"
import { sendsInTurn } from "@kiwi/app/send-order.ts"
import { markSeenIn, roomsFrom, seenIn, sendFrom, useSeen } from "@kiwi/app/threads.ts"
import { useNewMembers, useNewPowers } from "~/live/defaults"
import { kept } from "~/live/keep"
import { withReach } from "~/live/reach"
import { capUnsent, changeUnsent, landedOut, newSendId, nextUnsentKey, resendDue, retryUnsent, unsentBlock, unsentIn } from "~/live/unsent"
import { asksOf, directsOf, groupsOf, issuesOf, leftOutOf, messagesOf, formerOf, nextOf, peopleOf, prsOf, roomsOf, taskMentionsOf, theirsOf, type Pending } from "~/live/map"
import { useTasksNow } from "~/live/tasks-now"
import { iconUrl } from "~/live/icon"
import { usePinsHere } from "~/live/pins"
import { usePublishFace } from "~/live/face"
import { usePictures } from "~/live/pictures"
import { isMuted } from "~/live/mute"
import { noteOwned } from "~/live/owned"
import { usePrefs } from "~/live/prefs"
import { busyOf, reachedOf, receiptsOf, withReceipts } from "~/live/receipts"
import { t } from "~/i18n/i18n"
import { announce } from "~/kit/toasts"
import { arrivals } from "~/live/persona-later"
import { firstMarks, lastIn, seenByThread, seenKeyOf } from "~/live/seen-place"
import { followsIn, threadSeenKey, threadsOf } from "~/live/threads"
import { closeOpened, markGone, publish, type Run } from "~/live/store"
import { useWakes } from "~/live/wakes"
import { useSharedHere } from "~/live/shared"
import { appCan } from "~/live/app-can"
import { useMarksSync } from "~/live/read-sync"
import { dailyLimit, refusal } from "~/live/refused"
import { myUsage } from "~/live/usage"
import { loadUsage, showLimit } from "~/usage/store"
import { backWords, composerKey, giveBack } from "~/chat/drafts"
import { giveBackBlock } from "~/chat/doc/give-back"
import { stashText } from "~/chat/stash"
import { dmInRoom, dmRoomOf, dmsOnce } from "~/live/dm"
import { freeOf, specAsksOf, specsOf } from "~/live/specs"
import { clock } from "~/kit/time"
import type { Channel, SendExtras, Where } from "~/model"
import { nicknamesOf } from "~/names"

export interface View {
  where: Where | null
  task: number | null
  thread: number | null
}

const PENDING_MAX = 50
const RESEND_EVERY_MS = 15_000

const LEADING = /^(?:\s*@([\p{L}\p{N}_.-]+)[\s,]*)+/u

function named(body: string, names: ReadonlySet<string>): string[] {
  const lead = LEADING.exec(body)?.[0] ?? ""
  return [...lead.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].flatMap((m) => (m[1] && names.has(m[1]) ? [m[1]] : []))
}

export function sendOptions(state: ChannelState, messages: readonly Wire[], me: string, where: Exclude<Where, { kind: "theirs" }>, body: string, opts: Omit<SendExtras, "images">): SendOptions {
  const names = new Set([...state.members.values()].filter((m) => m.active && m.name !== me).map((m) => m.name))
  const re = opts.replyTo ?? opts.inThread
  const target = opts.replyTo !== undefined ? messages.find((m) => m.seq === opts.replyTo) : undefined
  const mentioned = named(body, names)
  const to = mentioned.length ? mentioned : target && target.from !== me ? [target.from] : undefined
  const base: SendOptions = {
    kind: "msg",
    ...(re !== undefined ? { re: [re] } : {}),
    ...(re !== undefined && opts.side ? { side: true } : {}),
    ...(to ? { to } : {}),
    ...(opts.block ? { block: opts.block } : {}),
    ...(opts.id ? { id: opts.id, cid: opts.id } : {}),
  }
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
  const {
    ch,
    state,
    messages: shownWire,
    reach,
    roster,
    online,
    asleep,
    answered,
    requests,
    isOwner,
    connection,
    gone,
    ready,
    caughtUp,
    send,
    refreshRequests,
    refreshRoster,
    foldFrom,
    marks,
    pkOf,
    github,
    older,
  } = live
  const messages = useMemo(() => withReach(reach, shownWire, state.openAsks), [reach, shownWire, state.openAsks])
  const since = shownWire[0]?.seq
  const me = member.identity.name
  const roomId = member.access.roomId
  const code = member.code
  const seen = useSeen(roomId)
  const wakes = useWakes(roomId)
  const elsewhere = useSharedHere(roomId)
  const newMembers = useNewMembers(roomId)
  const newPowers = useNewPowers(roomId)
  const pictures = usePictures(code, ch, shownWire)
  useMarksSync(ch, roomId, caughtUp)
  const known = useKnownChannels()
  const icon = iconUrl(useIcons().get(roomId) ?? null)
  useLiveIcon(member)
  const [pending, setPendingNow] = useState<Pending[]>(() => unsentIn(roomId))
  const setPending = useCallback((change: (list: Pending[]) => Pending[]) => setPendingNow(changeUnsent(roomId, change)), [roomId])
  const [inTurn] = useState(sendsInTurn)
  const [dmOnce] = useState(dmsOnce)
  const shown = useShown()

  usePublishFace(state, me, connection === "live", send)
  const people = useMemo(
    () => peopleOf(state, roster, online, me, wakes).map((p) => (elsewhere.has(p.name) ? { ...p, sharesElsewhere: elsewhere.get(p.name) ?? [] } : p)),
    [state, roster, online, me, wakes, elsewhere]
  )
  const former = useMemo(() => formerOf(state, me), [state, me])
  const nicknameKey = [...state.members.values()].map((m) => `${m.name}\u0000${m.display ?? ""}`).join("\n")
  const nicknames = useMemo(() => nicknamesOf(nicknameKey ? nicknameKey.split("\n").map((line) => ({ name: line.split("\u0000")[0] ?? "", display: line.split("\u0000")[1] })) : []), [nicknameKey])
  const pins = usePinsHere(requests)
  const asks = useMemo(() => asksOf(state, messages, me, isOwner, requests, roster, pins), [state, messages, me, isOwner, requests, roster, pins])
  const mine = useMemo(() => new Set(pending.some((p) => p.failed !== undefined && p.id) ? messages.flatMap((m) => (m.from === me ? [m.id] : [])) : []), [pending, messages, me])
  const unsent = useMemo(() => landedOut(pending, mine), [pending, mine])
  const rows = useMemo(() => messagesOf(state, messages, me, asks.askOf, pictures, unsent), [state, messages, me, asks.askOf, pictures, unsent])
  const busy = useMemo(() => busyOf(people), [people])
  const reached = useMemo(() => reachedOf(online, asleep, answered), [online, asleep, answered])
  const receipts = useMemo(() => receiptsOf(state, shownWire, me, marks, pkOf, clock, busy, undefined, reached), [state, shownWire, me, marks, pkOf, busy, reached])
  const mapped = useMemo(() => kept(code, withReceipts(rows, receipts)), [code, rows, receipts])
  const leftOut = useMemo(() => (isOwner ? leftOutOf(state, shownWire, me) : []), [isOwner, state, shownWire, me])
  const listed = useTasksNow(state, asks.held, me, messages)
  const taskGroups = useMemo(() => groupsOf(state, me), [state, me])
  const specs = useMemo(() => specsOf(state, me), [state, me])
  const free = useMemo(() => freeOf(state), [state])
  const everyAsk = useMemo(() => [...asks.asks, ...specAsksOf(specs)], [asks.asks, specs])
  const from = roomsFrom(roomId)
  const { muted } = usePrefs()
  const rooms = useMemo(() => roomsOf(state, messages, me, seen, from).map((r) => (isMuted(muted, code, r.id) ? { ...r, muted: true as const } : r)), [state, messages, me, seen, from, muted, code])
  const directs = useMemo(() => directsOf(state, messages, me, seen), [state, messages, me, seen])
  const taskMentions = useMemo(() => taskMentionsOf(state, messages, me, seen, from), [state, messages, me, seen, from])
  const tasks = useMemo(
    () =>
      listed.map((task) => {
        const mentions = taskMentions.get(task.id)
        return mentions ? { ...task, mentions } : task
      }),
    [listed, taskMentions]
  )
  const threads = useMemo(() => threadsOf(state, messages, me, seen, from), [state, messages, me, seen, from])
  const follows = useMemo(() => followsIn(seen), [seen])
  const theirs = useMemo(() => theirsOf(state, messages, me), [state, messages, me])
  const others = useMemo(() => people.filter((p) => !p.you), [people])
  const title = channelTitle(
    { name: known.find((c) => c.code === code)?.name ?? member.name },
    others.length ? { from: "", text: "", ts: 0, people: others.map((p) => p.display ?? p.name) } : loadRecent(code)
  )

  const facts = useMemo(() => [...state.facts.values()].sort((a, b) => a.key.localeCompare(b.key)).map((f) => ({ key: f.key, value: f.value, by: f.by, at: f.ts })), [state.facts])
  const next = nextOf(state)
  const prs = useMemo(() => prsOf(state), [state])
  const issues = useMemo(() => issuesOf(state), [state])
  const reviewCheck = reviewCheckOf(roomId)
  const required = useMemo(() => reviewStillRequired(state, reviewCheck), [state, reviewCheck])
  const docs = useMemo(() => Object.fromEntries(state.docs), [state.docs])
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
      prs,
      issues,
      ...(github ? { github } : {}),
      ...(state.githubWrite !== null ? { githubWrite: true } : {}),
      ...(state.branchPrefix ? { branchPrefix: state.branchPrefix } : {}),
      ...(state.quietMs !== QUIET_MINUTES * 60_000 ? { quietMinutes: state.quietMs / 60_000 } : {}),
      ...(state.reviewReset ? { reviewReset: true as const } : {}),
      ...(state.landing && state.landing !== "none" ? { landing: state.landing } : {}),
      ...(required.length ? { reviewStillRequired: { repos: required, check: reviewCheck } } : {}),
      rooms,
      directs,
      threads,
      follows,
      theirs,
      people,
      former,
      nicknames,
      messages: mapped,
      ...(since !== undefined && since !== messages[0]?.seq ? { since } : {}),
      ...(leftOut.length ? { leftOut } : {}),
      tasks,
      taskGroups,
      ...(specs.length ? { specs } : {}),
      ...(state.specsOnly !== null ? { specsOnly: true as const } : {}),
      free,
      asks: everyAsk,
      connection,
      docs,
      ...(ready ? {} : { loading: true }),
      ...(ready && !caughtUp ? { behind: true as const } : {}),
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
      prs,
      issues,
      github,
      state.githubWrite,
      state.branchPrefix,
      state.quietMs,
      state.reviewReset,
      state.landing,
      required,
      reviewCheck,
      rooms,
      directs,
      threads,
      follows,
      theirs,
      people,
      former,
      nicknames,
      mapped,
      since,
      messages,
      leftOut,
      tasks,
      taskGroups,
      specs,
      state.specsOnly,
      free,
      everyAsk,
      connection,
      docs,
      ready,
      caughtUp,
      trusted,
    ]
  )

  const post = useCallback(
    async (where: Where, text: string, opts: SendExtras): Promise<number> => {
      if (where.kind === "theirs") throw new Error(t("live.channel.theirs"))
      const key = nextUnsentKey()
      const body = text.trim()
      const imgs = opts.images?.length ? { imgs: opts.images } : {}
      const id = opts.id ?? newSendId()
      const plain = { ...sendOptions(state, messages, me, where, body, { ...opts, id }), ...imgs }
      const sealedIn = async (other: string): Promise<string | undefined> => {
        const had = dmRoomOf(state, me, other)
        if (had || !dmInRoom(channel, other)) return had
        return dmOnce(other, async () => {
          const seat = roster.find((r) => r.active && r.name === other)
          if (!seat?.xpk || !(await appCan("makeDm"))) return undefined
          try {
            return await ch.makeDm({ name: seat.name, pk: seat.pk, xpk: seat.xpk })
          } catch (err) {
            if (/no such call|not a call|unknown call/i.test(err instanceof Error ? err.message : String(err))) return undefined
            throw err
          }
        })
      }
      const re = opts.replyTo ?? opts.inThread
      const landed = new Set(messages.map((m) => m.seq))
      const next: Pending = {
        key,
        where,
        text: body,
        at: Date.now(),
        id,
        ...(opts.first !== undefined ? { first: opts.first } : {}),
        ...(opts.inThread !== undefined ? { inThread: opts.inThread } : {}),
        ...(opts.side ? { side: true as const } : {}),
        ...(opts.replyTo !== undefined ? { replyTo: opts.replyTo } : {}),
        ...(opts.images?.length ? { images: opts.images } : {}),
        ...(opts.block ? { block: opts.block } : {}),
      }
      setPending((list) => capUnsent([...list.filter((p) => p.seq === undefined || !landed.has(p.seq)), next], PENDING_MAX))
      try {
        const seq = await inTurn(async () => {
          const room = where.kind === "dm" ? await sealedIn(where.with) : undefined
          return send(
            body,
            room
              ? {
                  kind: "msg",
                  room,
                  id,
                  cid: id,
                  ...(re !== undefined ? { re: [re] } : {}),
                  ...(re !== undefined && opts.side ? { side: true } : {}),
                  ...(opts.block ? { block: opts.block } : {}),
                  ...imgs,
                }
              : plain
          )
        })
        setPending((list) => list.map((p) => (p.key === key ? { ...p, seq } : p)))
        return seq
      } catch (err) {
        const why = refusal(err)
        if (why === null) {
          if (dailyLimit(err)) {
            loadUsage(myUsage, true)
            showLimit(code)
          }
          setPending((list) => list.map((p) => (p.key === key ? { ...p, failed: err instanceof Error ? err.message : String(err) } : p)))
          throw err
        }
        setPending((list) => list.filter((p) => p.key !== key))
        if (opts.block) {
          announce(t("live.channel.not.sent", { why }), "error")
          throw err
        }
        const images = opts.images ?? []
        announce(backWords(why, giveBack(composerKey(code, where, opts.inThread), body, images, stashText), images.length), "error")
        throw err
      }
    },
    [state, messages, me, send, inTurn, dmOnce, setPending, channel, roster, ch, code]
  )

  const discard = useCallback((key: number) => setPending((list) => list.filter((p) => p.key !== key)), [setPending])
  const toDraft = useCallback(
    (key: number) => {
      const block = unsentBlock(pending, key)
      discard(key)
      if (block) giveBackBlock(block)
    },
    [pending, discard]
  )
  const retry = useCallback(
    async (key: number): Promise<number> => {
      const block = unsentBlock(pending, key)
      try {
        return await retryUnsent(pending, key, discard, post)
      } catch (err) {
        if (block && refusal(err) !== null) giveBackBlock(block)
        throw err
      }
    },
    [pending, discard, post]
  )
  const resend = useEffectEvent(() => void resendDue(roomId, Date.now(), retry, mine))
  const owed = connection === "live" && pending.some((p) => p.failed !== undefined)
  useEffect(() => {
    if (!owed) return
    resend()
    const timer = setInterval(resend, RESEND_EVERY_MS)
    return () => clearInterval(timer)
  }, [owed])

  const run = useMemo(
    (): Run => ({ code, roomId, me, isOwner, ch, state, messages, roster, requests, send, post, retry, discard: toDraft, refreshRequests, refreshRoster, foldFrom, older }),
    [code, roomId, me, isOwner, ch, state, messages, roster, requests, send, post, retry, toDraft, refreshRequests, refreshRoster, foldFrom, older]
  )

  useLayoutEffect(() => {
    if (!gone) return publish({ code, channel, run })
    markGone({ code, title, why: gone })
    closeOpened(code)
  }, [code, channel, run, gone, title])
  useLayoutEffect(() => () => closeOpened(code), [code])

  useEffect(() => {
    if (ready) noteOwned(code, isOwner)
  }, [ready, code, isOwner])

  useEffect(() => {
    if (!isOwner || !ready || connection !== "live" || state.specsOnly !== null) return
    void import("~/live/manage")
      .then((m) => (m.takeFresh(code) ? m.setSpecsOnly(code, true) : undefined))
      .catch(() => {
        // The switch stays off; the owner turns it on in the channel's settings.
      })
  }, [isOwner, ready, connection, state.specsOnly, code])

  const firstVisit = useRef(Object.keys(seenIn(roomId)).length === 0)
  useEffect(() => {
    if (!firstVisit.current || !messages.length) return
    firstVisit.current = false
    markSeenIn(roomId, firstMarks(state, messages, me))
  }, [firstVisit, messages, state, roomId, me])

  useEffect(() => {
    for (const { name, persona } of arrivals(code, people))
      void import("~/live/manage")
        .then((m) => m.setPersona(code, name, persona))
        .catch((e: unknown) => announce(t("live.channel.persona.not.set", { name, why: e instanceof Error ? e.message : String(e) }), "error"))
  }, [code, people])

  const where = view.where
  const lastHere = useMemo(() => (where ? lastIn(messages, state, me, where) : 0), [messages, state, me, where])
  useEffect(() => {
    if (!where || !lastHere || !shown) return
    markSeenIn(roomId, { [seenKeyOf(state, where, me)]: lastHere })
  }, [where, lastHere, roomId, me, shown, state])
  const openThread = view.thread
  const lastInThread = useMemo(() => (openThread === null ? 0 : (threads.find((t) => t.root === openThread)?.lastSeq ?? 0)), [openThread, threads])
  useEffect(() => {
    if (openThread === null || !lastInThread || !shown) return
    markSeenIn(roomId, { ...seenByThread(messages, state, me, openThread, seenIn(roomId)), [threadSeenKey(openThread)]: lastInThread })
  }, [openThread, lastInThread, roomId, shown, messages, state, me])
  const task = view.task
  const lastInTask = useMemo(() => (task === null ? 0 : (state.places.get(placeKey({ kind: "task", task }))?.last ?? 0)), [task, state.places])
  useEffect(() => {
    if (task !== null && lastInTask && shown) markSeenIn(roomId, { [placeKey({ kind: "task", task })]: lastInTask })
  }, [task, lastInTask, roomId, shown])

  const waiting = useMemo(() => asks.asks.filter((a) => !("answer" in a && a.answer) && !(a.kind === "question" && (a.idle || a.closed))), [asks.asks])
  const needs = waiting.length
  const top = Math.max(live.head, messages.at(-1)?.seq ?? 0)
  const unreadHere = rooms.reduce((n, r) => n + (r.muted ? r.mentions : r.unread), 0) + directs.reduce((n, d) => n + d.unread, 0)
  useEffect(() => {
    if (top > 0 && shown) markSeen(roomId, top, needs)
  }, [roomId, top, needs, shown])
  const mentionsHere = rooms.reduce((n, r) => n + r.mentions, 0) + directs.reduce((n, d) => n + d.unread, 0) + [...taskMentions.values()].reduce((n, k) => n + k, 0)
  useEffect(() => setOpenNews({ room: roomId, unread: unreadHere, needs, mentions: mentionsHere }), [roomId, unreadHere, needs, mentionsHere])
  useEffect(() => () => setOpenNews(null), [roomId])

  useEffect(() => {
    const last = lastPreview(messages, (seq) => state.trust.get(seq))
    const prior = loadRecent(code)
    if (!last && !others.length) return
    const lead = last ? state.lead : prior?.lead
    saveRecent(code, {
      from: last ? (last.from === me ? t("live.channel.recent.you") : last.from) : (prior?.from ?? ""),
      text: last ? last.body.slice(0, 120) : (prior?.text ?? ""),
      ts: last?.ts ?? prior?.ts ?? member.at,
      people: others.length ? others.map((p) => p.display ?? p.name) : (prior?.people ?? []),
      ...(lead ? { lead } : {}),
    })
  }, [messages, others, state, code, me, member.at])

  return null
})
