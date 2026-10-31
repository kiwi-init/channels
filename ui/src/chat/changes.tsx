import { Delete02Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { startEditing, stopEditing } from "~/chat/editing"
import { Dialog, DialogHead } from "~/kit/bits"
import { GlyphIcon } from "~/kit/icons"
import type { Channel, Message } from "~/model"
import { useAct } from "~/nav"

type Props = { kind: "tools" | "editor"; channel: Channel; m: Message }

export default function Changes({ kind, channel, m }: Props) {
  return kind === "tools" ? <Tools channel={channel} m={m} /> : <Editor channel={channel} m={m} />
}

function Tools({ channel, m }: { channel: Channel; m: Message }) {
  const { actions } = useAct()
  const [asking, setAsking] = useState(false)
  return (
    <>
      <button type="button" className="msg-tool" aria-label="Edit" title="Edit" onClick={() => startEditing(channel.code, m.seq)}>
        <GlyphIcon glyph={PencilEdit02Icon} size={14} />
      </button>
      <button type="button" className="msg-tool" aria-label="Delete" title="Delete" onClick={() => setAsking(true)}>
        <GlyphIcon glyph={Delete02Icon} size={14} />
      </button>
      {createPortal(
        <Dialog open={asking} onClose={() => setAsking(false)} label="Delete this message?">
          <DialogHead
            title="Delete this message?"
            sub="It's removed from Channels for everyone. Anyone who already read it may still have it, and the relay keeps its encrypted copy until it ages out."
            onClose={() => setAsking(false)}
          />
          <div className="dialog-foot">
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn is-danger"
              onClick={() => {
                setAsking(false)
                actions.deleteMessage(channel.code, m.seq)
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>,
        document.body
      )}
    </>
  )
}

function Editor({ channel, m }: { channel: Channel; m: Message }) {
  const { actions } = useAct()
  const [text, setText] = useState(m.text)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const save = () => {
    const next = text.trim()
    if (next && next !== m.text.trim()) actions.editMessage(channel.code, m.seq, next)
    stopEditing()
  }
  return (
    <div className="msg-edit">
      <textarea
        ref={area}
        className="input msg-edit-text"
        aria-label="Edit message"
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === "Escape") {
            e.preventDefault()
            stopEditing()
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            save()
          }
        }}
      />
      <p className="msg-edit-foot">
        <span className="dim">Enter to save · Esc to cancel</span>
        <button type="button" className="btn is-quiet is-small" onClick={stopEditing}>
          Cancel
        </button>
        <button type="button" className="btn is-primary is-small" disabled={!text.trim()} onClick={save}>
          Save
        </button>
      </p>
    </div>
  )
}
