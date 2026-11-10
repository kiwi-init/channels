import "~/i18n/en/shell-later"
import { useEffect, useId, useRef, useState } from "react"

import { handleFor, NAME_RE, RESERVED_NAMES } from "@kiwi/core/membership.ts"

import "~/styles/start.css"
import { autofocus, cx } from "~/kit/bits"
import { Modal } from "~/kit/modal"
import type { InviteInfo } from "~/model"
import { useApp, useGo } from "~/nav"
import { t } from "~/i18n/i18n"

const CODE = /^[A-Za-z0-9._~-]+$/

function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    // A stray % is not an escape; the raw text is still checked against the code pattern.
    return text
  }
}

function inviteCode(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const link = /^kiwi:\/\/join\/([^?#\s]+)/i.exec(trimmed)
  const raw = link ? link[1] : /^https?:\/\/\S*#/i.test(trimmed) ? trimmed.slice(trimmed.lastIndexOf("#") + 1) : trimmed
  const code = decode(raw ?? "").replace(/\/+$/, "")
  return CODE.test(code) ? code : null
}

export function JoinDialog() {
  const go = useGo()
  return <JoinForm onClose={() => go({ to: "dialog", dialog: null })} />
}

function JoinForm({ onClose }: { onClose: () => void }) {
  const { app, nav, go } = useApp()
  const [text, setText] = useState(nav.invite ?? "")
  const [busy, setBusy] = useState(!!nav.invite)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [name, setName] = useState(() => (app.account ? handleFor(app.account.name) : ""))
  const inputId = useId()
  const hintId = useId()
  const nameId = useId()
  const code = inviteCode(text)
  const bad = text.trim() !== "" && !code
  const nameProblem = !NAME_RE.test(name.trim()) ? t("start.join.name.allowed", { max: 32 }) : RESERVED_NAMES.has(name.trim().toLowerCase()) ? t("start.join.name.reserved") : null

  const inspect = async (c: string) => {
    try {
      const info = await app.actions.inviteInfo(c)
      if (info.state === "member") return go({ to: "channel", code: info.code })
      if (info.state === "gone") setError(t("start.join.gone"))
      else setInvite(info)
    } catch (err) {
      setError(t("start.join.check.failed", { why: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }
  const first = useRef(nav.invite)
  useEffect(() => {
    if (first.current) void inspect(first.current)
    first.current = undefined
  })

  if (invite) {
    const owner = invite.owner
    return (
      <Modal
        dismiss="x"
        onClose={onClose}
        label={t("start.join.title")}
        title={owner ? t("start.join.invited.by", { owner }) : t("start.join.invited")}
        sub={owner ? t("start.join.sub.named", { owner }) : t("start.join.sub")}
      >
        <form
          className="start-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (busy || nameProblem) return
            setBusy(true)
            setError(null)
            try {
              const joined = await app.actions.joinChannel(invite.code, name.trim())
              go({ to: "channel", code: joined })
            } catch (err) {
              setError(t("start.join.send.failed", { why: err instanceof Error ? err.message : String(err) }))
              setBusy(false)
            }
          }}
        >
          <label className="field" htmlFor={nameId}>
            <span className="field-label">{t("start.join.your.name")}</span>
            <input
              id={nameId}
              ref={autofocus}
              className="input is-mono"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={nameProblem ? true : undefined}
            />
          </label>
          <p className={cx("start-hint", (nameProblem || error) && "is-error")} aria-live="polite">
            {error ?? nameProblem}
          </p>
          <div className="modal-foot start-foot">
            <button type="button" className="btn is-quiet" onClick={() => (setInvite(null), setError(null))}>
              {t("start.join.back")}
            </button>
            <button type="submit" className="btn is-primary" disabled={busy || !!nameProblem}>
              {busy ? t("start.join.asking") : t("start.join.ask")}
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  const hint = error ?? (bad ? t("start.join.not.invite") : null)
  return (
    <Modal dismiss="x" onClose={onClose} label={t("start.join.title")} title={t("start.join.title")}>
      <form
        className="start-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!code || busy) return
          setBusy(true)
          setError(null)
          await inspect(code)
        }}
      >
        <label className="field" htmlFor={inputId}>
          <span className="field-label">{t("start.join.invite.label")}</span>
          <input
            id={inputId}
            ref={autofocus}
            className="input is-mono"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t("start.join.placeholder")}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            aria-invalid={bad || error ? true : undefined}
            aria-describedby={hintId}
          />
        </label>
        <p id={hintId} className={cx("start-hint", (bad || error) && "is-error")} aria-live="polite">
          {hint}
        </p>
        <div className="modal-foot start-foot">
          <button type="submit" className="btn is-primary" disabled={!code || busy}>
            {busy ? t("start.join.checking") : t("start.join.continue")}
          </button>
        </div>
      </form>
    </Modal>
  )
}
