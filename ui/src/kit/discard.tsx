import { useState } from "react"

import { t } from "~/i18n/i18n"

export function useDiscard(changed: boolean, onDone: () => void): { asking: boolean; leave: () => void; keep: () => void } {
  const [asking, setAsking] = useState(false)
  return {
    asking,
    leave: () => {
      const next = leaving(asking, changed)
      if (next === "done") onDone()
      else setAsking(next === "ask")
    },
    keep: () => setAsking(false),
  }
}

export const leaving = (asking: boolean, changed: boolean): "keep" | "ask" | "done" => (asking ? "keep" : changed ? "ask" : "done")

export function DiscardAsk({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-label={t("kit.discard.ask")}
      className="discard-ask"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        e.preventDefault()
        e.stopPropagation()
        onKeep()
      }}
    >
      <span>{t("kit.discard.ask")}</span>
      <button type="button" className="btn is-quiet" autoFocus onClick={onKeep}>
        {t("kit.discard.keep")}
      </button>
      <button type="button" className="btn is-danger" onClick={onDiscard}>
        {t("kit.discard.discard")}
      </button>
    </div>
  )
}
