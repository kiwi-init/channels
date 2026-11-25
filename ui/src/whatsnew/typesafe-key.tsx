import "~/i18n/en/modals"

import { useState } from "react"

import { t } from "~/i18n/i18n"
import { openOutside } from "~/kit/outside"
import { saveTypesafeKey, useTypesafeKey } from "~/live/meaning"

const CONSOLE = "https://console.typesafe.ai"
const WHY = {
  malformed: "modals.whatsnew.key.why.malformed",
  refused: "modals.whatsnew.key.why.refused",
  unreachable: "modals.whatsnew.key.why.unreachable",
} as const

export function TypesafeKeyField() {
  const key = useTypesafeKey()
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [why, setWhy] = useState<keyof typeof WHY | null>(null)
  if (!key) return null
  if (key.set)
    return (
      <div className="key-field">
        <p className="key-field-hint">{t("modals.whatsnew.key.saved", { ends: key.ends ?? "" })}</p>
        <button type="button" className="btn is-quiet" onClick={() => void saveTypesafeKey(null)}>
          {t("modals.whatsnew.key.remove")}
        </button>
      </div>
    )
  return (
    <form
      className="key-field"
      onSubmit={(e) => {
        e.preventDefault()
        if (busy || !draft.trim()) return
        setBusy(true)
        setWhy(null)
        void saveTypesafeKey(draft).then(
          (out) => {
            setBusy(false)
            if (out.ok) setDraft("")
            else setWhy(out.why)
          },
          () => {
            setBusy(false)
            setWhy("unreachable")
          }
        )
      }}
    >
      <div className="key-field-row">
        <input
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("modals.whatsnew.key.placeholder")}
          aria-label={t("modals.whatsnew.key.placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn" disabled={busy || !draft.trim()}>
          {busy ? t("modals.whatsnew.key.checking") : t("modals.whatsnew.key.save")}
        </button>
      </div>
      {why && <p className="key-field-why">{t(WHY[why])}</p>}
      <p className="key-field-hint">
        {t("modals.whatsnew.key.hint")}{" "}
        <button type="button" className="key-field-link" onClick={() => openOutside(CONSOLE)}>
          {t("modals.whatsnew.key.get")}
        </button>
      </p>
    </form>
  )
}
