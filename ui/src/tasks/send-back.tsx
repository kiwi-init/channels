import { useState } from "react"

import { t } from "~/i18n/i18n"

export function SendBack({
  onSend,
  onCancel,
  ask = t("tasks.sendback.ask"),
  submit = t("tasks.sendback.send"),
}: {
  onSend: (why: string) => void
  onCancel: () => void
  ask?: string
  submit?: string
}) {
  const [why, setWhy] = useState("")
  return (
    <form
      className="task-sendback"
      onSubmit={(e) => {
        e.preventDefault()
        if (why.trim()) onSend(why.trim())
      }}
    >
      <input
        autoFocus
        className="input"
        value={why}
        aria-label={ask}
        placeholder={ask}
        onChange={(e) => setWhy(e.target.value)}
        onBlur={() => !why.trim() && onCancel()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <button type="submit" className="btn is-primary" disabled={!why.trim()}>
        {submit}
      </button>
    </form>
  )
}
