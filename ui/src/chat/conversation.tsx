import { Fragment, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { Composer } from "~/chat/composer"
import { docOf } from "~/chat/doc-of"
import { EditHere } from "~/chat/editing"
import { showActivity } from "~/chat/activity"
import { splitUpdates } from "~/chat/split-updates"
import { foldText, leftOutRun, runFirst, withLeftOut } from "~/chat/left-out"
import { docFeeds, EMPTY_FEED, withDocMedia, withLines } from "~/chat/doc/finished"
import { inFeed, postedBlocks } from "~/chat/doc/posted"
import { chatterLine, chatterRuns, type ChatterRun } from "~/chat/chatter"
import { MessageRow } from "~/chat/message"
import { useStick } from "~/chat/stick"
import { linked } from "~/chat/linked"
import { flash, jumpTo, ReplyContext, useReplying, type Replying } from "~/chat/reply"
import type { Jump } from "~/chat/search-box"
import { paintHits } from "~/chat/search-paint"
import { t } from "~/i18n/i18n"
import { Loading } from "~/kit/bits"
import { land } from "~/kit/glide"
import { later } from "~/kit/later"
import { day, sameDay } from "~/kit/time"
import { inSpecThread, type Channel, type Message, type Person, type Where } from "~/model"
import { liveOf, workingIn } from "~/doing"
import { sameWhere, useGo, useActions, useNav, useChannelHere } from "~/nav"
import { keepSpot, spotAt, spotKey, type Spot } from "~/places"
import { between, nickname, shown } from "~/names"
import { wordsRaw } from "~/words"
import { openMessage } from "~/live/open-message"
import { markOnce } from "@kiwi/channel/marks.ts"
import { personGo } from "~/person-go"

const HistoryFold = later(() => import("~/chat/compact").then((m) => m.HistoryFold))
const ProposalCard = later(() => import("~/chat/compact").then((m) => m.ProposalCard))
const LiveThreadDoc = later(() => import("~/chat/doc/editor").then((m) => m.LiveThreadDoc))
const QuotePick = later(() => import("~/chat/quote-pick").then((m) => m.QuotePick))
const HoldBanner = later(() => import("~/chat/feed-notes").then((m) => m.HoldBanner))
const Start = later(() => import("~/chat/feed-notes").then((m) => m.Start))

const GROUP_MS = 5 * 60_000
const TAIL = 100
const MORE = 40
const CAP = 160
const PREFETCH = 120
const HOLD = 240
const DRY_PAGES = 3
const REACH_WAIT_MS = 600

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

function keepFrom(box: HTMLElement, rows: HTMLElement, list: readonly Message[], start: number, wanted: number): number {
  const room = Math.min(box.scrollHeight - box.scrollTop - box.clientHeight, box.scrollTop - box.clientHeight) - 1
  const head = rows.getBoundingClientRect().top
  const at = new Map<number, number>()
  for (let i = start; i <= wanted; i++) {
    const seq = list[i]?.seq
    if (seq !== undefined) at.set(seq, i)
  }
  const shown = rows.querySelectorAll<HTMLElement>(":scope > [data-seq]")
  let low = -1
  let high = shown.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    const row = shown[mid]
    if (row && at.has(Number(row.dataset.seq)) && row.getBoundingClientRect().top - head < room) low = mid
    else high = mid - 1
  }
  return at.get(Number(shown[low]?.dataset.seq)) ?? start
}

function firstUnreadIn(channel: Channel, where: Where): number | undefined {
  const seen = where.kind === "room" ? channel.rooms.find((r) => r.id === where.room)?.seen : where.kind === "dm" ? channel.directs.find((d) => d.with === where.with)?.seen : undefined
  if (seen === undefined) return undefined
  return channel.messages.find((m) => m.seq > seen && sameWhere(m.where, where) && m.from !== channel.you && !m.system && !m.leftOut && m.inThread === undefined)?.seq
}

function reachFor(channel: Channel, where: Where, spot: Spot | null, jumping: boolean): number | null {
  const since = channel.since
  if (since === undefined || jumping || channel.loading) return null
  if (spot) return spot.seq < since ? spot.seq : null
  const unread = firstUnreadIn(channel, where)
  return unread !== undefined && unread < since ? unread : null
}

export function Conversation({ channel, jump }: { channel: Channel; jump: Jump | null }) {
  const nav = useNav()
  const actions = useActions()
  const where: Where = nav.where
  const key = spotKey(channel.code, where)
  const spot = nav.restore !== undefined ? nav.restore : spotAt(key)
  const here = jump && sameWhere(jump.m.where, where) ? jump : null
  const target = reachFor(channel, where, spot, !!here)
  const visit = `${key}\n${nav.visit}`
  const [reached, setReached] = useState<string | null>(null)
  const earlierTo = actions.earlierTo
  const code = channel.code
  useEffect(() => {
    if (target === null) return
    let live = true
    const done = () => {
      if (live) setReached(visit)
    }
    const late = window.setTimeout(done, REACH_WAIT_MS)
    void earlierTo(code, target).then(done)
    return () => {
      live = false
      window.clearTimeout(late)
    }
  }, [target, visit, code, earlierTo])
  const waiting = target !== null && reached !== visit
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
      <EditHere.Provider value="main">
        {channel.hold && (
          <Suspense fallback={null}>
            <HoldBanner channel={channel} hold={channel.hold} />
          </Suspense>
        )}
        {waiting ? (
          <div className="feed-wrap">
            <div className="feed" />
          </div>
        ) : (
          <Feed key={`${key}\n${nav.visit}\n${channel.loading ? "loading" : "ready"}`} channel={channel} where={where} spot={spot} jump={here} doc={doc} />
        )}
        {where.kind === "theirs" ? (
          <ReadOnly channel={channel} between={where.between} />
        ) : (
          <Composer channel={channel} where={where} placeholder={t("chat.conversation.message.place", { place: placeName })} doc={doc} />
        )}
      </EditHere.Provider>
    </ReplyContext.Provider>
  )
}

function Feed({ channel, where, spot, jump, doc }: { channel: Channel; where: Where; spot: Spot | null; jump: Jump | null; doc: string | null }) {
  const actions = useActions()
  const since = channel.since
  const specAsks = useMemo(() => new Set((channel.specs ?? []).map((s) => s.ask)), [channel.specs])
  const feeds = useSyncExternalStore(docFeeds.subscribe, docFeeds.get)
  const raw = useMemo(() => {
    const fromDoc = doc ? (feeds.get(`${channel.code}\n${doc}`) ?? EMPTY_FEED) : EMPTY_FEED
    const feed = withLeftOut(
      channel.messages
        .filter((m) => (since === undefined || m.seq < 0 || m.seq >= since) && sameWhere(m.where, where) && inFeed(m, !!doc) && (where.kind !== "room" || !inSpecThread(m, specAsks)))
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
  }, [channel.messages, channel.leftOut, channel.code, where, specAsks, doc, feeds, since])
  const olderHere = useMemo(
    () => since !== undefined && channel.messages.some((m) => m.seq > 0 && m.seq < since && sameWhere(m.where, where) && inFeed(m, !!doc)),
    [channel.messages, since, where, doc]
  )
  const { talk: all, runs } = useMemo(() => splitUpdates(raw), [raw])
  const task = where.kind === "task" ? where.task : null
  const logged = jump && runs.some((r) => r.some((m) => m.seq === jump.m.seq)) ? jump.m.seq : null
  useLayoutEffect(() => showActivity(runs.length ? { runs, here: task, target: logged } : null), [runs, task, logged])
  useLayoutEffect(() => () => showActivity(null), [])
  const anyRow = raw.length > 0
  useEffect(() => {
    if (!anyRow) return
    const frame = requestAnimationFrame(() => markOnce("kiwi:first-message"))
    return () => cancelAnimationFrame(frame)
  }, [anyRow])
  const general = where.kind === "room" && where.room === "general"
  const compact = general ? channel.compact : undefined
  const proposal = general ? channel.proposal : undefined
  const through = compact?.through
  const [earlier, setEarlier] = useState(false)
  const unfolded = useMemo(() => (through === undefined || earlier ? all : all.filter((m) => m.seq > through)), [all, through, earlier])
  const chatter = useMemo(() => (where.kind === "room" ? chatterRuns(channel, unfolded) : new Map<number, ChatterRun>()), [channel, unfolded, where.kind])
  const [shownChatter, setShownChatter] = useState<ReadonlySet<number>>(() => new Set())
  const toggleChatter = useCallback(
    (run: ChatterRun) =>
      setShownChatter((was) => {
        const seqs = new Set(run.run.map((m) => m.seq))
        return [...was].some((s) => seqs.has(s)) ? new Set([...was].filter((s) => !seqs.has(s))) : new Set([...was, run.first])
      }),
    []
  )
  const openTalk = useMemo(() => new Set([...new Set(chatter.values())].filter((r) => r.run.some((m) => shownChatter.has(m.seq))).map((r) => r.first)), [chatter, shownChatter])
  const jumpSeq = jump?.m.seq
  const talkOpen = useCallback((r: ChatterRun | undefined) => !r || openTalk.has(r.first) || (jumpSeq !== undefined && r.run.some((x) => x.seq === jumpSeq)), [openTalk, jumpSeq])
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
  const { scroller, content, spacer, stuck, live, remember, settle, toBottom, toOffset, toRow, unstick, hold } = useStick(following, !!doc)
  const shownFrom = list[start]?.seq
  const shownTo = list[end - 1]?.seq
  const edges = useRef({ from: shownFrom, to: shownTo })
  const dropped = useRef(false)
  useLayoutEffect(() => {
    const was = edges.current
    edges.current = { from: shownFrom, to: shownTo }
    if (dropped.current) {
      dropped.current = false
      settle()
      return
    }
    const box = scroller.current
    const rows = content.current
    if (!box || !rows || following || end - start <= CAP) return
    if (shownFrom !== was.from || shownTo === undefined || was.to === undefined || shownTo <= was.to) return
    const from = keepFrom(box, rows, list, start, end - CAP)
    if (from === start) return
    dropped.current = true
    setSpan(spanOf(list, from, end))
  }, [shownFrom, shownTo, following, start, end, list, settle, scroller, content])
  const code = channel.code
  const holdEarlier = actions.holdEarlier
  const earlierPage = actions.earlier
  const holdFrom = list.length ? (list[Math.max(0, start - HOLD)]?.seq ?? null) : olderHere ? (since ?? null) : null
  useEffect(() => holdEarlier(code, "feed", holdFrom), [code, holdFrom, holdEarlier])
  useEffect(() => () => holdEarlier(code, "feed", null), [code, holdEarlier])
  const paging = useRef({ busy: false, done: false, dry: 0, length: -1 })
  const [paged, setPaged] = useState(0)
  useEffect(() => {
    const p = paging.current
    if (p.busy || p.done || start >= PREFETCH || (!list.length && !olderHere)) return
    p.dry = p.length === list.length ? p.dry + 1 : 0
    p.length = list.length
    if (!olderHere && p.dry >= DRY_PAGES) return
    p.busy = true
    void earlierPage(code).then((more) => {
      p.busy = false
      if (!more) p.done = true
      setPaged((n) => n + 1)
    })
  }, [code, start, list.length, olderHere, since, paged, earlierPage])
  const replying = useReplying()
  const quote = useCallback(
    (seq: number, excerpt: string) => {
      const m = list.find((x) => x.seq === seq)
      if (!m) return
      replying?.set(m, excerpt)
    },
    [list, replying]
  )

  useEffect(() => {
    const near = [...list.slice(Math.max(0, start - MORE), start), ...list.slice(end, end + MORE)]
    const texts = near.flatMap((m) => (wordsRaw(m.text) && !m.system ? [{ text: wordsRaw(m.text), seq: m.seq }] : []))
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
      toRow(row, back.offset)
      if (!stuck.current && unread) queueMicrotask(() => setFresh(unread.count))
      return
    }
    const line = content.current?.querySelector<HTMLElement>(".feed-new")
    if (!line || !unread) {
      if (!jump) holdEarlier(code, "to", null)
      return toBottom(false)
    }
    toOffset(line.offsetTop - 12)
    remember()
    if (!stuck.current) queueMicrotask(() => setFresh(unread.count))
  }, [back, list, unread, remember, toBottom, toOffset, toRow, stuck, content, scroller, jump, code, holdEarlier])

  const last = list.at(-1)
  const lastSeq = useRef(last?.seq ?? 0)
  useLayoutEffect(() => {
    const before = lastSeq.current
    lastSeq.current = last?.seq ?? 0
    if (!last || last.seq === before) {
      if (doc) settle()
      return
    }
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
    if (stuck.current && following) holdEarlier(code, "to", null)
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

  const scrolled = useRef(onScroll)
  useLayoutEffect(() => {
    scrolled.current = onScroll
  })
  const top = list[0]?.seq
  useEffect(() => {
    const box = scroller.current
    if (box && top !== undefined && !stuck.current && box.scrollTop < box.clientHeight * 3) scrolled.current()
  }, [top, scroller, stuck])

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

  const known = useRef({ list, all })
  const wanted = useRef<number | null>(null)
  useLayoutEffect(() => {
    known.current = { list, all }
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
      if (specAsks.has(seq)) return openMessage(channel.code, seq)
      if (jumpTo(content.current, seq)) return
      const { list, all } = known.current
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
      openMessage(channel.code, seq)
    },
    [content, channel.code, specAsks]
  )

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
      {where.kind !== "theirs" && (
        <Suspense fallback={null}>
          <QuotePick root={content} onQuote={quote} />
        </Suspense>
      )}
      <div className="feed" ref={scroller} onScroll={onScroll}>
        <div className="feed-list" ref={content}>
          {list.length === 0 && !compact
            ? channel.loading
              ? channel.connection === "live" && <Loading />
              : !olderHere && (
                  <Suspense fallback={null}>
                    <Start channel={channel} where={where} />
                  </Suspense>
                )
            : list.slice(start, end).map((m, k) => {
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
                        <span>{t("chat.conversation.members.only", { name: nickname(channel, where.with) })}</span>
                      </p>
                    )}
                    {m.seq === mark && (
                      <p className="feed-new" role="separator">
                        <span>{t("chat.conversation.new")}</span>
                      </p>
                    )}
                    {compact && m.seq === foldAt && (
                      <Suspense fallback={null}>
                        <HistoryFold channel={channel} compact={compact} earlier={earlier} onToggle={toggleEarlier} names={names} tasks={tasks} onQuote={onQuote} />
                      </Suspense>
                    )}
                    {run && <Fold run={run} open={open} onToggle={() => toggleRun(m.seq)} />}
                    {talk && talk.first === m.seq && <ChatterFold channel={channel} run={talk.run} open={talkShown} onToggle={() => toggleChatter(talk)} />}
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
              })}
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
        <div className="feed-room" ref={spacer} aria-hidden="true" />
      </div>
      {(fresh > 0 || far) && (
        <button type="button" className="feed-jump" onClick={toLatest}>
          {fresh > 0 ? t("chat.conversation.new.messages", { count: fresh }) : t("chat.conversation.jump.latest")}
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
        {open ? t("chat.conversation.hide") : t("chat.conversation.show")}
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
        {open ? t("chat.conversation.hide") : run.length === 1 ? t("chat.conversation.show.it") : t("chat.conversation.show.them")}
      </button>
    </p>
  )
}

export function ReadOnly({ channel, between: names }: { channel: Channel; between: readonly [string, string] }) {
  return (
    <div className="compose">
      <p className="compose-note">{t("chat.conversation.only.write", { names: between(channel, names) })}</p>
    </div>
  )
}

function Working({ people }: { people: Person[] }) {
  const go = useGo()
  const open = useChannelHere()
  const named = people.slice(0, 3)
  const more = people.length - named.length
  return (
    <p className="working" data-aside="" aria-live="polite">
      <span className="working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="working-text">
        {named.map((p, i) => (
          <Fragment key={p.name}>
            {i > 0 && ", "}
            <button type="button" className="working-name" onClick={() => go(open ? personGo(open, p.name) : { to: "modal", modal: { kind: "person", name: p.name } })}>
              {shown(p)}
            </button>{" "}
            {liveOf(p)?.text}
          </Fragment>
        ))}
        {more > 0 && t("chat.conversation.more.working", { count: more })}
      </span>
    </p>
  )
}
