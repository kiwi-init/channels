import "~/i18n/en/modals"

import { useId, useState } from "react"

import { t } from "~/i18n/i18n"
import type { Channel } from "~/model"
import { useApp } from "~/nav"

const REPO = /^[\w.-]+\/[\w.-]+$/

function SaveBar({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="csheet-save">
      <button type="button" className="btn is-quiet is-small" onClick={onCancel}>
        {t("modals.channel.settings.cancel")}
      </button>
      <button type="submit" className="btn is-small">
        {t("modals.channel.settings.save")}
      </button>
    </div>
  )
}

export function Edit({ value, label, onSave, onDone }: { value: string; label: string; onSave: (value: string) => void; onDone: () => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <form
      className="set-inline"
      onSubmit={(e) => {
        e.preventDefault()
        const next = draft.trim()
        if (next && next !== value) onSave(next)
        onDone()
      }}
    >
      <input
        autoFocus
        className="input is-mono set-inline-input"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.preventDefault()
          e.stopPropagation()
          onDone()
        }}
      />
      <button type="button" className="btn is-quiet is-small" onClick={onDone}>
        {t("modals.channel.settings.cancel")}
      </button>
      <button type="submit" className="btn is-small" disabled={!draft.trim()}>
        {t("modals.channel.settings.save")}
      </button>
    </form>
  )
}

export function GoalEditor({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const [draft, setDraft] = useState(channel.goal ?? "")
  const changed = draft.trim() !== (channel.goal ?? "")
  return (
    <form
      className="csheet-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (changed) app.actions.setGoal(channel.code, draft.trim())
      }}
    >
      <textarea
        className="textarea"
        aria-label={t("modals.channel.settings.goal")}
        placeholder={t("modals.channel.settings.goal.placeholder")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
      />
      {changed && <SaveBar onCancel={() => setDraft(channel.goal ?? "")} />}
    </form>
  )
}

export function HoldNote({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const saved = channel.hold?.note ?? ""
  const [note, setNote] = useState(saved)
  const changed = note.trim() !== saved
  return (
    <form
      className="csheet-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (changed) app.actions.setHold(channel.code, true, note.trim() || undefined)
        e.currentTarget.querySelector("input")?.blur()
      }}
    >
      <input
        className="input"
        aria-label={t("modals.channel.settings.pause.note")}
        placeholder={t("modals.channel.settings.pause.note.placeholder")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {changed && <SaveBar onCancel={() => setNote(saved)} />}
    </form>
  )
}

export function RepoAdd({ channel, offer }: { channel: Channel; offer: readonly string[] }) {
  const { app } = useApp()
  const [draft, setDraft] = useState("")
  const listId = useId()
  const valid = REPO.test(draft.trim())
  return (
    <form
      className="csheet-add"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        app.actions.addRepo(channel.code, draft.trim())
        setDraft("")
      }}
    >
      <input
        className="input is-mono"
        placeholder={t("modals.channel.settings.repo.placeholder")}
        aria-label={t("modals.channel.settings.repo.add.label")}
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <datalist id={listId}>
        {offer.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <button type="submit" className="btn is-small" disabled={!valid}>
        {t("modals.channel.settings.repo.add")}
      </button>
    </form>
  )
}
