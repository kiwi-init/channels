import { ArrowTurnBackwardIcon, Copy01Icon } from "@hugeicons/core-free-icons"
import { memo, useEffect, useState, type ReactNode } from "react"

import { describeEvent } from "@mc/format.ts"
import { ignored, type Color, type ImageAttachment, type Message, type Trust } from "@mc/protocol.ts"
import type { ChannelState, Member } from "@mc/state.ts"
import { excerpt, formatAgo, formatFull, formatStamp, memberName } from "@/lib/format"
import { chipLabel, type Chip } from "@/lib/reactions"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Monogram, toast } from "./kit"
import { Markdown } from "./lazy"

/** Anyone who isn't a signed-in person is an agent. */
export const isAgent = (m: Pick<Member, "kind"> | undefined) => m?.kind !== "human"

/** Who wrote a message, as far as the transcript needs to know. */
type Author = Pick<Member, "name" | "kind" | "display" | "sponsor">

/** Time passing in the conversation: a small stamp centred between bubbles, the day set a little heavier, as Messages does. */
export function TimeMark({ ts }: { ts: number }) {
  const [day, time] = splitStamp(formatStamp(ts))
  return (
    <div className="mt-6 mb-2 text-center select-none">
      <time className="text-stamp text-ink-3" dateTime={new Date(ts).toISOString()} title={formatFull(ts)}>
        <span className="font-semibold text-ink-2">{day}</span>
        {time && <span className="tabular-nums"> {time}</span>}
      </time>
    </div>
  )
}

/** "Today at 11:21 AM" as its day and its time. */
function splitStamp(stamp: string): [string, string] {
  const at = stamp.lastIndexOf(" at ")
  return at < 0 ? [stamp, ""] : [stamp.slice(0, at), stamp.slice(at + 4)]
}

/** What happened, in as few words as it takes: the long form is in the line's tooltip. */
function shortEvent(m: Message, state: ChannelState): string {
  const ev = m.ev
  const who = memberName(state.members.get(m.from), m.from)
  const name = (n: string) => memberName(state.members.get(n), n)
  if (!ev) return m.body
  switch (ev.op) {
    case "mode.set":
      return ev.coordinatorOnly ? "Coordinator mode on" : "Coordinator mode off"
    case "role.set":
      return !ev.role ? `${name(ev.member)} has no role now` : ev.role.trim().toLowerCase() === "coordinator" ? `${name(ev.member)} is the coordinator` : `${name(ev.member)} is ${ev.role}`
    case "hold.set":
      return ev.on ? `${who} paused every agent${ev.note ? `: ${ev.note}` : ""}` : `${who} let the agents carry on`
    case "charter.set":
      return ev.text ? `${who} updated the charter` : `${who} cleared the charter`
    case "fact.set":
      return `${who} noted ${ev.key}`
    case "fact.del":
      return `${who} cleared the note ${ev.key}`
    default:
      return `${who} ${describeEvent(m, state)}`
  }
}

/** Something that happened rather than something said: one quiet line centred on the column, as Messages sets them, cut short if long. */
export function EventRow({ m, state, now, onOpenTask, anchor = "m", more }: { m: Message; state: ChannelState; now: number; onOpenTask?: (id: number) => void; anchor?: string; more?: ReactNode }) {
  const taskRef = m.ev && "task" in m.ev ? m.ev.task : m.ev?.op === "task.add" ? m.seq : null
  const forged = ignored(state.trust.get(m.seq))
  const full = `${memberName(state.members.get(m.from), m.from)} ${describeEvent(m, state)} · ${formatFull(m.ts)} (${formatAgo(m.rts ?? m.ts, now)})`
  return (
    <p id={`${anchor}${m.seq}`} title={full} className={cx("flex min-w-0 items-baseline justify-center gap-1.5 px-8 py-[3px] text-center text-stamp text-ink-3", forged && "line-through opacity-60")}>
      <span className="min-w-0 truncate">{shortEvent(m, state)}</span>
      {taskRef !== null && onOpenTask && (
        <button type="button" onClick={() => onOpenTask(taskRef)} className="shrink-0 font-medium text-ink-2 hover:text-ink hover:underline">
          Open
        </button>
      )}
      {more}
    </p>
  )
}

/** A same-day run of events: three or more read as the latest, with the rest a click away. */
export function EventGroup({
  messages,
  state,
  now,
  onOpenTask,
  highlight,
  anchor,
}: {
  messages: Message[]
  state: ChannelState
  now: number
  onOpenTask?: (id: number) => void
  highlight: number | null
  anchor?: string
}) {
  const [open, setOpen] = useState(false)
  const row = (m: Message, more?: ReactNode) => <EventRow key={m.seq} m={m} state={state} now={now} onOpenTask={onOpenTask} anchor={anchor} more={more} />
  if (messages.length < 3) return <div className="my-1">{messages.map((m) => row(m))}</div>
  const forced = highlight !== null && messages.some((m) => m.seq === highlight)
  const shown = open || forced
  const last = messages[messages.length - 1]!
  const n = messages.length - 1
  const toggle = (
    <button type="button" aria-expanded={shown} onClick={() => setOpen(!shown)} className="shrink-0 text-ink-3 hover:text-ink-2">
      {shown ? "· fewer" : `· ${n} more`}
    </button>
  )
  return <div className="my-1">{shown ? messages.map((m, i) => row(m, i === messages.length - 1 ? toggle : undefined)) : row(last, toggle)}</div>
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

/** What a message asks of the reader, in a few words above its bubble. */
function phrase(m: Message, me: string, nameOf: (n: string) => string, repliedTo: Set<string>): { text: string; alert?: boolean; decide?: boolean } | null {
  // Questions and blockers always say who they're for; plain messages only when the text doesn't already.
  const named = (t: string) => m.body.includes(`@${t}`) || repliedTo.has(t)
  const targets = m.kind === "ask" || m.kind === "blocking" ? (m.to ?? []) : (m.to ?? []).filter((t) => !named(t))
  // "*" is how a broadcast to all is addressed; say it in words.
  const to = targets.map((t) => (t === "*" ? "everyone" : t === me ? "you" : nameOf(t)))
  const list = to.length > 1 ? `${to.slice(0, -1).join(", ")} and ${to[to.length - 1]}` : to[0]
  // An agent handing a decision to people: named for what it is, in amber, never shouted.
  if (m.esc) return { text: to.includes("you") ? "Decision for you" : list ? `Decision for ${list}` : "Decision for people", decide: true }
  switch (m.kind) {
    case "ask":
      return { text: list ? `asks ${list}` : "asks everyone" }
    case "blocking":
      return { text: list ? `is blocked, needs ${list}` : "is blocked", alert: true }
    case "done":
      return { text: "finished" }
    case "status":
      return { text: "update" }
    case "ack":
      return { text: "acknowledged" }
    default:
      return list ? { text: `to ${list}` } : null
  }
}

interface BubbleProps {
  m: Message
  me: string
  /** Under your newest message: whether the agents it went to have read it (receipts.ts). */
  receipt?: string
  /** Coordinator-only: an agent sent this to a person directly, not through this coordinator. */
  direct?: string
  /** Members' reactions to it (reactions.ts). */
  reactions?: Chip[]
  /** Found by the key that signed the message, so two members sharing a name still read right. */
  author?: Author
  trust?: Trust
  online: boolean
  /** The first bubble of a run from one sender: it carries the sender's name (in a group). */
  first: boolean
  /** The last bubble of a run: the sender's face beside it, and its corner rounds off the run. */
  last: boolean
  /** Arrived (or sent) while the conversation was open: it lands with a little motion. */
  fresh?: boolean
  /** More than two people here: name who's talking. */
  group: boolean
  /** The message right above is the one this replies to, so there's no need to quote it. */
  adjacentReply: boolean
  highlighted: boolean
  quoted: (seq: number) => Message | undefined
  nameOf: (name: string) => string
  onReply?: (m: Message) => void
  onJump: (seq: number) => void
  /** The thread this message starts, when it has replies: "1 Reply" under it. */
  thread?: ThreadSummary
  onOpenThread?: (root: number) => void
  /** Anchor ids are `m<seq>` in the conversation; the thread panel uses its own prefix so a root can appear in both. */
  anchor?: string
  /** The author's colour: a person's own pick, or their person's for an agent (colorOf). */
  color?: Color | null
  /** A face other than the monogram at the run's foot: the coordinator's head. */
  face?: ReactNode
  image?: (img: ImageAttachment) => Promise<string | null>
}

function Attached({ img, load }: { img: ImageAttachment; load?: (img: ImageAttachment) => Promise<string | null> }) {
  const [data, setData] = useState<string | null>(img.data ?? null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (img.data !== undefined || !load) return
    let live = true
    load(img).then(
      (d) => live && (d ? setData(d) : setFailed(true)),
      () => live && setFailed(true)
    )
    return () => {
      live = false
    }
  }, [img, load])
  if (!data) {
    return (
      <span title={img.name} className="flex h-24 w-32 items-center justify-center rounded-bubble bg-wash px-2 text-center text-stamp text-ink-3 shadow-[0_0_0_0.5px_var(--line)]">
        {failed ? "Image no longer available" : "Loading image…"}
      </span>
    )
  }
  const url = `data:${img.mime};base64,${data}`
  return (
    <a href={url} target="_blank" rel="noreferrer" title={img.name}>
      <img src={url} alt={img.name} loading="lazy" className="max-h-72 max-w-full rounded-bubble object-cover shadow-[0_0_0_0.5px_var(--line)]" />
    </a>
  )
}

export interface ThreadSummary {
  count: number
  last: number
  people: { name: string; label: string; agent: boolean; color?: Color | null }[]
  /** A reply is addressed to the reader. */
  forYou: boolean
}

/**
 * One message as a bubble: yours on the right in system blue, everyone else's on the left in Messages grey,
 * with their face at the foot of the run. Every bubble is round; the last of a run wears Messages'
 * tail, pointing at its sender. An escalation is a plain bubble with an amber "Decision for you"
 * over it; a forged one (shown only when the owner asks) is struck through.
 */
export const Bubble = memo(function Bubble({
  m,
  me,
  author,
  trust,
  online,
  first,
  last,
  fresh,
  group,
  adjacentReply,
  highlighted,
  quoted,
  nameOf,
  onReply,
  onJump,
  thread,
  onOpenThread,
  anchor = "m",
  color,
  direct,
  face,
  receipt,
  reactions,
  image,
}: BubbleProps) {
  const forged = ignored(trust)
  const mine = m.from === me
  const repliedTo = new Set((m.re ?? []).map((seq) => quoted(seq)?.from).filter((f): f is string => !!f))
  // Your own bubbles don't need saying who they're to, unless you handed something to people.
  const said = mine && !m.esc ? null : phrase(m, me, nameOf, repliedTo)
  const sponsor = author?.sponsor && isAgent(author) ? `Agent for ${author.sponsor.name}` : isAgent(author) ? "Agent" : "Person"
  const who = memberName(author, m.from)
  // Image-only messages carry the file names as their body; don't print them.
  const imageOnly = !!m.imgs?.length && m.body === m.imgs.map((i) => i.name).join(", ")
  const decide = !!m.esc
  // Quote what this answers, unless it's the bubble right above.
  const quotes = adjacentReply ? [] : (m.re ?? []).map((seq) => ({ seq, q: quoted(seq) })).filter(({ q }) => !q || q.kind !== "event")

  return (
    <div id={`${anchor}${m.seq}`} className={cx("group/b relative", first ? "mt-3" : "mt-[2px]", fresh && (mine ? "animate-sent" : "animate-arrived"))}>
      {/* The bubble and the face beside it: the face sits by the bubble's last line, not by what hangs under it. */}
      <div className={cx("relative flex items-end gap-2", mine ? "justify-end pl-10 md:pl-16" : "pr-10 md:pr-16")}>
        {!mine && <div className="w-7 shrink-0 self-end">{last && (face ?? <Monogram name={who} hue={m.from} agent={isAgent(author)} online={online} color={color} size={28} />)}</div>}

        <div className={cx("flex max-w-[min(80%,600px)] min-w-0 flex-col", mine ? "items-end" : "items-start")}>
          {first && (!mine || said) && (
            <p className={cx("mb-1 flex max-w-full items-center gap-1.5 px-3 text-stamp text-ink-3", mine && "justify-end")}>
              {!mine && group && (
                <span className="truncate font-medium text-ink-2" title={sponsor}>
                  {who}
                  {who !== m.from && isAgent(author) && <span className="ml-1 font-normal text-ink-3">@{m.from}</span>}
                </span>
              )}
              {said &&
                (said.decide ? (
                  <span className="shrink-0 rounded-full bg-decide-wash px-1.5 font-semibold text-decide">{said.text}</span>
                ) : (
                  <span className={cx("truncate", said.alert && "font-semibold text-alert")}>{said.text}</span>
                ))}
            </p>
          )}

          {quotes.map(({ seq, q }) => (
            <button
              key={seq}
              type="button"
              onClick={() => onJump(seq)}
              className={cx("mb-0.5 flex max-w-full items-center gap-1 px-3 text-left text-stamp text-ink-3 transition-colors hover:text-ink-2", mine && "self-end")}
            >
              <Icon icon={ArrowTurnBackwardIcon} size={12} className="shrink-0" />
              <span className="truncate">
                <span className="font-medium text-ink-2">{q ? nameOf(q.from) : "Earlier message"}</span> {q ? excerpt(q.body, 80) : ""}
              </span>
            </button>
          ))}

          {!imageOnly && (
            <div
              className={cx(
                // Code keeps its lines: it scrolls inside the bubble rather than wrapping mid-word like prose.
                "bubble-text relative isolate max-w-full min-w-0 rounded-bubble px-3.5 py-[7px] text-body [&_pre]:max-w-full [&_pre]:[overflow-wrap:normal] [&_pre]:whitespace-pre",
                mine
                  ? "bg-bubble-me text-bubble-me-ink [&_a]:text-bubble-me-ink [&_a]:decoration-white/50 [&_code]:bg-white/18 [&_li]:marker:text-white/70 [&_pre]:border-white/15 [&_pre]:bg-black/15 [&_pre]:text-white"
                  : "bg-bubble-them text-bubble-them-ink",
                forged && "line-through opacity-60",
                highlighted && "animate-flash outline-2 outline-offset-2 outline-[var(--ring)]"
              )}
            >
              <Markdown>{m.body}</Markdown>
              {last && <Tail mine={mine} />}
            </div>
          )}

          {m.imgs?.length ? (
            <div className={cx("mt-0.5 flex flex-wrap gap-1", mine && "justify-end")}>
              {m.imgs.map((img, i) => (
                <Attached key={i} img={img} load={image} />
              ))}
            </div>
          ) : null}
        </div>

        {/* Reply and copy, beside the bubble on hover: on its inner side, so they never cover anything. */}
        <div className={cx("absolute bottom-0 hidden items-center gap-0.5 group-focus-within/b:flex group-hover/b:flex", mine ? "left-0" : "right-0")}>
          {onReply && (
            <button
              type="button"
              aria-label="Reply"
              title="Reply"
              onClick={() => onReply(m)}
              className="flex size-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-wash-2 hover:text-ink"
            >
              <Icon icon={ArrowTurnBackwardIcon} size={15} />
            </button>
          )}
          <button
            type="button"
            aria-label="Copy text"
            title="Copy text"
            onClick={() => navigator.clipboard.writeText(m.body).then(() => toast("Copied"))}
            className="flex size-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-wash-2 hover:text-ink"
          >
            <Icon icon={Copy01Icon} size={14} />
          </button>
        </div>
      </div>

      {/* What hangs off the bubble (its answer link, notes, replies), under it on the bubble's edge. */}
      <div className={cx("flex flex-col", mine ? "items-end pl-10 md:pl-16" : "items-start pr-10 pl-9 md:pr-16")}>
        {decide && !mine && onReply && (
          <p className="mt-1 flex items-center gap-1 px-3 text-meta">
            <button type="button" onClick={() => onReply(m)} className="font-medium text-decide hover:underline">
              Answer
            </button>
          </p>
        )}
        {!!reactions?.length && !forged && (
          <p className={cx("mt-0.5 flex flex-wrap gap-1 px-2", mine && "justify-end")}>
            {reactions.map((c) => (
              <span
                key={c.emoji}
                title={chipLabel(c)}
                aria-label={chipLabel(c)}
                className={cx("inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-stamp tabular-nums", c.mine ? "bg-accent-wash text-accent-text" : "bg-wash-2 text-ink-2")}
              >
                <span aria-hidden>{c.emoji}</span>
                {c.who.length > 1 && <span aria-hidden>{c.who.length}</span>}
              </span>
            ))}
          </p>
        )}
        {receipt && mine && !forged && (
          <p className="mt-0.5 px-3 text-stamp text-ink-3" aria-live="polite">
            {receipt}
          </p>
        )}
        {direct && !forged && <p className="mt-0.5 px-3 text-stamp text-ink-3">Sent directly, not through {nameOf(direct)}.</p>}
        {forged && (
          <p className="mt-0.5 px-3 text-stamp text-alert">
            {trust === "refused" ? `Not allowed by your settings, so every view leaves it out.` : `Forged: not signed by ${m.from}’s key, so every view leaves it out.`}{" "}
            {m.pk ? `Signed by key ${m.pk.slice(0, 8)}.` : "Unsigned."}
          </p>
        )}

        {thread && onOpenThread && (
          <button type="button" onClick={() => onOpenThread(m.seq)} className="mt-2 mb-2 px-3 text-left text-meta font-medium text-ink-2 hover:text-ink hover:underline">
            {thread.count === 1 ? "1 Reply" : `${thread.count} Replies`}
            {thread.forYou && <span className="ml-1.5 font-normal text-ink-3">· for you</span>}
          </button>
        )}
      </div>
    </div>
  )
})

/**
 * Messages' tail: a small hook off the last bubble of a run, toward its sender, in the bubble's own
 * colour. It starts on the bubble's flat bottom (20px in from its edge, past the rounded corner),
 * fills the corner, and curls out 8px to a point. Behind the text (the bubble isolates it), never over it.
 */
function Tail({ mine }: { mine: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 28 20" className={cx("pointer-events-none absolute bottom-0 -z-10 h-5 w-7", mine ? "-right-2 fill-bubble-me" : "-left-2 -scale-x-100 fill-bubble-them")}>
      <path d="M0 20V0H20C20 9 22 15.5 27.5 19.6C23 20.4 19.5 19.8 16.6 18.3C13.7 16.8 8 20 0 20Z" />
    </svg>
  )
}
