import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Composer } from "~/chat/composer"
import { MessageRow } from "~/chat/message"
import { jumpTo, ReplyContext, type Replying } from "~/chat/reply"
import { day, sameDay } from "~/kit/time"
import type { Channel, Message, Where } from "~/model"
import { sameWhere, useApp } from "~/nav"

const GROUP_MS = 5 * 60_000
const NEAR_BOTTOM = 48

export const namesOf = (channel: Channel): Set<string> => new Set(channel.people.map((p) => p.name.toLowerCase()))

export function compactAt(list: Message[], i: number): boolean {
  const m = list[i]
  const prev = list[i - 1]
  if (!m || !prev) return false
  return prev.from === m.from && !prev.system && !m.system && !prev.ask && m.at - prev.at < GROUP_MS && sameDay(prev.at, m.at)
}

export function quoteOf(list: Message[], i: number, bySeq: ReadonlyMap<number, Message>, root?: number): Message | undefined {
  const m = list[i]
  if (!m || m.system) return undefined
  const target = m.replyTo ?? (m.inThread !== root ? m.inThread : undefined)
  if (target === undefined || list[i - 1]?.seq === target) return undefined
  return bySeq.get(target)
}

const whereKey = (w: Where): string => (w.kind === "room" ? `r:${w.room}` : w.kind === "dm" ? `d:${w.with}` : `t:${w.task}`)

export function useStick() {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const anchor = useRef<{ el: Element; top: number } | null>(null)

  const remember = useCallback(() => {
    const box = scroller.current
    const list = content.current
    if (!box || !list) return
    stuck.current = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM
    if (stuck.current) {
      anchor.current = null
      return
    }
    const top = box.getBoundingClientRect().top
    const rows = list.querySelectorAll("[data-seq]")
    let lo = 0
    let hi = rows.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((rows[mid]?.getBoundingClientRect().bottom ?? 0) > top) hi = mid
      else lo = mid + 1
    }
    const el = rows[lo]
    anchor.current = el ? { el, top: el.getBoundingClientRect().top - top } : null
  }, [])

  const settle = useCallback(() => {
    const box = scroller.current
    if (!box) return
    if (stuck.current) {
      box.scrollTop = box.scrollHeight
      return
    }
    const a = anchor.current
    if (!a?.el.isConnected) return
    const now = a.el.getBoundingClientRect().top - box.getBoundingClientRect().top
    if (Math.abs(now - a.top) > 0.5) box.scrollTop += now - a.top
  }, [])

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

  return { scroller, content, stuck, remember, settle, toBottom, toOffset }
}

export function Conversation({ channel, search }: { channel: Channel; search: string }) {
  const { nav } = useApp()
  const where: Where = nav.where
  const key = `${channel.code}:${whereKey(where)}`
  const [reply, setReply] = useState<{ key: string; to: Message } | null>(null)
  const replying = useMemo((): Replying => ({ to: reply?.key === key ? reply.to : null, set: (to) => setReply(to ? { key, to } : null) }), [reply, key])
  const placeName = where.kind === "room" ? `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}` : where.kind === "dm" ? where.with : `T${where.task}`

  return (
    <ReplyContext.Provider value={replying}>
      {channel.hold && (
        <p className="banner">
          Agents are paused{channel.hold.note ? `: ${channel.hold.note.replace(/[.\s]+$/, "")}` : ""}. <span className="dim">They read but don't act until you resume.</span>
        </p>
      )}
      <Feed key={key} channel={channel} where={where} search={search} />
      <Composer channel={channel} where={where} placeholder={where.kind === "dm" ? `Message ${placeName} privately` : `Message ${placeName}`} />
    </ReplyContext.Provider>
  )
}

function Feed({ channel, where, search }: { channel: Channel; where: Where; search: string }) {
  const { go } = useApp()
  const q = search.trim().toLowerCase()
  const list = useMemo(() => channel.messages.filter((m) => sameWhere(m.where, where) && (!q || m.text.toLowerCase().includes(q) || m.from.includes(q))), [channel.messages, where, q])
  const bySeq = useMemo(() => new Map(channel.messages.map((m) => [m.seq, m])), [channel.messages])
  const names = useMemo(() => namesOf(channel), [channel])
  const typing = channel.people.filter((p) => p.typing && !p.you && where.kind === "room")
  const { scroller, content, stuck, remember, settle, toBottom, toOffset } = useStick()
  const [fresh, setFresh] = useState(0)
  const [far, setFar] = useState(false)

  const [unread] = useState(() => {
    const seen = where.kind === "room" ? channel.rooms.find((r) => r.id === where.room)?.seen : where.kind === "dm" ? channel.directs.find((d) => d.with === where.with)?.seen : undefined
    if (seen === undefined || q) return null
    const fresh = list.filter((m) => m.seq > seen && m.from !== channel.you && !m.system)
    const first = fresh[0]
    return first && first !== list[0] ? { seq: first.seq, count: fresh.length } : null
  })
  const mark = unread?.seq ?? null

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
    if (last.from === channel.you) toBottom(false)
    else if (!stuck.current) setFresh((n) => n + list.filter((m) => m.seq > before && m.from !== channel.you && !m.system).length)
    settle()
  }, [last, list, channel.you, toBottom, settle, stuck])

  const onScroll = () => {
    remember()
    const box = scroller.current
    if (!box) return
    if (stuck.current) setFresh(0)
    setFar(box.scrollHeight - box.scrollTop - box.clientHeight > box.clientHeight * 1.5)
  }

  const onQuote = useCallback(
    (seq: number) => {
      if (jumpTo(content.current, seq)) return
      const target = bySeq.get(seq)
      go({ to: "panel", panel: { kind: "thread", seq: target?.inThread ?? seq } })
    },
    [bySeq, go]
  )

  return (
    <div className="feed-wrap">
      <div className="feed" ref={scroller} onScroll={onScroll}>
        <div className="feed-list" ref={content}>
          {list.length === 0 ? (
            <Start channel={channel} where={where} searching={!!q} />
          ) : (
            list.map((m, i) => (
              <Fragment key={m.seq}>
                {(i === 0 || !sameDay(list[i - 1]?.at ?? 0, m.at)) && (
                  <p className="day">
                    <span>{day(m.at)}</span>
                  </p>
                )}
                {m.seq === mark && (
                  <p className="feed-new" role="separator">
                    <span>New</span>
                  </p>
                )}
                <MessageRow channel={channel} m={m} compact={m.seq !== mark && compactAt(list, i)} names={names} quote={quoteOf(list, i, bySeq)} onQuote={onQuote} />
              </Fragment>
            ))
          )}
          {typing.length > 0 && (
            <p className="typing">
              <span className="typing-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {typing.map((p) => p.name).join(", ")} {typing.length === 1 ? "is" : "are"} typing
            </p>
          )}
        </div>
      </div>
      {(fresh > 0 || far) && (
        <button
          type="button"
          className="feed-jump"
          onClick={() => {
            setFresh(0)
            setFar(false)
            toBottom(true)
          }}
        >
          {fresh > 0 ? `${fresh} new ${fresh === 1 ? "message" : "messages"}` : "Jump to latest"}
          <span aria-hidden="true"> ↓</span>
        </button>
      )}
    </div>
  )
}

function Start({ channel, where, searching }: { channel: Channel; where: Where; searching: boolean }) {
  if (searching) return <p className="feed-empty">Nothing matches.</p>
  const agents = channel.people.filter((p) => p.kind === "agent").length
  return (
    <div className="feed-start">
      <p className="feed-start-title">
        {where.kind === "room"
          ? `This is the start of #${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}.`
          : where.kind === "dm"
            ? `Only you and ${where.with} read this.`
            : "Nothing here yet."}
      </p>
      <p className="dim">{agents === 0 ? "No agents here yet. Add one from the sidebar, then give it something to do." : "Say what you want done. The lead turns it into tasks."}</p>
    </div>
  )
}
