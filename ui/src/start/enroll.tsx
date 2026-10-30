import "~/styles/start.css"

import type { Enrolling } from "~/model"
import { useApp } from "~/nav"

function Asking() {
  return (
    <>
      <p className="start-ask">Open Channels on your other computer</p>
      <p className="start-asking" aria-live="polite">
        <span className="start-pip" aria-hidden="true" />
        It shows this computer asking to join as you. Approve it there.
      </p>
    </>
  )
}

function Digits({ digits }: { digits: string }) {
  return (
    <>
      <p className="start-ask">Type these on your other computer</p>
      <p className="start-digits" aria-live="polite" aria-label={digits.split("").join(" ")}>
        {digits.slice(0, 3)}
        <span aria-hidden="true"> </span>
        {digits.slice(3)}
      </p>
      <p className="start-hint">Then check the key it shows against this one.</p>
    </>
  )
}

function Check({ person }: { person: { name: string; fingerprint: string } }) {
  const { app } = useApp()
  return (
    <>
      <p className="start-ask">Is this your key, {person.name}?</p>
      <p className="start-key" aria-live="polite">
        {person.fingerprint}
      </p>
      <p className="start-hint">
        Your other computer shows it in its approval and in Settings, under Your key for new devices. Join only if they match: a different key means someone else answered this computer.
      </p>
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

export default function Enroll({ enrolling }: { enrolling: Enrolling }) {
  const { app } = useApp()
  return (
    <div className="start-first-box">
      <span className="start-mark">
        <img src="/icon.svg" width={40} height={40} alt="" />
      </span>
      <h1 className="start-word">channels</h1>
      {enrolling.stage === "asking" && <Asking />}
      {enrolling.stage === "digits" && <Digits digits={enrolling.digits} />}
      {enrolling.stage === "check" && <Check person={enrolling.person} />}
      {enrolling.stage !== "check" && (
        <button type="button" className="btn is-quiet start-other" onClick={() => app.actions.enrollCancel()}>
          Cancel
        </button>
      )}
    </div>
  )
}
