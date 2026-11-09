import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from "react"

import { AttachedFiles, DropHint, IMAGE_TYPES, useAttach } from "~/chat/attach"
import { composing, sendsOn, sendTitle, type SendKey } from "~/chat/send-keys"
import { listId, Suggestions, useSuggest } from "~/chat/suggest"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel, SendExtras, Spec, Upload, Where } from "~/model"
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

export function commentOf(ask: number, text: string, files: readonly Upload[], quote?: string): { text: string; extras: SendExtras } | null {
  if (!text.trim() && !files.length) return null
  return { text: quote ? quoted(quote, text) : text.trim(), extras: { inThread: ask, ...(files.length ? { images: [...files] } : {}) } }
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
  const { actions, toast } = useAct()
  const enterSends = useApp().app.prefs.enterSends
  const [text, setText] = useState("")
  const [files, setFiles] = useState<Upload[]>([])
  const box = useRef<HTMLTextAreaElement>(null)
  const zone = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const typed = (value: string, at: number) => {
    setText(value)
    s.moved(at)
  }
  const s = useSuggest({ channel, id: `spec:${channel.code}:${spec.ask}${quote ? ":quote" : ""}`, text, area: box, onText: typed })
  const { attach, paste, reading, dropping, dropZone } = useAttach({ files, setFiles, zone, toast })
  useEffect(() => {
    if (quote) box.current?.focus()
  }, [quote])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [text])
  const ready = !reading && !!commentOf(spec.ask, text, files)
  const send = () => {
    const comment = reading ? null : commentOf(spec.ask, s.sent(text.trim()), files, quote)
    if (!comment) return
    actions.send(channel.code, whereOf(channel, spec.ask), comment.text, comment.extras)
    s.forget()
    typed("", 0)
    setFiles([])
    onDone?.()
  }
  const sendKeys = commentKeys(enterSends, send, onDone)
  const title = sendTitle(enterSends)
  return (
    <div ref={zone} className={cx("spec-box-new", quote && "is-anchored", dropping && "is-dropping")} {...dropZone}>
      {dropping && <DropHint />}
      {quote && <p className="spec-comment-quote">{quote}</p>}
      <Suggestions channel={channel} s={s} />
      <div className="spec-box-field">
        <textarea
          ref={box}
          className="textarea spec-box-text"
          rows={quote ? 3 : 1}
          value={text}
          placeholder={quote ? "Say what's off, or ask about it" : "Comment"}
          title={quote ? undefined : "Or select words in the spec to comment on them"}
          aria-label={quote ? "Comment on the selected words" : "Comment on the spec"}
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
        <button type="button" className="spec-box-attach" aria-label="Add an image" title="Add an image" onClick={() => picker.current?.click()}>
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
              Cancel
            </button>
          )}
          <button type="button" className={cx("btn", quote && "is-small")} title={title} disabled={!ready} onClick={send}>
            Comment
          </button>
        </div>
      )}
    </div>
  )
}
