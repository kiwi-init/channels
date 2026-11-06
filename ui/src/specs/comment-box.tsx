import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { sendsOn, sendTitle, type SendKey } from "~/chat/send-keys"
import type { Channel, Spec, Where } from "~/model"
import { useAct, useApp } from "~/nav"

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

export function CommentBox({ channel, spec, quote, onDone }: { channel: Channel; spec: Spec; quote?: string; onDone?: () => void }) {
  const { actions } = useAct()
  const enterSends = useApp().app.prefs.enterSends
  const [text, setText] = useState("")
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (quote) box.current?.focus()
  }, [quote])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [text])
  const send = () => {
    if (!text.trim()) return
    actions.send(channel.code, whereOf(channel, spec.ask), quote ? quoted(quote, text) : text.trim(), { inThread: spec.ask })
    setText("")
    onDone?.()
  }
  const keys = commentKeys(enterSends, send, onDone)
  const title = sendTitle(enterSends)
  if (!quote)
    return (
      <div className="spec-box-new">
        <textarea
          ref={box}
          className="textarea spec-box-text"
          rows={1}
          value={text}
          placeholder="Comment"
          title="Or select words in the spec to comment on them"
          aria-label="Comment on the spec"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keys}
        />
        {text.trim() && (
          <div className="spec-box-foot">
            <button type="button" className="btn" title={title} onClick={send}>
              Comment
            </button>
          </div>
        )}
      </div>
    )
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
