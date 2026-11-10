import "~/i18n/en/specs"
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from "react"

import { AttachedFiles, DropHint, IMAGE_TYPES, useAttach } from "~/chat/attach"
import { preview } from "~/chat/preview"
import { withExcerpt } from "~/chat/quote"
import { composing, sendsOn, sendTitle, type SendKey } from "~/chat/send-keys"
import { listId, Suggestions, useSuggest } from "~/chat/suggest"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel, Message, SendExtras, Spec, Upload, Where } from "~/model"
import { nickname } from "~/names"
import { useAct, useAppPrefs } from "~/nav"
import { splitQuote } from "~/specs/read"
import { wordsRaw } from "~/words"

function whereOf(channel: Channel, ask: number): Where {
  return channel.messages.find((m) => m.seq === ask)?.where ?? { kind: "room", room: "general" }
}

function quoted(quote: string, text: string): string {
  return `${quote
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}\n\n${text.trim()}`
}

export interface CommentReply {
  to: Message
  excerpt: string | null
}

export function commentOf(ask: number, text: string, files: readonly Upload[], quote?: string, reply?: CommentReply | null): { text: string; extras: SendExtras } | null {
  if (!text.trim() && !files.length) return null
  const said = reply?.excerpt ? withExcerpt(reply.excerpt, text) : quote ? quoted(quote, text) : text.trim()
  return { text: said, extras: { inThread: ask, ...(reply ? { replyTo: reply.to.seq } : {}), ...(files.length ? { images: [...files] } : {}) } }
}

type Key = SendKey & { preventDefault(): void }

export function commentKeys(enterSends: boolean, send: () => void, cancel?: () => void): (e: Key) => void {
  return (e) => {
    if (sendsOn(e, enterSends)) {
      e.preventDefault()
      send()
      return
    }
    if (e.key === "Escape" && cancel) {
      e.preventDefault()
      cancel()
    }
  }
}

export function CommentBox({
  channel,
  spec,
  quote,
  reply,
  onUnreply,
  onDone,
}: {
  channel: Channel
  spec: Spec
  quote?: string
  reply?: CommentReply | null
  onUnreply?: () => void
  onDone?: () => void
}) {
  const { actions, toast } = useAct()
  const enterSends = useAppPrefs().enterSends
  const [text, setText] = useState("")
  const [files, setFiles] = useState<Upload[]>([])
  const box = useRef<HTMLTextAreaElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const zone = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const typed = (value: string, at: number) => {
    setText(value)
    s.moved(at)
  }
  const s = useSuggest({ channel, id: `spec:${channel.code}:${spec.ask}${quote ? ":quote" : ""}`, text, area: box, onText: typed, withFormer: true })
  const { attach, paste, reading, dropping, dropZone } = useAttach({ files, setFiles, zone, toast })
  useEffect(() => {
    if (quote || reply) box.current?.focus()
  }, [quote, reply])
  useLayoutEffect(() => {
    const el = box.current
    const hold = field.current
    if (!el || !hold) return
    hold.style.minHeight = `${hold.offsetHeight}px`
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
    hold.style.minHeight = ""
  }, [text])
  const ready = !reading && !!commentOf(spec.ask, text, files)
  const send = () => {
    const comment = reading ? null : commentOf(spec.ask, s.sent(text.trim()), files, quote, reply)
    if (!comment) return
    actions.send(channel.code, whereOf(channel, spec.ask), comment.text, comment.extras)
    s.forget()
    typed("", 0)
    setFiles([])
    if (reply) onUnreply?.()
    onDone?.()
  }
  const sendKeys = commentKeys(enterSends, send, reply ? onUnreply : onDone)
  const title = sendTitle(enterSends)
  const who = reply ? nickname(channel, reply.to.from) : ""
  const line = reply ? (reply.excerpt ?? preview(splitQuote(wordsRaw(reply.to.text)).text)).replace(/\s+/g, " ") : ""
  return (
    <div ref={zone} className={cx("spec-box-new", quote && "is-anchored", dropping && "is-dropping")} {...dropZone}>
      {dropping && <DropHint />}
      {quote && <p className="spec-comment-quote">{quote}</p>}
      {reply && !quote && (
        <div className={cx("compose-reply", reply.excerpt && "is-excerpt")}>
          <Icon name="reply" size={13} />
          <span className="compose-reply-text">
            {tr(reply.excerpt ? "specs.comment.quoting" : "specs.comment.replying.to", { who: <b>{who}</b> })}{" "}
            <span className={reply.excerpt ? "compose-reply-excerpt" : "dim"}>{reply.excerpt ? `“${line.slice(0, 160)}${line.length > 160 ? "…" : ""}”` : line.slice(0, 160)}</span>
          </span>
          <button type="button" className="compose-reply-x" aria-label={t("specs.comment.cancel.reply")} title={t("specs.comment.cancel.reply.title")} onClick={onUnreply}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
      <Suggestions channel={channel} s={s} />
      <div ref={field} className="spec-box-field">
        <textarea
          ref={box}
          className="textarea spec-box-text"
          rows={quote ? 3 : 1}
          value={text}
          placeholder={
            quote ? t("specs.comment.placeholder.quote") : reply ? (reply.excerpt ? t("specs.comment.placeholder.excerpt") : t("specs.comment.reply.to", { who })) : t("specs.comment.placeholder")
          }
          title={quote ? undefined : t("specs.comment.select.hint")}
          aria-label={quote ? t("specs.comment.label.quote") : reply ? t("specs.comment.reply.to", { who }) : t("specs.comment.label.spec")}
          aria-autocomplete="list"
          aria-expanded={s.count > 0}
          aria-controls={listId(s)}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => typed(e.target.value, e.target.selectionStart)}
          onSelect={(e: SyntheticEvent<HTMLTextAreaElement>) => s.moved(e.currentTarget.selectionStart)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (composing(e) || s.keys(e)) return
            sendKeys(e)
          }}
          onPaste={paste}
        />
        <button type="button" className="spec-box-attach" aria-label={t("specs.comment.add.image")} title={t("specs.comment.add.image")} onClick={() => picker.current?.click()}>
          <Icon name="image" size={16} />
        </button>
        <input
          ref={picker}
          type="file"
          accept={[...IMAGE_TYPES].join(",")}
          multiple
          hidden
          onChange={(e) => {
            attach([...(e.target.files ?? [])])
            e.target.value = ""
          }}
        />
      </div>
      <AttachedFiles files={files} onRemove={(i) => setFiles((now) => now.filter((_, j) => j !== i))} />
      {(quote || ready) && (
        <div className="spec-box-foot">
          {onDone && quote && (
            <button type="button" className="btn is-quiet is-small" onClick={onDone}>
              {t("specs.comment.cancel")}
            </button>
          )}
          <button type="button" className={cx("btn", quote && "is-small")} title={title} disabled={!ready} onClick={send}>
            {reply && !quote ? t("specs.comment.reply") : t("specs.comment.comment")}
          </button>
        </div>
      )}
    </div>
  )
}
