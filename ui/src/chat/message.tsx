import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"

import { isGifReaction } from "@kiwi/core/protocol.ts"

import { PrChip, TaskChip } from "~/chat/cards"
import { useEditing } from "~/chat/editing"
import { parsedFor } from "~/chat/parsed"
import { preview, useReplying } from "~/chat/reply"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago, clock } from "~/kit/time"
import { memberOf, type Channel, type ImageSpot, type Message, type Person } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { linked, named, useMentionParser, withNames } from "~/chat/linked"
import { showMenu } from "~/kit/menu-open"

const Markdown = lazy(() => import("~/chat/markdown"))
const Annotator = lazy(() => import("~/chat/annotator"))
const Gifs = lazy(() => import("~/chat/gif-picker"))
const Changes = lazy(() => import("~/chat/changes"))
const PermissionCard = lazy(() => import("~/chat/permission-card"))
const QuestionCard = lazy(() => import("~/chat/question-card"))

const QUICK = ["👍", "🔥", "👀", "✅"]
const CLAMP_PX = 12 * 22

export function Body({
  text,
  seq,
  names,
  tasks,
  onImage,
  onMessage,
}: {
  text: string
  seq: number
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  onImage: (url: string, alt: string) => void
  onMessage: (seq: number) => void
}) {
  const { go, toast } = useAct()
  const parser = useMentionParser()
  const { markdown } = useMemo(() => ({ parser, markdown: linked(text, names, tasks, seq) }), [parser, text, names, tasks, seq])
  const [shown, setShown] = useState(false)
  const onShown = useCallback(() => setShown(true), [])
  const onMention = useCallback((name: string) => go({ to: "panel", panel: { kind: "person", name } }), [go])
  const onTask = useCallback((task: number) => go({ to: "panel", panel: { kind: "task", task } }), [go])
  const copied = useCallback(() => toast("Copied"), [toast])
  return (
    <div className="msg-text">
      {!shown && !parsedFor(markdown) && <p className="md-plain">{named(text, names)}</p>}
      <Suspense fallback={null}>
        <Markdown markdown={markdown} onMention={onMention} onTask={onTask} onMessage={onMessage} onImage={onImage} onShown={onShown} copied={copied} />
      </Suspense>
    </div>
  )
}

function Clamp({ on, children }: { on: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    if (!on || !el) return
    const check = () => setOver(el.scrollHeight > CLAMP_PX + 44)
    check()
    const watch = new ResizeObserver(check)
    for (const child of el.children) watch.observe(child)
    watch.observe(el)
    return () => watch.disconnect()
  }, [on])
  if (!on) return <>{children}</>
  return (
    <>
      <div ref={box} className={cx("msg-clamp", over && !open && "is-clamped")}>
        {children}
      </div>
      {over && (
        <button type="button" className="msg-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  )
}

function Spot({ code, img }: { code: string; img: ImageSpot }) {
  const { actions } = useAct()
  const at = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = at.current
    if (img.state !== "waiting" || !el) return
    if (typeof IntersectionObserver === "undefined") return void actions.loadImage(code, img.spot)
    const watch = new IntersectionObserver(
      (seen) => {
        if (!seen.some((e) => e.isIntersecting)) return
        watch.disconnect()
        actions.loadImage(code, img.spot)
      },
      { rootMargin: "400px 0px" }
    )
    watch.observe(el)
    return () => watch.disconnect()
  }, [actions, code, img.spot, img.state])
  if (img.state === "failed")
    return (
      <button type="button" className="msg-image-spot is-failed" title={img.alt} onClick={() => actions.loadImage(code, img.spot)}>
        Couldn't load image. Retry
      </button>
    )
  return (
    <span ref={at} className="msg-image-spot" title={img.alt} role="status">
      {img.state === "gone" ? "Image no longer available" : "Loading image…"}
    </span>
  )
}

function Earlier() {
  return (
    <p className="msg-quote is-earlier">
      <Icon name="reply" size={12} />
      <span className="msg-quote-who">Earlier message</span>
      <span className="msg-quote-text">no longer kept here</span>
    </p>
  )
}

function Quote({ quoted, who, names, onClick }: { quoted: Message; who: string; names: ReadonlyMap<string, string>; onClick?: () => void }) {
  const line = useMemo(() => withNames(quoted.text, names, preview), [quoted.text, names])
  return (
    <button type="button" className="msg-quote" onClick={onClick} aria-label={`Replying to ${who}: ${line.slice(0, 80)}. Show it`}>
      <Icon name="reply" size={12} />
      <span className="msg-quote-who">{who}</span>
      <span className="msg-quote-text">{line || (quoted.images?.length ? "an image" : "…")}</span>
    </button>
  )
}

interface RowProps {
  channel: Channel
  m: Message
  compact: boolean
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  inThread?: boolean
  quote?: Message | number
  onQuote?: (seq: number) => void
}

const face = (p: Person | undefined): string => (p ? [p.kind, p.harness, p.presence, p.color, p.role, p.runs].join("\n") : "")

const chip = (c: Channel, id: number | undefined): string => {
  const t = id === undefined ? undefined : c.tasks.find((t) => t.id === id)
  return t ? [t.status, t.title, t.owner, t.pr?.number].join("\n") : ""
}

function sameRow(a: RowProps, b: RowProps): boolean {
  if (a.m !== b.m || a.compact !== b.compact || a.names !== b.names || a.tasks !== b.tasks || a.inThread !== b.inThread || a.quote !== b.quote || a.onQuote !== b.onQuote) return false
  const x = a.channel
  const y = b.channel
  if (x === y) return true
  const { from, ask, task } = b.m
  return (
    x.code === y.code &&
    x.you === y.you &&
    face(memberOf(x, from)) === face(memberOf(y, from)) &&
    (ask === undefined || x.asks.find((k) => k.id === ask) === y.asks.find((k) => k.id === ask)) &&
    chip(x, task) === chip(y, task)
  )
}

export const MessageRow = memo(function MessageRow({ channel, m, compact, names, tasks, inThread, quote, onQuote }: RowProps) {
  const { actions, go, toast } = useAct()
  const replying = useReplying()
  const [image, setImage] = useState<{ url: string; alt: string } | null>(null)
  const openImage = useCallback((url: string, alt: string) => setImage({ url, alt }), [])
  const openMessage = useCallback(
    (seq: number) => {
      if (onQuote) return onQuote(seq)
      go({ to: "panel", panel: { kind: "thread", seq: channel.messages.find((x) => x.seq === seq)?.inThread ?? seq } })
    },
    [onQuote, go, channel.messages]
  )
  const who = memberOf(channel, m.from)
  const editing = useEditing(channel.code, m.seq)
  const ask = m.ask ? channel.asks.find((a) => a.id === m.ask) : undefined

  if (m.system)
    return (
      <p className={cx("sys", m.leftOut && "is-left-out")} data-seq={m.seq}>
        <span className="sys-line" />
        <span className="sys-text">{m.text}</span>
        <time>{clock(m.at)}</time>
        {m.leftOut && <span className="left-out-why">{m.leftOut}</span>}
      </p>
    )

  const onMenu = (e: MouseEvent<HTMLElement>) => {
    if (m.pending || m.failed !== undefined || m.leftOut || m.deleted || editing) return
    const target = e.target
    const reply = replying && m.where.kind !== "theirs" ? () => replying.set(m) : null
    showMenu(e, "Message", (x) => x.messageGroups({ channel, go, toast }, m, target, { openImage, reply, inThread: !!inThread }))
  }

  return (
    <article
      onContextMenu={onMenu}
      className={cx("msg", compact && "is-compact", m.mentionsYou && "is-for-you", m.pending && "is-pending", m.failed !== undefined && "is-failed", m.leftOut && "is-left-out")}
      data-seq={m.seq}
      aria-label={`${nickname(channel, m.from)}, ${clock(m.at)}`}
    >
      <div className="msg-gutter">
        {compact ? (
          <time className="msg-time-hover" dateTime={new Date(m.at).toISOString()}>
            {clock(m.at)}
          </time>
        ) : (
          <Avatar person={who} />
        )}
      </div>
      <div className="msg-body">
        {!compact && (
          <p className="msg-head">
            <button
              type="button"
              className="msg-name"
              onClick={() => go({ to: "panel", panel: { kind: "person", name: m.from } })}
              onContextMenu={(e) => who && showMenu(e, nickname(channel, m.from), (x) => [x.personItems({ channel, go, toast }, who)])}
            >
              {nickname(channel, m.from)}
            </button>
            {who?.role && who.role.toLowerCase() !== nickname(channel, m.from).toLowerCase() && <span className="msg-role">{who.role}</span>}
            {who?.runs && <span className="msg-runs">{who.runs}</span>}
            {m.said && <span className={cx("msg-said", `is-${m.said.tone}`)}>{m.said.text}</span>}
            <time className="msg-time" dateTime={new Date(m.at).toISOString()}>
              {clock(m.at)}
            </time>
            {m.edited !== undefined && (
              <span className="msg-edited" title={`Edited ${clock(m.edited)}`}>
                edited
              </span>
            )}
          </p>
        )}
        {typeof quote === "number" ? <Earlier /> : quote && <Quote quoted={quote} who={nickname(channel, quote.from)} names={names} onClick={onQuote ? () => onQuote(quote.seq) : undefined} />}
        {m.deleted ? (
          <p className="msg-deleted">Message deleted</p>
        ) : editing ? (
          <Suspense fallback={null}>
            <Changes kind="editor" channel={channel} m={m} />
          </Suspense>
        ) : (
          <Clamp on={who?.kind === "agent" && !inThread}>{m.text && <Body text={m.text} seq={m.seq} names={names} tasks={tasks} onImage={openImage} onMessage={openMessage} />}</Clamp>
        )}
        {compact && m.edited !== undefined && !editing && (
          <span className="msg-edited" title={`Edited ${clock(m.edited)}`}>
            edited
          </span>
        )}
        {m.images && (
          <div className="msg-images">
            {m.images.map((img) =>
              "spot" in img ? (
                <Spot key={img.spot} code={channel.code} img={img} />
              ) : (
                <button key={img.url} type="button" className="msg-image" aria-label={`Open ${img.alt || "image"}`} onClick={() => openImage(img.url, img.alt)}>
                  <img src={img.url} alt={img.alt} width={img.width || undefined} height={img.height || undefined} />
                </button>
              )
            )}
          </div>
        )}
        {m.leftOut && <p className="msg-left-out left-out-why">{m.leftOut}</p>}
        {m.failed !== undefined && (
          <p className="msg-failed" role="status" title={m.failed}>
            Couldn't send
            <button type="button" className="msg-failed-act" onClick={() => actions.retry(channel.code, m.seq)}>
              Retry
            </button>
            <button type="button" className="msg-failed-act" onClick={() => actions.discard(channel.code, m.seq)}>
              Delete
            </button>
          </p>
        )}
        {m.task !== undefined && <TaskChip channel={channel} id={m.task} />}
        {m.prs?.map((pr) => (
          <PrChip key={pr.url} pr={pr} />
        ))}
        {ask?.kind === "permission" && (
          <Suspense fallback={null}>
            <PermissionCard channel={channel} ask={ask} />
          </Suspense>
        )}
        {ask?.kind === "question" && (
          <Suspense fallback={null}>
            <QuestionCard channel={channel} ask={ask} />
          </Suspense>
        )}
        {(m.reactions?.length ?? 0) > 0 && (
          <div className="reacts">
            {m.reactions?.map((r) =>
              isGifReaction(r.emoji) ? (
                <Suspense key={r.emoji} fallback={null}>
                  <Gifs channel={channel} m={m} r={r} />
                </Suspense>
              ) : (
                <button
                  key={r.emoji}
                  type="button"
                  className={cx("react", r.by.includes(channel.you) && "is-mine")}
                  title={r.by.map((b) => nickname(channel, b)).join(", ")}
                  aria-pressed={r.by.includes(channel.you)}
                  disabled={m.where.kind === "theirs"}
                  onClick={() => actions.react(channel.code, m.seq, r.emoji)}
                >
                  {r.emoji} <span className="num">{r.by.length}</span>
                </button>
              )
            )}
          </div>
        )}
        {m.receipt && (
          <p className="msg-receipt" aria-live="polite">
            {m.receipt}
          </p>
        )}
        {m.thread && !inThread && (
          <button type="button" className="msg-thread" onClick={() => go({ to: "panel", panel: { kind: "thread", seq: m.seq } })}>
            <span className="msg-thread-n">
              {m.thread.replies} {m.thread.replies === 1 ? "reply" : "replies"}
            </span>
            <span className="dim">
              {m.thread.people.map((p) => nickname(channel, p)).join(", ")} · {ago(m.thread.last)}
            </span>
          </button>
        )}
      </div>
      {!m.pending && m.failed === undefined && !m.leftOut && !m.deleted && !editing && (
        <div className="msg-tools" role="toolbar" aria-label="Message actions">
          {m.where.kind !== "theirs" &&
            QUICK.map((e) => (
              <button key={e} type="button" className="msg-tool" aria-label={`React ${e}`} onClick={() => actions.react(channel.code, m.seq, e)}>
                {e}
              </button>
            ))}
          {m.where.kind !== "theirs" && (
            <Suspense fallback={null}>
              <Gifs channel={channel} m={m} />
            </Suspense>
          )}
          {m.canChange && (
            <Suspense fallback={null}>
              <Changes kind="tools" channel={channel} m={m} />
            </Suspense>
          )}
          {replying && m.where.kind !== "theirs" && (
            <button type="button" className="msg-tool" aria-label="Reply" title="Reply" onClick={() => replying.set(m)}>
              <Icon name="reply" size={14} />
            </button>
          )}
          {!inThread && (
            <button type="button" className="msg-tool" aria-label="Open thread" title="Open thread" onClick={() => go({ to: "panel", panel: { kind: "thread", seq: m.inThread ?? m.seq } })}>
              <Icon name="thread" size={14} />
            </button>
          )}
          <button
            type="button"
            className="msg-tool"
            aria-label="Copy text"
            title="Copy text"
            onClick={() =>
              void navigator.clipboard?.writeText(m.text).then(
                () => toast("Copied"),
                () => {}
              )
            }
          >
            <Icon name="copy" size={14} />
          </button>
        </div>
      )}
      {image && (
        <Suspense fallback={null}>
          <Annotator
            image={image}
            sender={nickname(channel, m.from)}
            face={who}
            at={m.at}
            onSend={
              channel.people.find((p) => p.you)?.readOnly || m.where.kind === "theirs"
                ? undefined
                : (note, upload) => actions.send(channel.code, m.where, note || upload.name, { replyTo: m.seq, ...(m.inThread !== undefined ? { inThread: m.inThread } : {}), images: [upload] })
            }
            onClose={() => setImage(null)}
          />
        </Suspense>
      )}
    </article>
  )
}, sameRow)
