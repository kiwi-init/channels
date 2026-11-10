import "~/i18n/en/chat-later"
import { Delete02Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { useContext, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { askDelete, EditHere, startEditing, stopAskingDelete, stopEditing, useAskingDelete } from "~/chat/editing"
import { t } from "~/i18n/i18n"
import { Confirm } from "~/kit/confirm"
import { GlyphIcon } from "~/kit/icons"
import type { Channel, Message } from "~/model"
import { useAct } from "~/nav"
import { wordsRaw } from "~/words"

type Props = { kind: "tools" | "editor"; channel: Channel; m: Message }

export default function Changes({ kind, channel, m }: Props) {
  return kind === "tools" ? <Tools channel={channel} m={m} /> : <Editor channel={channel} m={m} />
}

function Tools({ channel, m }: { channel: Channel; m: Message }) {
  const { actions } = useAct()
  const asking = useAskingDelete(channel.code, m.seq)
  const at = useContext(EditHere)
  return (
    <>
      <button type="button" className="msg-tool" aria-label={t("chat.changes.edit")} title={t("chat.changes.edit")} onClick={() => startEditing(channel.code, m.seq, at)}>
        <GlyphIcon glyph={PencilEdit02Icon} size={14} />
      </button>
      <button type="button" className="msg-tool" aria-label={t("chat.changes.delete")} title={t("chat.changes.delete")} onClick={() => askDelete(channel.code, m.seq)}>
        <GlyphIcon glyph={Delete02Icon} size={14} />
      </button>
      {createPortal(
        <Confirm
          open={asking}
          onClose={stopAskingDelete}
          title={t("chat.changes.delete.ask")}
          sub={t("chat.changes.delete.sub")}
          action={t("chat.changes.delete")}
          onConfirm={() => {
            stopAskingDelete()
            actions.deleteMessage(channel.code, m.seq)
          }}
        />,
        document.body
      )}
    </>
  )
}

function Editor({ channel, m }: { channel: Channel; m: Message }) {
  const { actions } = useAct()
  const [text, setText] = useState(wordsRaw(m.text))
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const save = () => {
    const next = text.trim()
    if (next && next !== wordsRaw(m.text).trim()) actions.editMessage(channel.code, m.seq, next)
    stopEditing()
  }
  return (
    <div className="msg-edit">
      <textarea
        ref={area}
        className="input msg-edit-text"
        aria-label={t("chat.changes.edit.message")}
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
        <span className="dim">{t("chat.changes.edit.keys")}</span>
        <button type="button" className="btn is-quiet is-small" onClick={stopEditing}>
          {t("chat.changes.cancel")}
        </button>
        <button type="button" className="btn is-primary is-small" disabled={!text.trim()} onClick={save}>
          {t("chat.changes.save")}
        </button>
      </p>
    </div>
  )
}
