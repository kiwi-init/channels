import { ArrowTurnBackwardIcon, Copy01Icon } from "@hugeicons/core-free-icons"
import { memo, useState } from "react"

import { describeEvent } from "@mc/format.ts"
import { ignored, type Color, type Message, type Trust } from "@mc/protocol.ts"
import type { ChannelState, Member } from "@mc/state.ts"
import { markOf } from "@mc/work.ts"
import { excerpt, formatAgo, formatDay, formatFull, formatTime, memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { Mark } from "./feed"
import { Icon } from "./icon"
import { IconButton, Monogram, toast } from "./kit"
import { Markdown } from "./markdown"

/** Anyone who isn't a signed-in person is an agent. */
export const isAgent = (m: Pick<Member, "kind"> | undefined) => m?.kind !== "human"

/** Who wrote a message, as far as the transcript needs to know. */
export type Author = Pick<Member, "name" | "kind" | "display" | "sponsor">

/** A day boundary in the transcript. */
export function DayMark({ ts }: { ts: number }) {
  return (
    <div className="mt-7 mb-2 flex items-center gap-3 select-none">
      <span className="text-meta font-semibold text-ink-2">{formatDay(ts)}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

/** Coordination (tasks, claims, facts): one muted timeline row on the column's left edge, with a small mark. */
export function EventRow({ m, state, now, onOpenTask }: { m: Message; state: ChannelState; now: number; onOpenTask: (id: number) => void }) {
  const taskRef = m.ev && "task" in m.ev ? m.ev.task : m.ev?.op === "task.add" ? m.seq : null
  const forged = ignored(state.trust.get(m.seq))
  return (
    <div id={`m${m.seq}`} className={cx("flex items-start gap-2.5 py-1 pl-1 text-ui text-ink-3", forged && "line-through opacity-50")}>
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <Mark mark={markOf(m)} />
      </span>
      <p className="min-w-0">
        <span className="font-medium text-ink-2">{memberName(state.members.get(m.from), m.from)}</span> {describeEvent(m, state)}
        <span className="text-meta">
          {" · "}
          <time title={formatFull(m.ts)}>{formatAgo(m.rts ?? m.ts, now)}</time>
        </span>
        {taskRef !== null && (
          <button type="button" onClick={() => onOpenTask(taskRef)} className="ml-2 text-meta font-medium text-ink-2 hover:text-ink hover:underline">
            Open task
          </button>
        )}
      </p>
    </div>
  )
}

/** Forged events, and events aimed at this member, stay on their own line. */
export function standsAlone(m: Message, state: ChannelState, me: string): boolean {
  if (ignored(state.trust.get(m.seq))) return true
  const ev = m.ev
  if (!ev) return false
  if ((ev.op === "role.set" || ev.op === "role.refuse") && ev.member === me) return true
  if (ev.op === "task.add" && ev.owner === me) return true
  if (ev.op === "task.update" && ev.owner === me) return true
  return false
}

function englishList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/** A same-day run. Three or more collapse; the latest line stays visible. */
export function EventGroup({ messages, state, now, onOpenTask, highlight }: { messages: Message[]; state: ChannelState; now: number; onOpenTask: (id: number) => void; highlight: number | null }) {
  const [open, setOpen] = useState(false)
  const row = (m: Message) => <EventRow key={m.seq} m={m} state={state} now={now} onOpenTask={onOpenTask} />
  if (messages.length < 3) return <>{messages.map(row)}</>
  const forced = highlight !== null && messages.some((m) => m.seq === highlight)
  const shown = open || forced
  const earlier = messages.slice(0, -1)
  const last = messages[messages.length - 1]!
  const names = englishList([...new Set(earlier.map((m) => memberName(state.members.get(m.from), m.from)))])
  const n = earlier.length
  return (
    <div className="my-1">
      {shown ? messages.map(row) : row(last)}
      <button type="button" aria-expanded={shown} onClick={() => setOpen(!shown)} className="mt-0.5 ml-7 block rounded-row text-meta text-ink-3 hover:text-ink-2">
        {shown ? "Hide earlier updates" : `${names}: ${n} earlier update${n === 1 ? "" : "s"}`}
      </button>
    </div>
  )
}

/** What a message asks of the reader, said in words next to the sender's name. */
function phrase(m: Message, me: string, nameOf: (n: string) => string, repliedTo: Set<string>): { text: string; alert?: boolean } | null {
  // Questions and blockers always say who they're for; plain messages only when the text doesn't already.
  const named = (t: string) => m.body.includes(`@${t}`) || repliedTo.has(t)
  const targets = m.kind === "ask" || m.kind === "blocking" ? (m.to ?? []) : (m.to ?? []).filter((t) => !named(t))
  // "*" is how a broadcast to all is addressed; say it in words.
  const to = targets.map((t) => (t === "*" ? "everyone" : t === me ? "you" : nameOf(t)))
  const list = to.length > 1 ? `${to.slice(0, -1).join(", ")} and ${to[to.length - 1]}` : to[0]
  // An agent handing a decision to people: as loud as a blocker, and named for what it is.
  if (m.esc) return { text: list ? `escalated to ${list}` : "escalated", alert: true }
  switch (m.kind) {
    case "ask":
      return { text: list ? `asked ${list}` : "asked everyone" }
    case "blocking":
      return { text: list ? `is blocked and needs ${list}` : "is blocked", alert: true }
    case "done":
      return { text: "finished" }
    case "status":
      return { text: "posted an update" }
    case "ack":
      return { text: "acknowledged" }
    default:
      return list ? { text: `to ${list}` } : null
  }
}

interface RowProps {
  m: Message
  me: string
  /** Coordinator-only: an agent sent this to a person directly, not through this coordinator. */
  direct?: string
  /** Which room it's in, when the list mixes rooms (the inboxes, search). */
  room?: string
  /** Found by the key that signed the message, so two members sharing a name still read right. */
  author?: Author
  trust?: Trust
  online: boolean
  /** The first message in a run from one sender shows who sent it. */
  head: boolean
  /** The message right above is the one this replies to, so there's no need to quote it. */
  adjacentReply: boolean
  highlighted: boolean
  quoted: (seq: number) => Message | undefined
  nameOf: (name: string) => string
  onReply: (m: Message) => void
  onJump: (seq: number) => void
  /** The thread this message starts, when it has replies: shown as one line under it. */
  thread?: ThreadSummary
  onOpenThread?: (root: number) => void
  /** Anchor ids are `m<seq>` in the timeline; the thread panel uses its own prefix so a root can appear in both. */
  anchor?: string
  /** The author's colour: a person's own pick, or their person's for an agent (colorOf). */
  color?: Color | null
  /** The clock, for "2m ago"; without it, times are clock times. */
  now?: number
}

export interface ThreadSummary {
  count: number
  last: number
  people: { name: string; label: string; agent: boolean; color?: Color | null }[]
  /** A reply is addressed to the reader. */
  forYou: boolean
}

export const MessageRow = memo(function MessageRow({ m, me, author, trust, online, head, adjacentReply, highlighted, quoted, nameOf, onReply, onJump, thread, onOpenThread, anchor = "m", color, direct, room, now }: RowProps) {
  const forged = ignored(trust)
  const repliedTo = new Set((m.re ?? []).map((seq) => quoted(seq)?.from).filter((f): f is string => !!f))
  const said = phrase(m, me, nameOf, repliedTo)
  const sponsor = author?.sponsor && isAgent(author) ? `Agent for ${author.sponsor.name}` : isAgent(author) ? "Agent" : "Person"
  const who = memberName(author, m.from)
  // Image-only messages carry the file names as their body; don't print them.
  const imageOnly = !!m.imgs?.length && m.body === m.imgs.map((i) => i.name).join(", ")

  return (
    <div
      id={`${anchor}${m.seq}`}
      className={cx(
        "group relative -mx-3 grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 rounded-ctl px-3 transition-colors hover:bg-wash",
        head ? "mt-2 pt-1.5 pb-1 first:mt-0" : "py-[3px]",
        highlighted && "animate-flash"
      )}
    >
      <div>
        {head ? (
          <Monogram name={who} agent={isAgent(author)} online={online} color={color} className="mt-0.5" />
        ) : (
          <time className="invisible block pt-[3px] text-right text-meta text-ink-3 tabular-nums group-hover:visible" title={formatFull(m.ts)}>
            {formatTime(m.ts).replace(/\s?[AP]M$/i, "")}
          </time>
        )}
      </div>

      <div className="min-w-0">
        {head && (
          <div className="flex min-w-0 items-baseline gap-1.5 text-meta text-ink-3">
            <span className="truncate text-ui font-medium text-ink" title={sponsor}>
              {who}
            </span>
            {said && <span className={cx("truncate text-ui", said.alert ? "font-medium text-alert" : "text-ink-2")}>{said.text}</span>}
            {room && <span className="shrink-0">in #{room}</span>}
            <span aria-hidden>·</span>
            <time className="shrink-0 tabular-nums" title={formatFull(m.ts)}>
              {now ? formatAgo(m.rts ?? m.ts, now) : formatTime(m.ts)}
            </time>
          </div>
        )}
        {!head && said && <p className={cx("text-ui", said.alert ? "font-medium text-alert" : "text-ink-2")}>{said.text}</p>}

        {!adjacentReply &&
          m.re?.map((seq) => {
            const q = quoted(seq)
            return (
              <button key={seq} type="button" onClick={() => onJump(seq)} className="mt-0.5 flex max-w-full items-center gap-1.5 text-left text-ui text-ink-3 transition-colors hover:text-ink-2">
                <Icon icon={ArrowTurnBackwardIcon} size={13} className="shrink-0" />
                <span className="truncate">
                  <span className="font-medium text-ink-2">{q ? nameOf(q.from) : "Earlier message"}</span> {q ? excerpt(q.body, 110) : ""}
                </span>
              </button>
            )
          })}

        {!imageOnly && (
          <div className={cx("text-body leading-[1.6] tracking-[-0.006em]", forged ? "text-ink-3 line-through" : "text-ink")}>
            <Markdown>{m.body}</Markdown>
          </div>
        )}

        {m.imgs?.length ? (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {m.imgs.map((img, i) => {
              const url = `data:${img.mime};base64,${img.data}`
              return (
                <a key={i} href={url} target="_blank" rel="noreferrer" title={img.name}>
                  <img src={url} alt={img.name} loading="lazy" className="max-h-72 max-w-full rounded-ctl object-cover shadow-[0_0_0_0.5px_var(--line)]" />
                </a>
              )
            })}
          </div>
        ) : null}

        {direct && !forged && <p className="mt-0.5 text-meta text-ink-3">Sent directly, not through {nameOf(direct)}.</p>}
        {forged && (
          <p className="mt-0.5 text-meta text-alert">
            {trust === "refused" ? `Against what the owner allows here, so agents ignore it.` : `Not signed by ${m.from}’s key, so agents ignore it.`}
          </p>
        )}

        {thread && onOpenThread && (
          <button
            type="button"
            onClick={() => onOpenThread(m.seq)}
            className="mt-1 -ml-1.5 flex max-w-full items-center gap-2 rounded-ctl py-1 pr-2.5 pl-1.5 text-left text-ui transition-colors hover:bg-wash-2"
          >
            <span className="flex shrink-0 -space-x-1" aria-hidden>
              {thread.people.slice(0, 4).map((p) => (
                <span key={p.name} className="flex bg-canvas p-px" style={{ borderRadius: p.agent ? 6 : 999 }}>
                  <Monogram name={p.label} agent={p.agent} color={p.color} size={16} />
                </span>
              ))}
            </span>
            <span className={cx("shrink-0 font-medium", thread.forYou ? "text-ink" : "text-ink-2")}>{thread.count === 1 ? "1 reply" : `${thread.count} replies`}</span>
            {thread.forYou && <span className="shrink-0 rounded-full bg-ink px-1.5 text-meta font-semibold text-canvas">for you</span>}
            <span className="truncate text-meta text-ink-3">· {now ? formatAgo(thread.last, now) : formatTime(thread.last)}</span>
          </button>
        )}
      </div>

      <div className="absolute -top-3 right-3 hidden items-center gap-px rounded-ctl bg-raised p-0.5 shadow-pop group-focus-within:flex group-hover:flex">
        <IconButton label="Reply" className="size-7" onClick={() => onReply(m)}>
          <Icon icon={ArrowTurnBackwardIcon} size={15} />
        </IconButton>
        <IconButton label="Copy text" className="size-7" onClick={() => navigator.clipboard.writeText(m.body).then(() => toast("Copied"))}>
          <Icon icon={Copy01Icon} size={15} />
        </IconButton>
      </div>
    </div>
  )
})
