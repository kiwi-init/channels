import { ArrowTurnBackwardIcon, Copy01Icon, GitPullRequestIcon } from "@hugeicons/core-free-icons"
import { memo, useEffect, useMemo, useState, type ReactNode } from "react"

import { describeEvent, githubLine } from "@kiwi/core/format.ts"
import { ignored, type Color, type Handoff, type ImageAttachment, type Message, type Trust } from "@kiwi/core/protocol.ts"
import { isLeadRole, type ChannelState, type Member } from "@kiwi/core/state.ts"
import type { PrRef } from "@kiwi/core/work.ts"
import type { Chosen } from "@/lib/asks"
import { useClock } from "@/lib/channel"
import { formatAgo, formatFull, formatStamp, formatTime, isoTime, memberName } from "@/lib/format"
import type { Settled } from "@/lib/permission-settled"
import { AskedBelow } from "./asked-below"
import { githubSummary } from "@/lib/github-line"
import { sameRow } from "./message-memo"
import { openHandoff } from "@/lib/handoff-open"
import { handoffLabel, handoffLeft, handoffOf, handoffOpen } from "@/lib/handoff"
import { chipLabel, type Chip } from "@/lib/reactions"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Monogram, toast } from "./kit"
import { Markdown, PermissionInThread } from "./lazy"
import { AskOptions } from "./ask-options"
import { ChecksWord } from "./pr-checks"
import { Quote } from "./quote"

/** Anyone who isn't a signed-in person is an agent. */
export const isAgent = (m: Pick<Member, "kind"> | undefined) => m?.kind !== "human"

/** Who wrote a message, as far as the transcript needs to know. */
type Author = Pick<Member, "name" | "kind" | "display" | "sponsor">

export function DayMark({ ts }: { ts: number }) {
  const [day] = splitStamp(formatStamp(ts))
  return (
    <div className="mt-5 mb-1 flex items-center gap-3 text-meta text-ink-3 select-none before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
      <time dateTime={isoTime(ts)} title={formatFull(ts)}>
        {day}
      </time>
    </div>
  )
}

function splitStamp(stamp: string): [string, string] {
  const at = stamp.lastIndexOf(" at ")
  return at < 0 ? [stamp, ""] : [stamp.slice(0, at), stamp.slice(at + 4)]
}

/** What happened, in as few words as it takes: the long form is in the line's tooltip. */
export function shortEvent(m: Message, state: ChannelState): string {
  const ev = m.ev
  const who = memberName(state.members.get(m.from), m.from)
  const name = (n: string) => memberName(state.members.get(n), n)
  if (!ev) return m.body
  switch (ev.op) {
    case "mode.set":
      return ev.coordinatorOnly ? "Coordinator mode on (no longer used)" : "Coordinator mode off (no longer used)"
    case "role.set":
      return !ev.role ? `${name(ev.member)} has no role now` : isLeadRole(ev.role) ? `${name(ev.member)} is the lead` : `${name(ev.member)} is ${ev.role}`
    case "hold.set":
      return ev.on ? `${who} paused every agent${ev.note ? `: ${ev.note}` : ""}` : `${who} let the agents carry on`
    case "voice.set":
      return ev.on ? `${who} allowed voice here` : `${who} turned voice off here`
    case "github.write.set":
      return ev.on ? `${who} turned on Write to GitHub` : `${who} turned off Write to GitHub`
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

export function EventRow({ m, state, now, onOpenTask, anchor = "m", more }: { m: Message; state: ChannelState; now: number; onOpenTask?: (id: number) => void; anchor?: string; more?: ReactNode }) {
  const taskRef = m.ev && "task" in m.ev ? m.ev.task : m.ev?.op === "task.add" ? m.seq : null
  const forged = ignored(state.trust.get(m.seq))
  const full = `${memberName(state.members.get(m.from), m.from)} ${describeEvent(m, state)} · ${formatFull(m.ts)} (${formatAgo(m.rts ?? m.ts, now)})`
  return (
    <p id={`${anchor}${m.seq}`} title={full} className={cx("flex min-w-0 items-baseline gap-1.5 py-[3px] pr-4 pl-11 text-meta text-ink-3", forged && "line-through opacity-60")}>
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

function HandoffLine({ handoff }: { handoff: Handoff }) {
  const now = useClock(30_000)
  return (
    <p className="mt-1 flex items-center gap-2 px-3 text-meta text-ink-3">
      {handoffOpen(handoff, now) ? (
        <>
          <button type="button" onClick={() => openHandoff(handoff)} className="font-medium text-decide hover:underline">
            Open browser
          </button>
          <span>
            {handoffLabel(handoff)} · {handoffLeft(handoff, now)}
          </span>
        </>
      ) : (
        <span>Link expired</span>
      )}
    </p>
  )
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
  if (m.esc && m.handoff) return { text: to.includes("you") ? "Browser for you" : list ? `Browser for ${list}` : "Browser for people", decide: true }
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

export interface MessageProps {
  m: Message
  me: string
  receipt?: string
  reactions?: Chip[]
  author?: Author
  tag?: string
  trust?: Trust
  online: boolean
  first: boolean
  fresh?: boolean
  adjacentReply: boolean
  highlighted: boolean
  quoted: (seq: number) => Message | undefined
  nameOf: (name: string) => string
  onReply?: (m: Message) => void
  onChoose?: (choice: string) => Promise<boolean>
  /** This question waits above the composer, where it is answered: here it is only a pointer to it. */
  inBanner?: boolean
  chosen?: Chosen
  settled?: Settled | null
  prs?: PrRef[]
  onJump: (seq: number) => void
  thread?: ThreadSummary
  onOpenThread?: (root: number) => void
  anchor?: string
  color?: Color | null
  face?: ReactNode
  image?: (img: ImageAttachment) => Promise<string | null>
  onOpenImage?: (m: Message, img: ImageAttachment, src: string) => void
  clamp?: boolean
}

function Clamp({ on, children }: { on: boolean; children: ReactNode }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [inner, setInner] = useState<HTMLDivElement | null>(null)
  const [over, setOver] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!on || open || !box || !inner || typeof ResizeObserver === "undefined") return
    const measure = () => setOver(inner.offsetHeight > box.clientHeight + 2)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(inner)
    return () => watch.disconnect()
  }, [on, open, box, inner])
  if (!on || open) return children
  return (
    <>
      <div ref={setBox} className={cx("max-h-[6lh] overflow-hidden", over && "clamp-more")}>
        <div ref={setInner}>{children}</div>
      </div>
      {over && (
        <button type="button" onClick={() => setOpen(true)} className="mt-0.5 text-meta font-medium text-accent-text hover:underline">
          Show more
        </button>
      )}
    </>
  )
}

function useSeen(el: Element | null): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined")
  useEffect(() => {
    if (seen || !el) return
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true)
      },
      { rootMargin: "400px 0px" }
    )
    watch.observe(el)
    return () => watch.disconnect()
  }, [el, seen])
  return seen
}

const IMAGE_RETRIES = 3
const IMAGE_RETRY_MS = 5000

function Attached({ img, load, onOpen }: { img: ImageAttachment; load?: (img: ImageAttachment) => Promise<string | null>; onOpen?: (src: string) => void }) {
  const [data, setData] = useState<string | null>(img.data ?? null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [gaveUp, setGaveUp] = useState(false)
  const [spot, setSpot] = useState<HTMLSpanElement | null>(null)
  const seen = useSeen(spot)
  useEffect(() => {
    if (img.data !== undefined || !load || !seen) return
    let live = true
    let retry: ReturnType<typeof setTimeout> | undefined
    load(img).then(
      (d) => {
        if (!live) return
        if (d) setData(d)
        else setFailed(true)
      },
      () => {
        if (!live) return
        if (attempt < IMAGE_RETRIES) retry = setTimeout(() => setAttempt((n) => n + 1), IMAGE_RETRY_MS)
        else setGaveUp(true)
      }
    )
    return () => {
      live = false
      clearTimeout(retry)
    }
  }, [img, load, seen, attempt])
  if (!data) {
    if (gaveUp) {
      return (
        <button
          type="button"
          onClick={() => {
            setGaveUp(false)
            setAttempt(0)
          }}
          title={img.name}
          className="flex h-24 w-32 items-center justify-center rounded-bubble bg-wash px-2 text-center text-stamp text-ink-3 shadow-[0_0_0_0.5px_var(--line)]"
        >
          Couldn’t load image. Retry
        </button>
      )
    }
    return (
      <span ref={setSpot} title={img.name} className="flex h-24 w-32 items-center justify-center rounded-bubble bg-wash px-2 text-center text-stamp text-ink-3 shadow-[0_0_0_0.5px_var(--line)]">
        {failed ? "Image no longer available" : "Loading image…"}
      </span>
    )
  }
  const url = `data:${img.mime};base64,${data}`
  if (onOpen)
    return (
      <button type="button" onClick={() => onOpen(url)} title={img.name} aria-label={`Open ${img.name}`} className="block cursor-zoom-in rounded-bubble">
        <img src={url} alt={img.name} loading="lazy" className="max-h-72 max-w-full rounded-bubble object-cover shadow-[0_0_0_0.5px_var(--line)]" />
      </button>
    )
  return (
    <a href={url} target="_blank" rel="noreferrer" title={img.name}>
      <img src={url} alt={img.name} loading="lazy" className="max-h-72 max-w-full rounded-bubble object-cover shadow-[0_0_0_0.5px_var(--line)]" />
    </a>
  )
}

export interface ThreadSummary {
  count: number
  first: number
  last: number
  people: { name: string; label: string; agent: boolean; color?: Color | null }[]
  /** A reply is addressed to the reader. */
  forYou: boolean
}

const LINE_ROW = "flex w-full max-w-[560px] min-w-0 items-center gap-2.5 rounded-row px-3 py-2 text-left text-ui shadow-[inset_0_0_0_1px_var(--line)]"

const PR_STATE: Record<PrRef["state"], { word: string; tone: string }> = {
  open: { word: "open", tone: "text-doing" },
  merged: { word: "merged", tone: "text-live" },
  closed: { word: "closed", tone: "text-ink-3" },
}

function PrLine({ pr }: { pr: PrRef }) {
  const st = PR_STATE[pr.state]
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={`${pr.repo}#${pr.number}${pr.title ? `: ${pr.title}` : ""}`}
      className={cx(LINE_ROW, "mt-2 text-ink transition-shadow hover:shadow-[inset_0_0_0_1px_var(--edge-strong)]")}
    >
      <Icon icon={GitPullRequestIcon} size={16} className="shrink-0 text-ink-3" />
      <span className="shrink-0 text-ink-3 tabular-nums">#{pr.number}</span>
      <span className="min-w-0 flex-1 truncate">{pr.title ?? pr.repo}</span>
      <span className={cx("shrink-0 text-meta", st.tone)}>
        {st.word}
        {pr.checks && <ChecksWord checks={pr.checks} />}
      </span>
    </a>
  )
}

export function GithubRow({ messages, anchor = "m" }: { messages: Message[]; anchor?: string }) {
  const items = messages.flatMap((m) => (m.ev?.op === "github" ? m.ev.items : []))
  const parts = githubSummary(items)
  const title = messages.map((m) => (m.ev?.op === "github" ? githubLine(m.ev.items) : "")).join("\n")
  return (
    <p id={`${anchor}${messages[0]!.seq}`} title={title} className="flex min-w-0 items-center gap-2 py-1 pr-4 pl-11 text-meta text-ink-3">
      <Icon icon={GitPullRequestIcon} size={14} className="shrink-0" />
      <span className="min-w-0 truncate">
        GitHub
        {parts.map((p, i) => (
          <span key={i}>
            {i === 0 ? " · " : ", "}
            {p.ref &&
              (p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" className="font-medium text-accent-text hover:underline">
                  {p.ref}
                </a>
              ) : (
                <span className="font-medium text-ink-2">{p.ref}</span>
              ))}
            {p.ref ? ` ${p.text}` : p.text}
          </span>
        ))}
      </span>
      {items.length > 1 && <span className="shrink-0 text-ink-2">· {items.length} updates</span>}
    </p>
  )
}

export const MessageRow = memo(function MessageRow({
  m,
  me,
  author,
  tag,
  trust,
  online,
  first,
  fresh,
  adjacentReply,
  highlighted,
  quoted,
  nameOf,
  onReply,
  onChoose,
  inBanner,
  chosen,
  settled,
  prs,
  onJump,
  thread,
  onOpenThread,
  anchor = "m",
  color,
  face,
  receipt,
  reactions,
  image,
  onOpenImage,
  clamp = false,
}: MessageProps) {
  const forged = ignored(trust)
  const refs = useMemo(() => ({ known: (seq: number) => seq !== m.seq && quoted(seq) !== undefined, open: onJump }), [m.seq, quoted, onJump])
  const mine = m.from === me
  const repliedTo = new Set((m.re ?? []).map((seq) => quoted(seq)?.from).filter((f): f is string => !!f))
  const said = mine && !m.esc ? null : phrase(m, me, nameOf, repliedTo)
  const sponsor = author?.sponsor && isAgent(author) ? `Agent for ${author.sponsor.name}` : isAgent(author) ? "Agent" : "Person"
  const who = memberName(author, m.from)
  const imageOnly = !!m.imgs?.length && m.body === m.imgs.map((i) => i.name).join(", ")
  const decide = !!m.esc
  const permission = m.permission
  const handoff = handoffOf(m)
  const quotes = adjacentReply ? [] : (m.re ?? []).map((seq) => ({ seq, q: quoted(seq) })).filter(({ q }) => !q || q.kind !== "event")
  const action = "flex size-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-ink"

  return (
    <div
      id={`${anchor}${m.seq}`}
      title={first ? undefined : formatFull(m.ts)}
      className={cx("group/b relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 pr-2", first ? "mt-3" : "mt-0.5", fresh && "animate-arrived", highlighted && "animate-flash rounded-row")}
    >
      <div className="pt-0.5">{first && (face ?? <Monogram name={who} hue={m.from} agent={isAgent(author)} online={online} color={color} size={32} />)}</div>

      <div className="-m-1 min-w-0 p-1 offscreen-lazy">
        {first && (
          <p className="flex min-w-0 items-baseline gap-2 text-ui">
            <span className="truncate font-semibold text-ink" title={sponsor}>
              {who}
              {who !== m.from && isAgent(author) && <span className="ml-1 font-normal text-ink-3">@{m.from}</span>}
            </span>
            {tag && <span className="shrink-0 text-meta text-ink-3">{tag}</span>}
            {said && !(said.decide && onChoose && !chosen) && (
              <span className={cx("min-w-0 truncate text-meta", said.alert ? "font-semibold text-alert" : said.decide ? "font-medium text-decide" : "text-ink-3")}>{said.text}</span>
            )}
            <time dateTime={isoTime(m.ts)} title={formatFull(m.ts)} className="shrink-0 text-stamp text-ink-3 tabular-nums">
              {formatTime(m.ts)}
            </time>
          </p>
        )}

        {quotes.map(({ seq, q }) => (
          <Quote key={seq} seq={seq} q={q} nameOf={nameOf} onJump={onJump} />
        ))}

        {inBanner ? (
          <AskedBelow body={m.body} first={first} />
        ) : (
          !imageOnly && (
            <div
              className={cx(
                "bubble-text max-w-[760px] min-w-0 text-body text-ink [&_pre]:max-w-full [&_pre]:[overflow-wrap:normal] [&_pre]:whitespace-pre",
                first && "mt-0.5",
                forged && "line-through opacity-60"
              )}
            >
              <Clamp on={clamp}>
                <Markdown refs={refs}>{m.body}</Markdown>
              </Clamp>
            </div>
          )
        )}

        {onChoose && !chosen && !inBanner && (
          <p className="mt-2 flex items-center gap-1.5 text-meta font-medium text-decide">
            <span aria-hidden className="size-1.5 rounded-full bg-decide" />
            Waiting on you
          </p>
        )}
        {permission ? (
          <PermissionInThread p={permission} settled={settled} nameOf={nameOf} />
        ) : m.choices?.length && !inBanner ? (
          <AskOptions choices={m.choices} chosen={chosen} onChoose={onChoose} nameOf={nameOf} />
        ) : null}

        {m.imgs?.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {m.imgs.map((img, i) => (
              <Attached key={i} img={img} load={image} onOpen={onOpenImage ? (src) => onOpenImage(m, img, src) : undefined} />
            ))}
          </div>
        ) : null}

        {!forged && prs?.map((pr) => <PrLine key={pr.url} pr={pr} />)}

        {handoff && !mine && (m.to?.includes(me) || m.to?.includes("*")) && <HandoffLine handoff={handoff} />}
        {decide && !mine && onReply && !onChoose && !chosen && (
          <p className="mt-1 text-meta">
            <button type="button" onClick={() => onReply(m)} className="font-medium text-decide hover:underline">
              Answer
            </button>
          </p>
        )}
        {!!reactions?.length && !forged && (
          <p className="mt-1 flex flex-wrap gap-1">
            {reactions.map((c) => (
              <span
                key={c.emoji}
                title={chipLabel(c)}
                aria-label={chipLabel(c)}
                className={cx(
                  "inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-stamp tabular-nums",
                  c.mine ? "text-accent-text shadow-[inset_0_0_0_1px_var(--accent)]" : "text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]"
                )}
              >
                <span aria-hidden>{c.emoji}</span>
                {c.who.length > 1 && <span aria-hidden>{c.who.length}</span>}
              </span>
            ))}
          </p>
        )}
        {receipt && mine && !forged && (
          <p className="mt-0.5 text-stamp text-ink-3" aria-live="polite">
            {receipt}
          </p>
        )}
        {forged && (
          <p className="mt-0.5 text-stamp text-alert">
            {trust === "refused" ? `Not allowed by your settings, so every view leaves it out.` : `Forged: not signed by ${m.from}’s key, so every view leaves it out.`}{" "}
            {m.pk ? `Signed by key ${m.pk.slice(0, 8)}.` : "Unsigned."}
          </p>
        )}

        {thread && onOpenThread && (
          <button type="button" onClick={() => onOpenThread(m.seq)} className="mt-1.5 mb-1 text-left text-meta font-medium text-accent-text hover:underline">
            {thread.count === 1 ? "1 reply" : `${thread.count} replies`}
            {thread.forYou && <span className="ml-1.5 font-normal text-ink-3">· for you</span>}
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute -top-3 right-2 flex items-center gap-0.5 rounded-full bg-canvas px-0.5 opacity-0 shadow-[0_0_0_1px_var(--line)] group-focus-within/b:pointer-events-auto group-focus-within/b:opacity-100 group-hover/b:pointer-events-auto group-hover/b:opacity-100">
        {onReply && (
          <button type="button" aria-label="Reply" title="Reply" onClick={() => onReply(m)} className={action}>
            <Icon icon={ArrowTurnBackwardIcon} size={15} />
          </button>
        )}
        <button type="button" aria-label="Copy text" title="Copy text" onClick={() => navigator.clipboard.writeText(m.body).then(() => toast("Copied"))} className={action}>
          <Icon icon={Copy01Icon} size={14} />
        </button>
      </div>
    </div>
  )
}, sameRow)
