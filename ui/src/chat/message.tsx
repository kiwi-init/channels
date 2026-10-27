import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { PermissionCard, PrChip, QuestionCard, TaskChip } from "~/chat/cards"
import { preview, useReplying } from "~/chat/reply"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago, clock } from "~/kit/time"
import type { Channel, Message } from "~/model"
import { useApp } from "~/nav"

const Markdown = lazy(() => import("~/chat/markdown"))

const QUICK = ["👍", "🔥", "👀", "✅"]
const CLAMP_PX = 12 * 22

function Body({ channel, text, names, onImage }: { channel: Channel; text: string; names: ReadonlySet<string>; onImage: (url: string, alt: string) => void }) {
  const { go, toast } = useApp()
  const [shown, setShown] = useState(false)
  const tasks = useMemo(() => new Set(channel.tasks.map((t) => t.id)), [channel.tasks])
  const onShown = useCallback(() => setShown(true), [])
  const onMention = useCallback((name: string) => go({ to: "panel", panel: { kind: "person", name } }), [go])
  const onTask = useCallback((task: number) => go({ to: "panel", panel: { kind: "task", task } }), [go])
  const copied = useCallback(() => toast("Copied"), [toast])
  return (
    <div className="msg-text">
      {!shown && <p className="md-plain">{text}</p>}
      <Suspense fallback={null}>
        <Markdown text={text} names={names} tasks={tasks} onMention={onMention} onTask={onTask} onImage={onImage} onShown={onShown} copied={copied} />
      </Suspense>
    </div>
  )
}

function Viewer({ image, onClose }: { image: { url: string; alt: string }; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])
  return (
    <dialog ref={ref} className="viewer" aria-label={image.alt || "Image"} onClose={onClose} onClick={onClose}>
      <img src={image.url} alt={image.alt} />
      <button type="button" className="icon-btn viewer-close" aria-label="Close" autoFocus>
        <Icon name="close" />
      </button>
    </dialog>
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

function Quote({ quoted, onClick }: { quoted: Message; onClick?: () => void }) {
  const line = preview(quoted.text)
  return (
    <button type="button" className="msg-quote" onClick={onClick} aria-label={`Replying to ${quoted.from}: ${line.slice(0, 80)}. Show it`}>
      <Icon name="reply" size={12} />
      <span className="msg-quote-who">{quoted.from}</span>
      <span className="msg-quote-text">{line || (quoted.images?.length ? "an image" : "…")}</span>
    </button>
  )
}

export const MessageRow = memo(function MessageRow({
  channel,
  m,
  compact,
  names,
  inThread,
  quote,
  onQuote,
}: {
  channel: Channel
  m: Message
  compact: boolean
  names: Set<string>
  inThread?: boolean
  quote?: Message
  onQuote?: (seq: number) => void
}) {
  const { app, go } = useApp()
  const replying = useReplying()
  const [image, setImage] = useState<{ url: string; alt: string } | null>(null)
  const openImage = useCallback((url: string, alt: string) => setImage({ url, alt }), [])
  const who = channel.people.find((p) => p.name === m.from)
  const ask = m.ask ? channel.asks.find((a) => a.id === m.ask) : undefined

  if (m.system)
    return (
      <p className="sys" data-seq={m.seq}>
        <span className="sys-line" />
        <span>{m.text}</span>
        <time>{clock(m.at)}</time>
      </p>
    )

  return (
    <article
      className={cx("msg", compact && "is-compact", m.mentionsYou && "is-for-you", m.pending && "is-pending", m.failed !== undefined && "is-failed")}
      data-seq={m.seq}
      aria-label={`${m.from}, ${clock(m.at)}`}
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
            <button type="button" className="msg-name" onClick={() => go({ to: "panel", panel: { kind: "person", name: m.from } })}>
              {m.from}
            </button>
            {who?.role && <span className="msg-role">{who.role}</span>}
            {who?.runs && <span className="msg-runs">· {who.runs}</span>}
            <time className="msg-time" dateTime={new Date(m.at).toISOString()}>
              {clock(m.at)}
            </time>
          </p>
        )}
        {quote && <Quote quoted={quote} onClick={onQuote ? () => onQuote(quote.seq) : undefined} />}
        <Clamp on={who?.kind === "agent" && !inThread}>{m.text && <Body channel={channel} text={m.text} names={names} onImage={openImage} />}</Clamp>
        {m.images && (
          <div className="msg-images">
            {m.images.map((img) => (
              <button key={img.url} type="button" className="msg-image" aria-label={`Open ${img.alt || "image"}`} onClick={() => openImage(img.url, img.alt)}>
                <img src={img.url} alt={img.alt} width={img.width} height={img.height} />
              </button>
            ))}
          </div>
        )}
        {m.failed !== undefined && (
          <p className="msg-failed" role="status" title={m.failed}>
            Couldn't send
            <button type="button" className="msg-failed-act" onClick={() => app.actions.retry(channel.code, m.seq)}>
              Retry
            </button>
            <button type="button" className="msg-failed-act" onClick={() => app.actions.discard(channel.code, m.seq)}>
              Delete
            </button>
          </p>
        )}
        {m.task !== undefined && <TaskChip channel={channel} id={m.task} />}
        {m.pr && <PrChip pr={m.pr} />}
        {ask?.kind === "permission" && <PermissionCard channel={channel} ask={ask} />}
        {ask?.kind === "question" && <QuestionCard channel={channel} ask={ask} />}
        {(m.reactions?.length ?? 0) > 0 && (
          <div className="reacts">
            {m.reactions?.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={cx("react", r.by.includes(channel.you) && "is-mine")}
                title={r.by.join(", ")}
                aria-pressed={r.by.includes(channel.you)}
                onClick={() => app.actions.react(channel.code, m.seq, r.emoji)}
              >
                {r.emoji} <span className="num">{r.by.length}</span>
              </button>
            ))}
          </div>
        )}
        {m.thread && !inThread && (
          <button type="button" className="msg-thread" onClick={() => go({ to: "panel", panel: { kind: "thread", seq: m.seq } })}>
            <span className="msg-thread-n">
              {m.thread.replies} {m.thread.replies === 1 ? "reply" : "replies"}
            </span>
            <span className="dim">
              {m.thread.people.join(", ")} · {ago(m.thread.last)}
            </span>
          </button>
        )}
      </div>
      {!m.pending && m.failed === undefined && (
        <div className="msg-tools" role="toolbar" aria-label="Message actions">
          {QUICK.map((e) => (
            <button key={e} type="button" className="msg-tool" aria-label={`React ${e}`} onClick={() => app.actions.react(channel.code, m.seq, e)}>
              {e}
            </button>
          ))}
          {replying && (
            <button type="button" className="msg-tool" aria-label="Reply" title="Reply" onClick={() => replying.set(m)}>
              <Icon name="reply" size={14} />
            </button>
          )}
          {!inThread && (
            <button type="button" className="msg-tool" aria-label="Open thread" title="Open thread" onClick={() => go({ to: "panel", panel: { kind: "thread", seq: m.inThread ?? m.seq } })}>
              <Icon name="thread" size={14} />
            </button>
          )}
          <button type="button" className="msg-tool" aria-label="Copy text" title="Copy text" onClick={() => void navigator.clipboard?.writeText(m.text)}>
            <Icon name="copy" size={14} />
          </button>
        </div>
      )}
      {image && <Viewer image={image} onClose={() => setImage(null)} />}
    </article>
  )
})
