import { Fragment, lazy, startTransition, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Composer } from "~/chat/composer"
import { EventRun } from "~/chat/events"
import { continuesRun, eventRun } from "~/chat/fold-events"
import { foldText, leftOutRun, runFirst, withLeftOut } from "~/chat/left-out"
import { chatterLine, chatterRuns, type ChatterRun } from "~/chat/chatter"
import { MessageRow } from "~/chat/message"
import { linked } from "~/chat/linked"
import { flash, jumpTo, ReplyContext, type Replying } from "~/chat/reply"
import type { Jump } from "~/chat/search-box"
import { paintHits } from "~/chat/search-paint"
import { Avatar, cx, Loading } from "~/kit/bits"
import { land } from "~/kit/glide"
import { later } from "~/kit/later"
import { day, sameDay } from "~/kit/time"
import { memberOf, type Channel, type Message, type Person, type Where } from "~/model"
import { liveOf, workingIn } from "~/doing"
import { sameWhere, useApp, whereKey } from "~/nav"
import { between, nickname, shown } from "~/names"
import { dmBlocker, sealable } from "~/live/dm"

const HistoryFold = later(() => import("~/chat/compact").then((m) => m.HistoryFold))
const ProposalCard = later(() => import("~/chat/compact").then((m) => m.ProposalCard))
const AddAgentCard = later(() => import("~/panels/add-agent").then((m) => m.AddAgentCard))

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
  top: number
  at: number
}

function anchorIn(box: HTMLElement, list: HTMLElement): Anchor | null {
  const rows = list.children
  const top = box.getBoundingClientRect().top
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((rows[mid]?.getBoundingClientRect().bottom ?? 0) > top) hi = mid
    else lo = mid + 1
  }
  const el = rows[lo]
  return el ? { el, top: el.getBoundingClientRect().top - top, at: box.scrollTop } : null
}

export function useStick(following = true) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const live = useRef(following)
  useLayoutEffect(() => {
    live.current = following
  }, [following])
  const anchor = useRef<Anchor | null>(null)
  const height = useRef(0)

  const settle = useCallback(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    height.current = list.offsetHeight
    if (stuck.current) {
      box.scrollTop = box.scrollHeight
      return
    }
    const a = anchor.current
    if (!a?.el.isConnected) return
    const top = box.getBoundingClientRect().top
    const shift = a.el.getBoundingClientRect().top - top - (a.top - (box.scrollTop - a.at))
    if (Math.abs(shift) > 0.5) box.scrollTop += shift
    anchor.current = { el: a.el, top: a.el.getBoundingClientRect().top - top, at: box.scrollTop }
  }, [])

  const remember = useCallback(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    if (height.current && list.offsetHeight !== height.current) settle()
    stuck.current = live.current && box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM
    anchor.current = stuck.current ? null : anchorIn(box, list)
    height.current = list.offsetHeight
  }, [settle])

  useLayoutEffect(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    const watch = new ResizeObserver(settle)
    watch.observe(list)
    watch.observe(box)
    return () => watch.disconnect()
  }, [settle])

  const toBottom = useCallback((smooth: boolean) => {
    const box = scroller.current
    if (!box) return
    stuck.current = true
    anchor.current = null
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

  return { scroller, content, stuck, live, remember, settle, toBottom, toOffset, unstick }
}

const SinceModal = lazy(() => import("~/chat/since-modal"))

const unread = (channel: Channel): boolean => channel.rooms.some((r) => r.unread > 0 && !r.muted) || channel.directs.some((d) => d.unread > 0)

function Since({ channel }: { channel: Channel }) {
  const [show] = useState(() => unread(channel))
  if (!show) return null
  return (
    <Suspense fallback={null}>
      <SinceModal channel={channel} />
    </Suspense>
  )
}

export function Conversation({ channel, jump }: { channel: Channel; jump: Jump | null }) {
  const { nav } = useApp()
  const where: Where = nav.where
  const key = `${channel.code}:${whereKey(where)}`
  const [reply, setReply] = useState<{ key: string; to: Message } | null>(null)
  const replying = useMemo((): Replying => ({ to: reply?.key === key ? reply.to : null, set: (to) => setReply(to ? { key, to } : null) }), [reply, key])
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
      <Since key={channel.code} channel={channel} />
      <Feed key={key} channel={channel} where={where} jump={jump && sameWhere(jump.m.where, where) ? jump : null} />
      {where.kind === "dm" && <DmNote channel={channel} other={where.with} />}
      {where.kind === "theirs" ? <ReadOnly channel={channel} between={where.between} /> : <Composer channel={channel} where={where} placeholder={`Message ${placeName}`} />}
    </ReplyContext.Provider>
  )
}

function Feed({ channel, where, jump }: { channel: Channel; where: Where; jump: Jump | null }) {
  const { go } = useApp()
  const specAsks = useMemo(() => new Set((channel.specs ?? []).map((s) => s.ask)), [channel.specs])
  const all = useMemo(
    () =>
      withLeftOut(
        channel.messages.filter((m) => sameWhere(m.where, where) && (where.kind !== "room" || m.inThread === undefined || !specAsks.has(m.inThread))),
        (channel.leftOut ?? []).filter((m) => sameWhere(m.where, where))
      ),
    [channel.messages, channel.leftOut, where, specAsks]
  )
  const general = where.kind === "room" && where.room === "general"
  const compact = general ? channel.compact : undefined
  const proposal = general ? channel.proposal : undefined
  const through = compact?.through
  const [earlier, setEarlier] = useState(false)
  const list = useMemo(() => (through === undefined || earlier ? all : all.filter((m) => m.seq > through)), [all, through, earlier])
  const foldAt = through === undefined ? undefined : list.find((m) => m.seq > through)?.seq
  const proposalAt = proposal && list.some((m) => m.seq === proposal.seq) ? proposal.seq : undefined
  const [shownRuns, setShownRuns] = useState<ReadonlySet<number>>(() => new Set())
  const toggleRun = useCallback((first: number) => setShownRuns((was) => (was.has(first) ? new Set([...was].filter((s) => s !== first)) : new Set([...was, first]))), [])
  const chatter = useMemo(() => (where.kind === "room" ? chatterRuns(channel, list) : new Map<number, ChatterRun>()), [channel, list, where.kind])
  const [shownChatter, setShownChatter] = useState<ReadonlySet<number>>(() => new Set())
  const toggleChatter = useCallback((first: number) => setShownChatter((was) => (was.has(first) ? new Set([...was].filter((s) => s !== first)) : new Set([...was, first]))), [])
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
  const afterProposal = proposalAt === undefined ? undefined : list[list.findIndex((m) => m.seq === proposalAt) + 1]?.seq
  const breaks = new Set([mark, foldAt, proposalAt, afterProposal].filter((seq): seq is number => seq !== null && seq !== undefined))

  const [span, setSpan] = useState<Span>(() =>
    mark === null
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
  const { scroller, content, stuck, live, remember, settle, toBottom, toOffset, unstick } = useStick(following)

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
  useLayoutEffect(() => {
    if (opened.current) return
    opened.current = true
    const line = content.current?.querySelector<HTMLElement>(".feed-new")
    if (!line || !unread) return toBottom(false)
    toOffset(line.offsetTop - 12)
    remember()
    if (!stuck.current) queueMicrotask(() => setFresh(unread.count))
  }, [unread, remember, toBottom, toOffset, stuck, content])

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
    if (last.from === channel.you) toBottom(false)
    else if (!stuck.current) setFresh((n) => n + list.filter((m) => m.seq > before && m.from !== channel.you && !m.system && !m.leftOut).length)
    settle()
  }, [last, list, channel.you, toBottom, settle, stuck, live, content])

  const onScroll = () => {
    remember()
    const box = scroller.current
    if (!box) return
    if (stuck.current) setFresh(0)
    const below = box.scrollHeight - box.scrollTop - box.clientHeight
    setFar(!following || below > box.clientHeight * 1.5)
    const at = (i: number) => content.current?.querySelector(`[data-seq="${list[i]?.seq}"]`)?.getBoundingClientRect().top
    const top = box.getBoundingClientRect().top
    const cutBelow = (to: number) => to >= end || (at(to) ?? 0) - top > box.clientHeight * 2
    const cutAbove = (from: number) => from <= start || (at(from) ?? Infinity) - (content.current?.getBoundingClientRect().top ?? top) < below - box.clientHeight
    if (start > 0 && box.scrollTop < box.clientHeight * 3) {
      const from = Math.max(0, start - MORE)
      const to = Math.min(end, from + CAP)
      const next = spanOf(list, from, cutBelow(to) ? to : end)
      startTransition(() => setSpan(next))
    } else if (!following && below < box.clientHeight * 3) {
      const to = Math.min(list.length, end + MORE)
      const from = Math.max(start, to - CAP)
      const next = spanOf(list, cutAbove(from) ? from : start, to)
      startTransition(() => setSpan(next))
    } else if (stuck.current && end - start > TAIL * 2) setSpan({ top: list[end - TAIL]?.seq ?? null, bottom: null })
    else if (end - start > CAP) {
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

  useEffect(() => {
    if (!jump) return
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
    <div className="feed-wrap">
      <div className="feed" ref={scroller} onScroll={onScroll}>
        <div className="feed-list" ref={content}>
          {list.length === 0 && !compact ? (
            channel.loading ? (
              <Loading />
            ) : (
              <Start channel={channel} where={where} />
            )
          ) : (
            list.slice(start, end).map((m, k) => {
              const i = start + k
              if (continuesRun(list, i, start, breaks)) return null
              const events = eventRun(list, i, end, breaks)
              const run = leftOutRun(list, i)
              const open = !m.leftOut || shownRuns.has(runFirst(list, i))
              const talk = chatter.get(m.seq)
              const talkOpen = !talk || shownChatter.has(talk.first) || (!!jump && talk.run.some((x) => x.seq === jump.m.seq))
              if (talk && talk.first !== m.seq && !talkOpen) return null
              return (
                <Fragment key={m.seq}>
                  {(i === 0 || !sameDay(list[i - 1]?.at ?? 0, m.at)) && (
                    <p className="day">
                      <span>{day(m.at)}</span>
                    </p>
                  )}
                  {m.locked && !list[i - 1]?.locked && where.kind === "dm" && (
                    <p className="day" role="separator">
                      <span>From here on, just you and {nickname(channel, where.with)} can read new messages</span>
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
                  {talk && talk.first === m.seq && <ChatterFold channel={channel} run={talk.run} open={talkOpen} onToggle={() => toggleChatter(talk.first)} />}
                  {m.seq === proposalAt && proposal ? (
                    <Suspense fallback={null}>
                      <ProposalCard channel={channel} proposal={proposal} names={names} tasks={tasks} onQuote={onQuote} />
                    </Suspense>
                  ) : events ? (
                    <EventRun channel={channel} run={events} here={where.kind === "task" ? where.task : null} jump={jump?.m.seq ?? null} />
                  ) : (
                    open &&
                    talkOpen && (
                      <MessageRow
                        channel={channel}
                        m={m}
                        compact={m.seq !== mark && m.seq !== foldAt && compactAt(list, i)}
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
          {working.length > 0 && <Working people={working} />}
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
  const who = [...new Set(run.map((m) => m.from))]
  return (
    <div className={cx("chatter", open && "is-open")} data-seq={run[0]?.seq}>
      <span className="chatter-faces" aria-hidden="true">
        {who.slice(0, 4).map((n) => (
          <Avatar key={n} person={memberOf(channel, n)} size="sm" />
        ))}
      </span>
      <span className="chatter-text">{chatterLine(run, (n) => nickname(channel, n))}</span>
      <button type="button" className="fold-act" aria-expanded={open} onClick={onToggle}>
        {open ? "Fold" : "Show"}
      </button>
    </div>
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
      <p className="compose-note">Only {between(channel, names)} write here. You read along.</p>
    </div>
  )
}

function HoldBanner({ channel, hold }: { channel: Channel; hold: NonNullable<Channel["hold"]> }) {
  const { app } = useApp()
  const owner = channel.people.find((p) => p.owner && !p.you)
  const until = channel.youOwn ? "until you resume them" : `until ${owner ? shown(owner) : "the owner"} resumes them`
  return (
    <div className="banner" role="status">
      <p className="banner-text">
        Agents are paused{hold.note ? `: ${hold.note.replace(/[.\s]+$/, "")}` : ""}. <span className="dim">They read but don't act {until}.</span>
      </p>
      {channel.youOwn && (
        <button type="button" className="btn is-small" onClick={() => app.actions.setHold(channel.code, false)}>
          Resume agents
        </button>
      )}
    </div>
  )
}

function Start({ channel, where }: { channel: Channel; where: Where }) {
  const agents = channel.people.filter((p) => p.kind === "agent").length
  return (
    <div className="feed-start">
      <p className="feed-start-title">
        {where.kind === "room"
          ? `This is the start of #${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}.`
          : where.kind === "dm"
            ? sealable(channel, where.with)
              ? `This is the start of your messages with ${nickname(channel, where.with)}. Just you and ${nickname(channel, where.with)} can read them: not the channel, not the relay.`
              : `This is the start of your messages with ${nickname(channel, where.with)}. Everyone in the channel can read them.`
            : where.kind === "theirs"
              ? `This is the start of ${between(channel, where.between)}.`
              : "Nothing here yet."}
      </p>
      {agents === 0 ? (
        <Suspense fallback={null}>
          <AddAgentCard channel={channel} />
        </Suspense>
      ) : (
        <p className="dim">Say what you want done. The lead turns it into tasks.</p>
      )}
    </div>
  )
}

function DmNote({ channel, other }: { channel: Channel; other: string }) {
  const blocker = dmBlocker(channel, other)
  if (!blocker || channel.directs.find((d) => d.with === other)?.locked) return null
  return <p className="dm-note">{`${blocker.charAt(0).toUpperCase()}${blocker.slice(1)} can't open private messages yet, so everyone in the channel can read these.`}</p>
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
            <button type="button" className="working-name" onClick={() => go({ to: "panel", panel: { kind: "person", name: p.name } })}>
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
