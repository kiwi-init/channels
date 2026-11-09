import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { preview } from "~/chat/preview"
import { withExcerpt } from "~/chat/quote"
import { sendsOn, sendTitle, type SendKey } from "~/chat/send-keys"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel, Message, Spec, Where } from "~/model"
import { nickname } from "~/names"
import { useAct, useApp } from "~/nav"
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

export interface CommentReply {
  to: Message
  excerpt: string | null
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
  const { actions } = useAct()
  const enterSends = useApp().app.prefs.enterSends
  const [text, setText] = useState("")
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (quote || reply) box.current?.focus()
  }, [quote, reply])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [text])
  const send = () => {
    if (!text.trim()) return
    if (reply) {
      actions.send(channel.code, whereOf(channel, spec.ask), reply.excerpt ? withExcerpt(reply.excerpt, text) : text.trim(), { inThread: spec.ask, replyTo: reply.to.seq })
      onUnreply?.()
    } else actions.send(channel.code, whereOf(channel, spec.ask), quote ? quoted(quote, text) : text.trim(), { inThread: spec.ask })
    setText("")
    onDone?.()
  }
  const keys = commentKeys(enterSends, send, reply ? onUnreply : onDone)
  const title = sendTitle(enterSends)
  if (!quote) {
    const who = reply ? nickname(channel, reply.to.from) : ""
    const line = reply ? (reply.excerpt ?? preview(splitQuote(wordsRaw(reply.to.text)).text)).replace(/\s+/g, " ") : ""
    return (
      <div className="spec-box-new">
        {reply && (
          <div className={cx("compose-reply", reply.excerpt && "is-excerpt")}>
            <Icon name="reply" size={13} />
            <span className="compose-reply-text">
              {reply.excerpt ? "Quoting" : "Replying to"} <b>{who}</b>{" "}
              <span className={reply.excerpt ? "compose-reply-excerpt" : "dim"}>{reply.excerpt ? `“${line.slice(0, 160)}${line.length > 160 ? "…" : ""}”` : line.slice(0, 160)}</span>
            </span>
            <button type="button" className="compose-reply-x" aria-label="Cancel reply" title="Cancel reply (Esc)" onClick={onUnreply}>
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <textarea
          ref={box}
          className="textarea spec-box-text"
          rows={1}
          value={text}
          placeholder={reply ? (reply.excerpt ? "Say something about it" : `Reply to ${who}`) : "Comment"}
          title="Or select words in the spec to comment on them"
          aria-label={reply ? `Reply to ${who}` : "Comment on the spec"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keys}
        />
        {text.trim() && (
          <div className="spec-box-foot">
            <button type="button" className="btn" title={title} onClick={send}>
              {reply ? "Reply" : "Comment"}
            </button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="spec-box-new is-anchored">
      <p className="spec-comment-quote">{quote}</p>
      <textarea
        ref={box}
        className="textarea spec-box-text"
        rows={3}
        value={text}
        placeholder="Say what's off, or ask about it"
        aria-label="Comment on the selected words"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      <div className="spec-box-foot">
        {onDone && (
          <button type="button" className="btn is-quiet is-small" onClick={onDone}>
            Cancel
          </button>
        )}
        <button type="button" className="btn is-small" title={title} disabled={!text.trim()} onClick={send}>
          Comment
        </button>
      </div>
    </div>
  )
}
