import { lazy, memo, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"

import { isGifReaction } from "@kiwi/core/protocol.ts"

import { ShownImage } from "~/chat/feed-image"
import { withoutMediaNames } from "~/chat/doc/finished"
import { PrChip, TaskChip } from "~/chat/cards"
import { EditHere, useEditing } from "~/chat/editing"
import { quotedExcerpt } from "~/chat/quote"
import { preview, useReplying } from "~/chat/reply"
import { Body } from "~/chat/body"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { clock } from "~/kit/time"
import { memberOf, type Channel, type Image, type ImageSpot, type Message, type Person } from "~/model"
import { openMessage as showMessage } from "~/live/open-message"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { wordsPlain, wordsRaw, wrote } from "~/words"
import { withNames } from "~/chat/linked"
import { showMenu } from "~/kit/menu-open"
import { later } from "~/kit/later"
import { copyText } from "~/kit/toasts"

const Annotator = lazy(() => import("~/chat/annotator"))
const Gifs = lazy(() => import("~/chat/gif-picker"))
const Changes = lazy(() => import("~/chat/changes"))
const PermissionCard = lazy(() => import("~/chat/permission-card"))
const QuestionCard = lazy(() => import("~/chat/question-card"))
const SpecCard = later(() => import("~/specs/card").then((m) => m.SpecCard))
const BlockFilesView = later(() => import("~/chat/block-files").then((m) => m.BlockFilesView))

const QUICK = ["👍", "🔥", "👀", "✅"]
const CLAMP_PX = 12 * 22

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

export function MessageImages({ code, images, open }: { code: string; images: readonly (Image | ImageSpot)[]; open: (url: string, alt: string) => void }) {
  return <div className="msg-images">{images.map((img) => ("spot" in img ? <Spot key={img.spot} code={code} img={img} /> : <ShownImage key={img.url} image={img} open={open} />))}</div>
}

function Quote({ quoted, who, names, excerpt, onClick }: { quoted: Message; who: string; names: ReadonlyMap<string, string>; excerpt: string | null; onClick?: () => void }) {
  const line = useMemo(() => withNames(wordsRaw(quoted.text), names, preview), [quoted.text, names])
  if (excerpt)
    return (
      <button type="button" className="msg-quote is-excerpt" onClick={onClick} aria-label={`Quoting ${who}: ${excerpt.slice(0, 80)}. Show it`}>
        <span className="msg-quote-who">{who}</span>
        <span className="msg-quote-text">{excerpt}</span>
      </button>
    )
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
  older?: boolean
}

const face = (p: Person | undefined): string => (p ? [p.kind, p.harness, p.presence, p.color, p.role, p.runs].join("\n") : "")

const chip = (c: Channel, id: number | undefined): string => {
  const t = id === undefined ? undefined : c.tasks.find((t) => t.id === id)
  return t ? [t.status, wordsRaw(t.title), t.owner, t.pr?.number].join("\n") : ""
}

export function sameRow(a: RowProps, b: RowProps): boolean {
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

export const MessageRow = memo(function MessageRow({ channel, m, compact, names, tasks, inThread, quote, onQuote, older }: RowProps) {
  const { actions, go } = useAct()
  const replying = useReplying()
  const [image, setImage] = useState<{ url: string; alt: string } | null>(null)
  const openImage = useCallback((url: string, alt: string) => setImage({ url, alt }), [])
  const openMessage = useCallback(
    (seq: number) => {
      if (onQuote) return onQuote(seq)
      showMessage(channel.code, seq)
    },
    [onQuote, channel.code]
  )
  const quoting = !!replying && m.where.kind !== "theirs"
  const who = memberOf(channel, m.from)
  const at = useContext(EditHere)
  const editing = useEditing(channel.code, m.seq)
  const ask = m.ask ? channel.asks.find((a) => a.id === m.ask) : undefined
  const spec = channel.specs?.find((s) => s.ask === m.seq)
  const cited = useMemo(() => (typeof quote === "object" ? quotedExcerpt(m, quote) : null), [m, quote])
  const said = cited ? cited.rest : wordsRaw(m.text)
  const body = m.docMedia ? withoutMediaNames(said, m.docMedia) : said

  if (m.system)
    return (
      <p className={cx("sys", m.leftOut && "is-left-out")} data-seq={m.seq}>
        <span className="sys-line" />
        <span className="sys-text">{wordsPlain(m.text, names)}</span>
        <time>{clock(m.at)}</time>
        {m.leftOut && <span className="left-out-why">{m.leftOut}</span>}
      </p>
    )

  const onMenu = (e: MouseEvent<HTMLElement>) => {
    if (m.pending || m.failed !== undefined || m.leftOut || m.fromDoc || m.deleted || editing) return
    const target = e.target
    const reply = replying && quoting ? () => replying.set(m) : null
    showMenu(e, "Message", (x) => x.messageGroups({ channel, go }, m, target, { openImage, reply, at }))
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
              title={who?.role && who.role.toLowerCase() !== nickname(channel, m.from).toLowerCase() ? who.role : undefined}
              onClick={() => go({ to: "modal", modal: { kind: "person", name: m.from } })}
              onContextMenu={(e) => who && showMenu(e, nickname(channel, m.from), (x) => [x.personItems({ channel, go }, who)])}
            >
              {nickname(channel, m.from)}
            </button>
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
        {typeof quote === "object" && (
          <Quote quoted={quote} who={nickname(channel, quote.from)} names={names} excerpt={cited?.excerpt ?? null} onClick={onQuote ? () => onQuote(quote.seq) : undefined} />
        )}
        {m.deleted ? (
          <p className="msg-deleted">Message deleted</p>
        ) : editing ? (
          <Suspense fallback={null}>
            <Changes kind="editor" channel={channel} m={m} />
          </Suspense>
        ) : (
          <Clamp on={who?.kind === "agent" && !inThread}>{body && <Body text={wrote(body)} seq={m.seq} names={names} tasks={tasks} onImage={openImage} onMessage={openMessage} />}</Clamp>
        )}
        {compact && m.edited !== undefined && !editing && (
          <span className="msg-edited" title={`Edited ${clock(m.edited)}`}>
            edited
          </span>
        )}
        {m.images && <MessageImages code={channel.code} images={m.images} open={openImage} />}
        {m.docMedia && (
          <Suspense fallback={null}>
            <BlockFilesView code={channel.code} media={m.docMedia} open={openImage} />
          </Suspense>
        )}
        {m.leftOut && <p className="msg-left-out left-out-why">{m.leftOut}</p>}
        {m.failed !== undefined && (
          <p className="msg-failed" role="status" title={m.failed}>
            Couldn't send
            <button type="button" className="msg-failed-act" onClick={() => actions.retry(channel.code, m.seq)}>
              Retry
            </button>
            <button type="button" className="msg-failed-act" onClick={() => actions.discard(channel.code, m.seq)}>
              {m.block !== undefined ? "Back to draft" : "Delete"}
            </button>
          </p>
        )}
        {m.task !== undefined && <TaskChip channel={channel} id={m.task} />}
        {spec && !inThread && (
          <Suspense fallback={null}>
            <SpecCard channel={channel} spec={spec} />
          </Suspense>
        )}
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
      </div>
      {!m.pending && m.failed === undefined && !m.leftOut && !m.fromDoc && !m.deleted && !editing && (
        <div className="msg-tools" role="toolbar" aria-label="Message actions">
          {m.where.kind !== "theirs" &&
            QUICK.map((e) => (
              <button key={e} type="button" className="msg-tool" aria-label={`React ${e}`} onClick={() => actions.react(channel.code, m.seq, e)}>
                {e}
              </button>
            ))}
          {m.where.kind !== "theirs" && !older && (
            <Suspense fallback={null}>
              <Gifs channel={channel} m={m} />
            </Suspense>
          )}
          {m.canChange && (
            <Suspense fallback={null}>
              <Changes kind="tools" channel={channel} m={m} />
            </Suspense>
          )}
          {replying && quoting && (
            <button type="button" className="msg-tool" aria-label="Reply" title="Reply" onClick={() => replying.set(m)}>
              <Icon name="reply" size={14} />
            </button>
          )}
          <button type="button" className="msg-tool" aria-label="Copy text" title="Copy text" onClick={() => copyText(wordsRaw(m.text))}>
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
