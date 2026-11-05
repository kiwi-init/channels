import { Fragment, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { Composer } from "~/chat/composer"
import { docThread } from "@kiwi/core/doc/threads.ts"
import { useEditingIn } from "~/chat/editing"
import { Updates } from "~/chat/events"
import { splitUpdates } from "~/chat/fold-events"
import { foldText, leftOutRun, runFirst, withLeftOut } from "~/chat/left-out"
import { docFeeds, EMPTY_FEED, withDocMedia, withLines } from "~/chat/doc/finished"
import { inFeed, postedBlocks } from "~/chat/doc/posted"
import { chatterLine, chatterRuns, type ChatterRun } from "~/chat/chatter"
import { MessageRow } from "~/chat/message"
import { linked } from "~/chat/linked"
import { threadReply } from "~/chat/quote"
import { QuotePick } from "~/chat/quote-pick"
import { flash, jumpTo, ReplyContext, useReplying, type Replying } from "~/chat/reply"
import type { Jump } from "~/chat/search-box"
import { paintHits } from "~/chat/search-paint"
import { Loading } from "~/kit/bits"
import { land } from "~/kit/glide"
import { later } from "~/kit/later"
import { day, sameDay } from "~/kit/time"
import { type Channel, type Message, type Person, type Where } from "~/model"
import { liveOf, workingIn } from "~/doing"
import { sameWhere, useApp } from "~/nav"
import { keepSpot, spotAt, spotKey, type Spot } from "~/places"
import { between, nickname, shown } from "~/names"
import { dmInRoom } from "~/live/dm"

const HistoryFold = later(() => import("~/chat/compact").then((m) => m.HistoryFold))
const ProposalCard = later(() => import("~/chat/compact").then((m) => m.ProposalCard))
const AddAgentCard = later(() => import("~/modals/add-agent").then((m) => m.AddAgentCard))
const LiveThreadDoc = later(() => import("~/chat/doc/editor").then((m) => m.LiveThreadDoc))

const GROUP_MS = 5 * 60_000
const NEAR_BOTTOM = 48
const TAIL = 100
const MORE = 40
const CAP = 160

interface Span {
  top: number | null
  bottom: number | null
}

function spanOf(list: Message[], from: number, to: number): Span {
  return { top: list[Math.max(0, from)]?.seq ?? null, bottom: to >= list.length ? null : (list[to - 1]?.seq ?? null) }
}

function around(list: Message[], at: number): Span {
  const from = Math.max(0, Math.min(list.length - TAIL, at - 20))
  return spanOf(list, from, Math.min(list.length, from + CAP))
}

export function useNames(channel: Channel): ReadonlyMap<string, string> {
  return channel.nicknames
}

export function useTaskIds(channel: Channel): ReadonlySet<number> {
  const key = channel.tasks.map((t) => t.id).join(",")
  return useMemo(() => new Set(key ? key.split(",").map(Number) : []), [key])
}

export function compactAt(list: Message[], i: number): boolean {
  const m = list[i]
  const prev = list[i - 1]
  if (!m || !prev) return false
  return prev.from === m.from && !prev.system && !m.system && !prev.ask && !prev.leftOut && !m.leftOut && (!m.said || m.said.tone === "quiet") && m.at - prev.at < GROUP_MS && sameDay(prev.at, m.at)
}

export function quoteOf(list: Message[], i: number, bySeq: ReadonlyMap<number, Message>, root?: number): Message | number | undefined {
  const m = list[i]
  if (!m || m.system) return undefined
  const target = m.replyTo ?? (m.inThread !== root ? m.inThread : undefined)
  if (target === undefined || list[i - 1]?.seq === target) return undefined
  return bySeq.get(target) ?? target
}

interface Anchor {
  el: Element
  seq: number
  top: number
  at: number
}

function anchorIn(box: HTMLElement, list: HTMLElement): Anchor | null {
  const rows = list.querySelectorAll<HTMLElement>(":scope > [data-seq]")
  const top = box.getBoundingClientRect().top
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((rows[mid]?.getBoundingClientRect().bottom ?? 0) > top) hi = mid
    else lo = mid + 1
  }
  const el = rows[lo]
  const seq = Number(el?.dataset.seq)
  return el && Number.isSafeInteger(seq) ? { el, seq, top: el.getBoundingClientRect().top - top, at: box.scrollTop } : null
}

const laidOut = (el: Element): boolean => el.isConnected && el.getClientRects().length > 0

function caretEl(list: HTMLElement): Element | null {
  const doc = list.querySelector(".thread-doc")
  const node = doc?.contains(document.activeElement) ? getSelection()?.focusNode : null
  const el = node instanceof Element ? node : node?.parentElement
  return el && doc?.contains(el) && laidOut(el) ? el : null
}

function caretIn(box: HTMLElement, list: HTMLElement): Anchor | null {
  const el = caretEl(list)
  if (!el) return null
  const view = box.getBoundingClientRect()
  const at = el.getBoundingClientRect()
  return at.bottom > view.top && at.top < view.bottom ? { el, seq: Number.NaN, top: at.top - view.top, at: box.scrollTop } : null
}

function docIn(box: HTMLElement, list: HTMLElement): Anchor | null {
  const el = list.querySelector(".thread-doc")
  if (!el) return null
  const view = box.getBoundingClientRect()
  const at = el.getBoundingClientRect()
  return at.bottom > view.top && at.top < view.bottom ? { el, seq: Number.NaN, top: at.top - view.top, at: box.scrollTop } : null
}

function anchorRow(list: HTMLElement, seq: number): Element | null {
  let found: Element | null = null
  let best = -1
  for (const row of list.querySelectorAll<HTMLElement>(":scope > [data-seq]")) {
    const at = Number(row.dataset.seq)
    if (at <= seq && at > best) {
      best = at
      found = row
    }
  }
  return found
}

function spotIn(box: HTMLElement, list: HTMLElement): Spot | null {
  const rows = list.querySelectorAll<HTMLElement>(":scope > [data-seq]")
  const top = box.getBoundingClientRect().top
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((rows[mid]?.getBoundingClientRect().bottom ?? 0) > top) hi = mid
    else lo = mid + 1
  }
  const row = rows[lo]
  const seq = Number(row?.dataset.seq)
  return row && Number.isSafeInteger(seq) ? { seq, offset: Math.round(row.getBoundingClientRect().top - top) } : null
}

function rowAt(box: HTMLElement, list: readonly Message[], at: number): HTMLElement | null {
  for (let i = at; i >= Math.max(0, at - MORE); i--) {
    const row = box.querySelector<HTMLElement>(`:scope > [data-seq="${list[i]?.seq}"]`)
    if (row) return row
  }
  return null
}

export function useStick(following = true, still = false) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const live = useRef(following)
  useLayoutEffect(() => {
    live.current = following
  }, [following])
  const anchor = useRef<Anchor | null>(null)
  const height = useRef(0)
  const held = useRef(false)
  const touched = useRef(false)
  const room = useRef(0)

  const settle = useCallback(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    height.current = list.offsetHeight
    if (stuck.current && !(still && anchor.current)) {
      box.scrollTop = box.scrollHeight
      return
    }
    const a = anchor.current
    if (!a) return
    if (still && a.el.isConnected && !laidOut(a.el)) {
      anchor.current = null
      box.scrollTop = stuck.current ? box.scrollHeight : a.at
      return
    }
    const el = a.el.isConnected ? a.el : anchorRow(list, a.seq)
    if (!el) return
    const top = box.getBoundingClientRect().top
    const clamped = still && box.scrollTop < a.at && box.scrollTop >= box.scrollHeight - box.clientHeight - 0.5
    const shift = el.getBoundingClientRect().top - top - (clamped ? a.top : a.top - (box.scrollTop - a.at))
    const short = still ? box.scrollTop + shift - (box.scrollHeight - box.clientHeight) : 0
    if (short > 0.5) {
      room.current += short
      list.style.paddingBottom = `${room.current}px`
    }
    if (Math.abs(shift) > 0.5) box.scrollTop += shift
    anchor.current = { el, seq: a.seq, top: el.getBoundingClientRect().top - top, at: box.scrollTop }
  }, [still])

  const remember = useCallback(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    if (height.current && list.offsetHeight !== height.current) settle()
    const hidden = box.scrollHeight - box.scrollTop - box.clientHeight
    if (room.current > 0 && hidden > 0.5) {
      room.current = Math.max(0, room.current - hidden)
      list.style.paddingBottom = room.current ? `${room.current}px` : ""
    }
    stuck.current = live.current && !held.current && box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM
    anchor.current = (still ? (caretIn(box, list) ?? (touched.current ? docIn(box, list) : null)) : null) ?? (stuck.current ? null : anchorIn(box, list))
    height.current = list.offsetHeight
  }, [settle, still])

  useLayoutEffect(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    const watch = new ResizeObserver(settle)
    watch.observe(list)
    watch.observe(box)
    return () => watch.disconnect()
  }, [settle])

  useLayoutEffect(() => {
    const box = scroller.current
    if (!box || !still) return
    const touch = () => {
      if (touched.current) return
      touched.current = true
      remember()
    }
    const kinds = ["wheel", "pointerdown", "keydown", "touchstart"] as const
    for (const kind of kinds) box.addEventListener(kind, touch, { passive: true })
    return () => {
      for (const kind of kinds) box.removeEventListener(kind, touch)
    }
  }, [remember, still])

  const toBottom = useCallback((smooth: boolean) => {
    const box = scroller.current
    if (!box) return
    stuck.current = true
    anchor.current = null
    if (room.current && content.current) {
      room.current = 0
      content.current.style.paddingBottom = ""
    }
    box.scrollTo({ top: box.scrollHeight, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" })
  }, [])

  const toOffset = useCallback((top: number) => {
    const box = scroller.current
    if (box) box.scrollTop = top
  }, [])

  const unstick = useCallback(() => {
    stuck.current = false
    anchor.current = null
  }, [])

  const hold = useCallback(
    (on: boolean) => {
      if (held.current === on) return
      held.current = on
      if (on) {
        stuck.current = false
        const box = scroller.current
        const list = content.current
        anchor.current = box && list ? ((still ? caretIn(box, list) : null) ?? anchorIn(box, list)) : null
      } else remember()
    },
    [remember, still]
  )

  return { scroller, content, stuck, live, remember, settle, toBottom, toOffset, unstick, hold }
}

function docOf(channel: Channel, where: Where): string | null {
  if (where.kind === "task") return docThread({ kind: "task", task: where.task })
  if (where.kind === "room") return docThread({ kind: "room", room: where.room })
  if (where.kind === "dm") return channel.directs.find((d) => d.with === where.with)?.doc ?? null
  return null
}

export function Conversation({ channel, jump }: { channel: Channel; jump: Jump | null }) {
  const { nav } = useApp()
  const where: Where = nav.where
  const key = spotKey(channel.code, where)
  const [reply, setReply] = useState<{ key: string; to: Message; excerpt: string | null } | null>(null)
  const replying = useMemo((): Replying => {
    const here = reply?.key === key ? reply : null
    return { to: here?.to ?? null, excerpt: here?.excerpt ?? null, set: (to, excerpt) => setReply(to ? { key, to, excerpt: excerpt ?? null } : null) }
  }, [reply, key])
  const doc = docOf(channel, where)
  const placeName =
    where.kind === "room"
      ? `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}`
      : where.kind === "dm"
        ? nickname(channel, where.with)
        : where.kind === "theirs"
          ? between(channel, where.between)
          : `T${where.task}`

  return (
    <ReplyContext.Provider value={replying}>
      {channel.hold && <HoldBanner channel={channel} hold={channel.hold} />}
      <Feed
        key={`${key}\n${nav.visit}\n${channel.loading ? "loading" : "ready"}`}
        channel={channel}
        where={where}
        spot={nav.restore !== undefined ? nav.restore : spotAt(key)}
        jump={jump && sameWhere(jump.m.where, where) ? jump : null}
        doc={doc}
      />
      {where.kind === "theirs" ? <ReadOnly channel={channel} between={where.between} /> : !doc && <Composer channel={channel} where={where} placeholder={`Message ${placeName}`} />}
    </ReplyContext.Provider>
  )
}

function Feed({ channel, where, spot, jump, doc }: { channel: Channel; where: Where; spot: Spot | null; jump: Jump | null; doc: string | null }) {
  const { go } = useApp()
  const specAsks = useMemo(() => new Set((channel.specs ?? []).map((s) => s.ask)), [channel.specs])
  const feeds = useSyncExternalStore(docFeeds.subscribe, docFeeds.get)
  const raw = useMemo(() => {
    const fromDoc = doc ? (feeds.get(`${channel.code}\n${doc}`) ?? EMPTY_FEED) : EMPTY_FEED
    const feed = withLeftOut(
      channel.messages
        .filter((m) => sameWhere(m.where, where) && (!m.side || where.kind === "task") && inFeed(m, !!doc) && (where.kind !== "room" || m.inThread === undefined || !specAsks.has(m.inThread)))
        .map((m) => withDocMedia(m, m.block === undefined ? undefined : fromDoc.media.get(m.block))),
      (channel.leftOut ?? []).filter((m) => sameWhere(m.where, where))
    )
    if (!doc) return feed
    const posted = postedBlocks(channel.messages)
    return withLines(
      feed,
      fromDoc.lines.filter((l) => !posted.has(l.id)),
      where
    )
  }, [channel.messages, channel.leftOut, channel.code, where, specAsks, doc, feeds])
  const { talk: all, runs } = useMemo(() => splitUpdates(raw), [raw])
  const general = where.kind === "room" && where.room === "general"
  const compact = general ? channel.compact : undefined
  const proposal = general ? channel.proposal : undefined
  const through = compact?.through
  const [earlier, setEarlier] = useState(false)
  const unfolded = useMemo(() => (through === undefined || earlier ? all : all.filter((m) => m.seq > through)), [all, through, earlier])
  const chatter = useMemo(() => (where.kind === "room" ? chatterRuns(channel, unfolded) : new Map<number, ChatterRun>()), [channel, unfolded, where.kind])
  const [shownChatter, setShownChatter] = useState<ReadonlySet<number>>(() => new Set())
  const toggleChatter = useCallback((first: number) => setShownChatter((was) => (was.has(first) ? new Set([...was].filter((s) => s !== first)) : new Set([...was, first]))), [])
  const jumpSeq = jump?.m.seq
  const talkOpen = useCallback((r: ChatterRun | undefined) => !r || shownChatter.has(r.first) || (jumpSeq !== undefined && r.run.some((x) => x.seq === jumpSeq)), [shownChatter, jumpSeq])
  const list = useMemo(() => unfolded.filter((m) => talkOpen(chatter.get(m.seq)) || chatter.get(m.seq)?.first === m.seq), [unfolded, chatter, talkOpen])
  const foldAt = through === undefined ? undefined : list.find((m) => m.seq > through)?.seq
  const proposalAt = proposal && list.some((m) => m.seq === proposal.seq) ? proposal.seq : undefined
  const [shownRuns, setShownRuns] = useState<ReadonlySet<number>>(() => new Set())
  const toggleRun = useCallback((first: number) => setShownRuns((was) => (was.has(first) ? new Set([...was].filter((s) => s !== first)) : new Set([...was, first]))), [])
  const bySeq = useMemo(() => new Map(channel.messages.map((m) => [m.seq, m])), [channel.messages])
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const working = workingIn(channel.people, where)
  const [fresh, setFresh] = useState(0)
  const [far, setFar] = useState(false)

  const [unread] = useState(() => {
    const seen = where.kind === "room" ? channel.rooms.find((r) => r.id === where.room)?.seen : where.kind === "dm" ? channel.directs.find((d) => d.with === where.with)?.seen : undefined
    if (seen === undefined) return null
    const fresh = list.filter((m) => m.seq > seen && m.from !== channel.you && !m.system && !m.leftOut)
    const first = fresh[0]
    return first && first !== list[0] ? { seq: first.seq, count: fresh.length } : null
  })
  const mark = unread?.seq ?? null

  const [back] = useState(() => {
    const at = spot && !jump ? list.findIndex((m) => m.seq === spot.seq) : -1
    return spot && at >= 0 ? { offset: spot.offset, at } : null
  })
  const [span, setSpan] = useState<Span>(() =>
    back
      ? around(list, back.at)
      : mark === null
        ? { top: null, bottom: null }
        : around(
            list,
            list.findIndex((m) => m.seq === mark)
          )
  )
  const lastAt = span.bottom === null ? -1 : list.findIndex((m) => m.seq === span.bottom)
  const end = lastAt >= 0 ? lastAt + 1 : list.length
  const firstAt = span.top === null ? -1 : list.findIndex((m) => m.seq === span.top)
  const start = firstAt >= 0 && firstAt < end ? firstAt : Math.max(0, end - TAIL)
  const following = end === list.length
  const latest = useRef(false)
  const { scroller, content, stuck, live, remember, settle, toBottom, toOffset, unstick, hold } = useStick(following, !!doc)
  const replying = useReplying()
  const quote = useCallback(
    (seq: number, excerpt: string) => {
      const m = list.find((x) => x.seq === seq)
      if (!m) return
      if (where.kind === "task" && replying) return replying.set(m, excerpt)
      const root = m.inThread ?? m.seq
      threadReply.set({ code: channel.code, root, to: m.seq, excerpt })
      go({ to: "panel", panel: { kind: "thread", seq: root } })
    },
    [list, where.kind, replying, channel.code, go]
  )

  useEffect(() => {
    const near = [...list.slice(Math.max(0, start - MORE), start), ...list.slice(end, end + MORE)]
    const texts = near.flatMap((m) => (m.text && !m.system ? [{ text: m.text, seq: m.seq }] : []))
    let stop = () => {}
    let live = true
    const timer = window.setTimeout(() => {
      void import("~/chat/markdown").then(({ warm }) => {
        if (live) stop = warm(texts, ({ text, seq }) => linked(text, names, tasks, seq))
      })
    }, 150)
    return () => {
      live = false
      window.clearTimeout(timer)
      stop()
    }
  }, [list, start, end, names, tasks])

  const opened = useRef(false)
  const pinned = useRef<Spot | null>(back && spot)
  useLayoutEffect(() => {
    if (opened.current) return
    opened.current = true
    const box = scroller.current
    const row = back && content.current ? rowAt(content.current, list, back.at) : null
    if (back && box && row) {
      toOffset(Math.round(box.scrollTop + row.getBoundingClientRect().top - box.getBoundingClientRect().top - back.offset))
      remember()
      if (!stuck.current && unread) queueMicrotask(() => setFresh(unread.count))
      return
    }
    const line = content.current?.querySelector<HTMLElement>(".feed-new")
    if (!line || !unread) return toBottom(false)
    toOffset(line.offsetTop - 12)
    remember()
    if (!stuck.current) queueMicrotask(() => setFresh(unread.count))
  }, [back, list, unread, remember, toBottom, toOffset, stuck, content, scroller])

  const last = list.at(-1)
  const lastSeq = useRef(last?.seq ?? 0)
  useLayoutEffect(() => {
    const before = lastSeq.current
    lastSeq.current = last?.seq ?? 0
    if (!last || last.seq === before) return
    const arriving = before ? list.filter((m) => m.seq > before) : []
    if (arriving.length <= 3) {
      for (const m of arriving) {
        if (m.from === channel.you && !m.pending) continue
        land(content.current?.querySelector(`[data-seq="${m.seq}"]`), m.from === channel.you ? 16 : 8)
      }
    }
    if (last.from === channel.you && !live.current) {
      latest.current = true
      queueMicrotask(() => setSpan({ top: null, bottom: null }))
      return
    }
    if (last.from === channel.you && !doc) toBottom(false)
    else if (!stuck.current && !doc) setFresh((n) => n + list.filter((m) => m.seq > before && m.from !== channel.you && !m.system && !m.leftOut).length)
    settle()
    const box = scroller.current
    if (doc && box) {
      const bottom = box.getBoundingClientRect().bottom
      const below = arriving.filter(
        (m) => m.from !== channel.you && !m.system && !m.leftOut && (content.current?.querySelector(`[data-seq="${m.seq}"]`)?.getBoundingClientRect().top ?? bottom) >= bottom
      )
      if (below.length) setFresh((n) => n + below.length)
    }
  }, [last, list, channel.you, toBottom, settle, stuck, live, content, doc, scroller])

  const here = spotKey(channel.code, where)
  const onScroll = () => {
    remember()
    const box = scroller.current
    if (!box) return
    if (list.length && content.current) {
      const now = stuck.current ? null : spotIn(box, content.current)
      const pin = pinned.current
      if (!pin || !now || now.seq !== pin.seq || Math.abs(now.offset - pin.offset) > 2) {
        pinned.current = null
        keepSpot(here, now)
      }
    }
    if (stuck.current) setFresh(0)
    const below = box.scrollHeight - box.scrollTop - box.clientHeight
    setFar(!following || below > box.clientHeight * 1.5)
    const at = (i: number) => content.current?.querySelector(`[data-seq="${list[i]?.seq}"]`)?.getBoundingClientRect().top
    const top = box.getBoundingClientRect().top
    const cutBelow = (to: number) => to >= end || (at(to) ?? 0) - top > box.clientHeight * 2
    const cutAbove = (from: number) => from <= start || (at(from) ?? Infinity) - (content.current?.getBoundingClientRect().top ?? top) < below - box.clientHeight
    if (start > 0 && box.scrollTop < box.clientHeight * 3 && (!stuck.current || box.scrollHeight < box.clientHeight * 2)) {
      const from = Math.max(0, start - MORE)
      const to = Math.min(end, from + CAP)
      const next = spanOf(list, from, cutBelow(to) ? to : end)
      startTransition(() => setSpan(next))
    } else if (!following && below < box.clientHeight * 3) {
      const to = Math.min(list.length, end + MORE)
      const from = Math.max(start, to - CAP)
      const next = spanOf(list, cutAbove(from) ? from : start, to)
      startTransition(() => setSpan(next))
    } else if (stuck.current && end - start > TAIL * 2) {
      const bottom = content.current?.getBoundingClientRect().bottom ?? 0
      const keeps = (from: number) => {
        const row = content.current ? rowAt(content.current, list, from) : null
        return !!row && bottom - row.getBoundingClientRect().top > box.clientHeight * 5
      }
      let cut = end - TAIL
      while (cut > start + MORE && !keeps(cut)) cut -= MORE
      if (cut > start + MORE) setSpan({ top: list[cut]?.seq ?? null, bottom: null })
    } else if (end - start > CAP) {
      if (cutAbove(end - CAP)) startTransition(() => setSpan(spanOf(list, end - CAP, end)))
      else if (cutBelow(start + CAP)) startTransition(() => setSpan(spanOf(list, start, start + CAP)))
    }
  }

  const toggleEarlier = () => {
    if (earlier) return setEarlier(false)
    setEarlier(true)
    const at = through === undefined ? -1 : all.findIndex((m) => m.seq > through)
    if (at < 0) return
    unstick()
    setSpan(around(all, at))
  }

  const toLatest = () => {
    setFresh(0)
    setFar(false)
    if (following) return toBottom(true)
    latest.current = true
    setSpan({ top: null, bottom: null })
  }

  const known = useRef({ list, all, bySeq })
  const wanted = useRef<number | null>(null)
  useLayoutEffect(() => {
    known.current = { list, all, bySeq }
    if (latest.current && live.current) {
      latest.current = false
      toBottom(false)
    }
    if (wanted.current === null) return
    settle()
    if (jumpTo(content.current, wanted.current)) wanted.current = null
  })
  const onQuote = useCallback(
    (seq: number) => {
      if (jumpTo(content.current, seq)) return
      const { list, all, bySeq } = known.current
      const at = list.findIndex((m) => m.seq === seq)
      if (at >= 0) {
        wanted.current = seq
        setSpan(around(list, at))
        return
      }
      const folded = all.findIndex((m) => m.seq === seq)
      if (folded >= 0) {
        wanted.current = seq
        setEarlier(true)
        setSpan(around(all, folded))
        return
      }
      go({ to: "panel", panel: { kind: "thread", seq: bySeq.get(seq)?.inThread ?? seq } })
    },
    [go, content]
  )

  const editingSeq = useEditingIn(channel.code)
  useEffect(() => {
    if (editingSeq === null) return
    unstick()
    let frame = 0
    let left = 30
    const show = () => {
      const box = content.current?.querySelector<HTMLElement>(`[data-seq="${editingSeq}"] .msg-edit`)
      if (!box) {
        if (left-- > 0) frame = requestAnimationFrame(show)
        return
      }
      box.scrollIntoView({ block: "nearest" })
      remember()
    }
    frame = requestAnimationFrame(show)
    return () => cancelAnimationFrame(frame)
  }, [editingSeq, content, unstick, remember])

  useEffect(() => {
    if (!jump || (jump.m.system && !jump.m.leftOut)) return
    const seq = jump.m.seq
    const { list, all } = known.current
    const folded = !list.some((m) => m.seq === seq)
    const pool = folded ? all : list
    const at = pool.findIndex((m) => m.seq === seq)
    if (at < 0) {
      onQuote(seq)
      return
    }
    unstick()
    if (folded) setEarlier(true)
    if (!content.current?.querySelector(`[data-seq="${seq}"]`)) setSpan(around(pool, at))
    let frame = 0
    let left = 30
    const land = () => {
      const row = content.current?.querySelector<HTMLElement>(`[data-seq="${seq}"]`)
      if (!row) {
        if (left-- > 0) frame = requestAnimationFrame(land)
        return
      }
      const first = paintHits(row.querySelector<HTMLElement>(".msg-text") ?? row, jump.terms)
      const target = first?.startContainer.parentElement ?? row
      target.scrollIntoView({ block: "center", behavior: "auto" })
      remember()
      flash(row)
    }
    frame = requestAnimationFrame(land)
    return () => {
      cancelAnimationFrame(frame)
      paintHits(null, [])
    }
  }, [jump, onQuote, content, unstick, remember])

  return (
    <div className={doc ? "feed-wrap is-doc" : "feed-wrap"}>
      {where.kind !== "theirs" && <QuotePick root={content} onQuote={quote} />}
      <Updates channel={channel} runs={runs} here={where.kind === "task" ? where.task : null} jump={jump?.m.seq ?? null} />
      <div className="feed" ref={scroller} onScroll={onScroll}>
        <div className="feed-list" ref={content}>
          {list.length === 0 && !compact ? (
            channel.loading ? (
              channel.connection === "live" && <Loading />
            ) : (
              <Start channel={channel} where={where} />
            )
          ) : (
            list.slice(start, end).map((m, k) => {
              const i = start + k
              const run = leftOutRun(list, i)
              const open = !m.leftOut || shownRuns.has(runFirst(list, i))
              const talk = chatter.get(m.seq)
              const talkShown = talkOpen(talk)
              const prev = list[i - 1]
              const afterFold = !!prev && !talkOpen(chatter.get(prev.seq))
              return (
                <Fragment key={m.seq}>
                  {(i === 0 || !sameDay(list[i - 1]?.at ?? 0, m.at)) && (
                    <p className="day">
                      <span>{day(m.at)}</span>
                    </p>
                  )}
                  {m.membersOnly && !list[i - 1]?.membersOnly && where.kind === "dm" && (
                    <p className="day is-members" role="separator">
                      <span>From here on, new messages are sent to you and {nickname(channel, where.with)} alone</span>
                    </p>
                  )}
                  {m.seq === mark && (
                    <p className="feed-new" role="separator">
                      <span>New</span>
                    </p>
                  )}
                  {compact && m.seq === foldAt && (
                    <Suspense fallback={null}>
                      <HistoryFold channel={channel} compact={compact} earlier={earlier} onToggle={toggleEarlier} names={names} tasks={tasks} onQuote={onQuote} />
                    </Suspense>
                  )}
                  {run && <Fold run={run} open={open} onToggle={() => toggleRun(m.seq)} />}
                  {talk && talk.first === m.seq && <ChatterFold channel={channel} run={talk.run} open={talkShown} onToggle={() => toggleChatter(talk.first)} />}
                  {m.seq === proposalAt && proposal ? (
                    <Suspense fallback={null}>
                      <ProposalCard channel={channel} proposal={proposal} names={names} tasks={tasks} onQuote={onQuote} />
                    </Suspense>
                  ) : (
                    open &&
                    talkShown && (
                      <MessageRow
                        channel={channel}
                        m={m}
                        compact={m.seq !== mark && m.seq !== foldAt && !afterFold && compactAt(list, i)}
                        names={names}
                        tasks={tasks}
                        quote={quoteOf(list, i, bySeq)}
                        onQuote={onQuote}
                      />
                    )
                  )}
                </Fragment>
              )
            })
          )}
          {compact && foldAt === undefined && (
            <Suspense fallback={null}>
              <HistoryFold channel={channel} compact={compact} earlier={earlier} onToggle={toggleEarlier} names={names} tasks={tasks} onQuote={onQuote} />
            </Suspense>
          )}
          {proposal && proposalAt === undefined && end === list.length && (
            <Suspense fallback={null}>
              <ProposalCard channel={channel} proposal={proposal} names={names} tasks={tasks} onQuote={onQuote} />
            </Suspense>
          )}
          {doc && following && !channel.loading && (
            <Suspense fallback={null}>
              <LiveThreadDoc channel={channel} where={where} thread={doc} hold={hold} />
            </Suspense>
          )}
          {working.length > 0 && !channel.loading && <Working people={working} />}
        </div>
      </div>
      {(fresh > 0 || far) && (
        <button type="button" className="feed-jump" onClick={toLatest}>
          {fresh > 0 ? `${fresh} new ${fresh === 1 ? "message" : "messages"}` : "Jump to latest"}
          <span aria-hidden="true"> ↓</span>
        </button>
      )}
    </div>
  )
}

function ChatterFold({ channel, run, open, onToggle }: { channel: Channel; run: readonly Message[]; open: boolean; onToggle: () => void }) {
  return (
    <p className="sys" data-seq={run[0]?.seq}>
      <span className="sys-line" />
      <span className="sys-text">{chatterLine(run, (n) => nickname(channel, n))}</span>
      <button type="button" className="fold-act" aria-expanded={open} onClick={onToggle}>
        {open ? "Hide" : "Show"}
      </button>
    </p>
  )
}

function Fold({ run, open, onToggle }: { run: readonly Message[]; open: boolean; onToggle: () => void }) {
  return (
    <p className="fold" data-seq={run[0]?.seq}>
      <span className="sys-line" />
      <span>{foldText(run)}</span>
      <button type="button" className="fold-act" aria-expanded={open} onClick={onToggle}>
        {open ? "Hide" : run.length === 1 ? "Show it" : "Show them"}
      </button>
    </p>
  )
}

export function ReadOnly({ channel, between: names }: { channel: Channel; between: readonly [string, string] }) {
  return (
    <div className="compose">
      <p className="compose-note">Only {between(channel, names)} write here.</p>
    </div>
  )
}

function HoldBanner({ channel, hold }: { channel: Channel; hold: NonNullable<Channel["hold"]> }) {
  const { app } = useApp()
  const owner = channel.people.find((p) => p.owner && !p.you)
  const until = channel.youOwn ? "until you resume them" : `until ${owner ? shown(owner) : "the owner"} resumes them`
  const note = hold.note?.replace(/[.\s]+$/, "")
  return (
    <div className="banner" role="status" title={`They read but don't act ${until}.`}>
      <p className="banner-text">
        <b>{channel.youOwn || !owner ? "Agents paused" : `${shown(owner)} paused the agents`}</b>
        {note && <span className="dim">{note}</span>}
      </p>
      {channel.youOwn && (
        <button type="button" className="btn is-small" onClick={() => app.actions.setHold(channel.code, false)}>
          Resume
        </button>
      )}
    </div>
  )
}

function Start({ channel, where }: { channel: Channel; where: Where }) {
  if (where.kind === "room" && !channel.people.some((p) => p.kind === "agent"))
    return (
      <div className="feed-start">
        <Suspense fallback={null}>
          <AddAgentCard channel={channel} />
        </Suspense>
      </div>
    )
  return (
    <div className="feed-start">
      <p className="feed-start-title">
        {where.kind === "room"
          ? `This is the start of #${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}.`
          : where.kind === "dm"
            ? dmInRoom(channel, where.with)
              ? `These are sent to you and ${nickname(channel, where.with)} alone. Anyone in the channel can still open them.`
              : `Everyone in the channel can read your messages with ${nickname(channel, where.with)}.`
            : where.kind === "theirs"
              ? `This is the start of ${between(channel, where.between)}.`
              : "Nothing here yet."}
      </p>
    </div>
  )
}

function Working({ people }: { people: Person[] }) {
  const { go } = useApp()
  const named = people.slice(0, 3)
  const more = people.length - named.length
  return (
    <p className="working" aria-live="polite">
      <span className="working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="working-text">
        {named.map((p, i) => (
          <Fragment key={p.name}>
            {i > 0 && ", "}
            <button type="button" className="working-name" onClick={() => go({ to: "modal", modal: { kind: "person", name: p.name } })}>
              {shown(p)}
            </button>{" "}
            {liveOf(p)?.text}
          </Fragment>
        ))}
        {more > 0 && `, ${more} more working`}
      </span>
    </p>
  )
}
