import { Fragment, useLayoutEffect, useMemo, useRef } from "react"

import { Composer } from "~/chat/composer"
import { MessageRow } from "~/chat/message"
import { day, sameDay } from "~/kit/time"
import type { Channel, Message, Where } from "~/model"
import { sameWhere, useApp } from "~/nav"

const GROUP_MS = 5 * 60_000

export const namesOf = (channel: Channel): Set<string> => new Set(channel.people.map((p) => p.name.toLowerCase()))

export function compactAt(list: Message[], i: number): boolean {
  const m = list[i]
  const prev = list[i - 1]
  if (!m || !prev) return false
  return prev.from === m.from && !prev.system && !m.system && !prev.ask && m.at - prev.at < GROUP_MS && sameDay(prev.at, m.at) && !m.replyTo
}

export function Conversation({ channel, search }: { channel: Channel; search: string }) {
  const { nav } = useApp()
  const where: Where = nav.where
  const q = search.trim().toLowerCase()
  const list = useMemo(
    () => channel.messages.filter((m) => sameWhere(m.where, where) && m.inThread === undefined && (!q || m.text.toLowerCase().includes(q) || m.from.includes(q))),
    [channel.messages, where, q]
  )
  const names = useMemo(() => namesOf(channel), [channel])
  const typing = channel.people.filter((p) => p.typing && !p.you && where.kind === "room")
  const scroller = useRef<HTMLDivElement>(null)
  const last = list.at(-1)?.seq
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last, where])

  const placeName = where.kind === "room" ? `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}` : where.kind === "dm" ? where.with : `T${where.task}`

  return (
    <>
      {channel.hold && (
        <p className="banner">
          Agents are paused{channel.hold.note ? `: ${channel.hold.note.replace(/[.\s]+$/, "")}` : ""}. <span className="dim">They read but don't act until you resume.</span>
        </p>
      )}
      <div className="feed" ref={scroller}>
        {list.length === 0 ? (
          <Start channel={channel} where={where} searching={!!q} />
        ) : (
          <div className="feed-list">
            {list.map((m, i) => (
              <Fragment key={m.seq}>
                {(i === 0 || !sameDay(list[i - 1]?.at ?? 0, m.at)) && (
                  <p className="day">
                    <span>{day(m.at)}</span>
                  </p>
                )}
                <MessageRow channel={channel} m={m} compact={compactAt(list, i)} names={names} />
              </Fragment>
            ))}
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
        )}
      </div>
      <Composer channel={channel} where={where} placeholder={where.kind === "dm" ? `Message ${placeName} privately` : `Message ${placeName}`} suggest={list.length === 0 && !q} />
    </>
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
