import "~/i18n/en/settings"
import "~/styles/settings.css"

import { useState } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { autofocus } from "~/kit/bits"
import { Field } from "~/kit/form"
import { Modal } from "~/kit/modal"
import type { EnrollAsk } from "~/model"
import { useApp } from "~/nav"

const KIND: Record<EnrollAsk["as"], readonly [Key, Key]> = {
  desktop: ["settings.enroll.kind.desktop", "settings.enroll.kind.desktop.os"],
  phone: ["settings.enroll.kind.phone", "settings.enroll.kind.phone.os"],
  computer: ["settings.enroll.kind.computer", "settings.enroll.kind.computer.os"],
}

export function EnrollDialog() {
  const { app } = useApp()
  const ask = app.account?.enrollAsk
  const [hidden, setHidden] = useState<string | null>(null)
  const [typed, setTyped] = useState({ id: "", digits: "", left: null as number | null, busy: false })
  const open = !!ask && ask.stage !== "elsewhere" && hidden !== ask.id
  if (!ask) return null
  const mine = typed.id === ask.id ? typed : { id: ask.id, digits: "", left: null, busy: false }
  const digits = mine.digits.replace(/\D/g, "").slice(0, 6)
  const close = () => setHidden(ask.id)
  const deny = () => {
    app.actions.enrollDeny(ask.id)
    close()
  }
  const confirm = () => {
    if (digits.length !== 6 || mine.busy) return
    setTyped({ ...mine, busy: true })
    void app.actions.enrollConfirm(ask.id, digits).then(
      (r) => setTyped({ id: ask.id, digits: "", left: r.ok ? null : r.left, busy: false }),
      () => setTyped({ ...mine, busy: false })
    )
  }

  return (
    <Modal
      dismiss="x"
      open={open}
      onClose={close}
      label={t("settings.enroll.label")}
      title={t("settings.enroll.title", { device: ask.label })}
      sub={t("settings.enroll.sub", { what: ask.os ? t(KIND[ask.as][1], { os: ask.os }) : t(KIND[ask.as][0]) })}
    >
      <form
        className="set-confirm"
        onSubmit={(e) => {
          e.preventDefault()
          if (ask.stage === "new") app.actions.enrollAnswer(ask.id)
          else confirm()
        }}
      >
        {ask.stage === "waiting" && (
          <p className="set-pair-wait">
            <span className="set-pip is-waiting" aria-hidden="true" />
            {t("settings.enroll.waiting", { device: ask.label })}
          </p>
        )}
        {ask.stage === "digits" && (
          <Field
            label={t("settings.enroll.digits", { device: ask.label })}
            hint={mine.left !== null ? t("settings.enroll.no.match", { count: mine.left }) : ask.fingerprint ? t("settings.enroll.then.key", { key: ask.fingerprint }) : undefined}
          >
            <input
              ref={autofocus}
              className="input set-enroll-digits"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={digits}
              placeholder="000000"
              aria-invalid={mine.left !== null}
              onChange={(e) => setTyped({ ...mine, digits: e.target.value, left: null })}
            />
          </Field>
        )}
        <div className="modal-foot">
          <button type="button" className="btn is-quiet" onClick={deny}>
            {t("settings.enroll.not.mine")}
          </button>
          {ask.stage === "new" && (
            <button type="submit" className="btn is-primary" ref={autofocus}>
              {t("settings.enroll.continue")}
            </button>
          )}
          {ask.stage === "digits" && (
            <button type="submit" className="btn is-primary" disabled={digits.length !== 6 || mine.busy}>
              {t("settings.enroll.approve")}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
