import "~/styles/start.css"

import type { Enrolling } from "~/model"
import { useApp } from "~/nav"

function Asking() {
  return (
    <>
      <h1 className="start-word">Open Channels on your other computer</h1>
      <p className="start-asking" aria-live="polite">
        <span className="start-pip" aria-hidden="true" />
        Approve this computer there.
      </p>
    </>
  )
}

function Digits({ digits }: { digits: string }) {
  return (
    <>
      <h1 className="start-word">Type these on your other computer</h1>
      <p className="start-digits" aria-live="polite" aria-label={digits.split("").join(" ")}>
        {digits.slice(0, 3)}
        <span aria-hidden="true"> </span>
        {digits.slice(3)}
      </p>
    </>
  )
}

function Check({ person }: { person: { name: string; fingerprint: string } }) {
  const { app } = useApp()
  return (
    <>
      <h1 className="start-word">Is this your key, {person.name}?</h1>
      <p className="start-key" aria-live="polite">
        {person.fingerprint}
      </p>
      <p className="start-hint">Compare it with your other computer, in Settings › Account. A different key means someone else answered: don't join.</p>
      <div className="start-row start-check">
        <button type="button" className="btn is-primary" autoFocus onClick={() => app.actions.enrollKeep()}>
          It matches, join
        </button>
        <button type="button" className="btn is-quiet" onClick={() => app.actions.enrollCancel()}>
          It doesn't match
        </button>
      </div>
    </>
  )
}

export default function Enroll({ enrolling }: { enrolling: Extract<Enrolling, { stage: "asking" | "digits" | "check" }> }) {
  const { app } = useApp()
  return (
    <div className="start-first-box">
      <span className="start-mark">
        <img src="/icon.svg" width={40} height={40} alt="" />
      </span>
      {enrolling.stage === "asking" && <Asking />}
      {enrolling.stage === "digits" && <Digits digits={enrolling.digits} />}
      {enrolling.stage === "check" && <Check person={enrolling.person} />}
      {enrolling.stage !== "check" && (
        <div className="start-others">
          <button type="button" className="btn is-quiet" onClick={() => app.actions.recoverBegin()}>
            Lost your other devices? Use your recovery key
          </button>
          <button type="button" className="btn is-quiet" onClick={() => app.actions.enrollCancel()}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
