import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from "react"

import { composing, sendsOn, sendTitle, type SendKey } from "~/chat/send-keys"
import { listId, Suggestions, useSuggest } from "~/chat/suggest"
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
  const typed = (value: string, at: number) => {
    setText(value)
    s.moved(at)
  }
  const s = useSuggest({ channel, id: `spec:${channel.code}:${spec.ask}${quote ? ":quote" : ""}`, text, area: box, onText: typed })
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
    const said = s.sent(text.trim())
    actions.send(channel.code, whereOf(channel, spec.ask), quote ? quoted(quote, said) : said, { inThread: spec.ask })
    s.forget()
    typed("", 0)
    onDone?.()
  }
  const sendKeys = commentKeys(enterSends, send, onDone)
  const field = {
    ref: box,
    className: "textarea spec-box-text",
    value: text,
    "aria-autocomplete": "list" as const,
    "aria-expanded": s.count > 0,
    "aria-controls": listId(s),
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => typed(e.target.value, e.target.selectionStart),
    onSelect: (e: SyntheticEvent<HTMLTextAreaElement>) => s.moved(e.currentTarget.selectionStart),
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (composing(e) || s.keys(e)) return
      sendKeys(e)
    },
  }
  const suggest = <Suggestions channel={channel} s={s} />
  const title = sendTitle(enterSends)
  if (!quote)
    return (
      <div className="spec-box-new">
        {suggest}
        <textarea {...field} rows={1} placeholder="Comment" title="Or select words in the spec to comment on them" aria-label="Comment on the spec" />
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
      {suggest}
      <textarea {...field} rows={3} placeholder="Say what's off, or ask about it" aria-label="Comment on the selected words" />
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
