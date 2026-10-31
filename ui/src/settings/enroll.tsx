import "~/styles/settings.css"

import { useState } from "react"

import { Dialog, DialogHead, Field } from "~/kit/bits"
import type { EnrollAsk } from "~/model"
import { useApp } from "~/nav"

const KIND: Record<EnrollAsk["as"], string> = { desktop: "computer", phone: "phone", computer: "computer for agents" }

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
    <Dialog open={open} onClose={close} label="Approve a new device">
      <DialogHead title={`Let ${ask.label} sign in as you?`} sub={`A ${KIND[ask.as]}${ask.os ? ` on ${ask.os}` : ""} signed in with your account.`} onClose={close} />
      <form
        className="set-confirm"
        onSubmit={(e) => {
          e.preventDefault()
          if (ask.stage === "new") app.actions.enrollAnswer(ask.id)
          else confirm()
        }}
      >
        <p className="set-enroll-what">
          If you approve it, it joins your channels as you. Only approve a device you are holding now.
          {ask.stage === "digits" && ask.fingerprint && ` It then asks you to check your key: ${ask.fingerprint}.`}
        </p>
        {ask.stage === "waiting" && (
          <p className="set-pair-wait">
            <span className="set-pip is-waiting" aria-hidden="true" />
            Waiting for {ask.label} to show its code…
          </p>
        )}
        {ask.stage === "digits" && (
          <Field label={`The 6 digits ${ask.label} shows`} hint={mine.left !== null ? `Those don't match. ${mine.left} ${mine.left === 1 ? "try" : "tries"} left.` : undefined}>
            <input
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
        <div className="dialog-foot">
          <button type="button" className="btn is-quiet" onClick={deny}>
            Not mine
          </button>
          {ask.stage === "new" && (
            <button type="submit" className="btn is-primary" autoFocus>
              Continue
            </button>
          )}
          {ask.stage === "digits" && (
            <button type="submit" className="btn is-primary" disabled={digits.length !== 6 || mine.busy}>
              Approve
            </button>
          )}
        </div>
      </form>
    </Dialog>
  )
}
