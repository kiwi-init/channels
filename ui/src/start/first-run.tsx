import { lazy, Suspense, useId, useState } from "react"

import "~/styles/start.css"
import { cx } from "~/kit/bits"
import { useApp } from "~/nav"

const Enroll = lazy(() => import("~/start/enroll"))
const Recover = lazy(() => import("~/start/recover").then((m) => ({ default: m.Recover })))
const GithubSignIn = lazy(() => import("~/start/github-sign-in"))

const ALLOWED = /^[A-Za-z0-9._-]+$/

function problemWith(name: string): string | null {
  if (!name) return null
  if (name.length > 32) return "Keep it to 32 characters or fewer."
  if (/\s/.test(name)) return `No spaces. Try ${name.split(/\s+/).join("-")}.`
  if (!ALLOWED.test(name)) return "Only letters, numbers, dots, dashes and underscores."
  return null
}

export function FirstRun() {
  const { app } = useApp()
  const signIn = app.signIn
  if (signIn && (signIn.stage === "sign-in" || signIn.stage === "checking" || (signIn.stage === "signed-in" && !app.enrolling)))
    return (
      <main className="start-first">
        <div className="start-drag" />
        <Suspense fallback={null}>
          <GithubSignIn signIn={signIn} />
        </Suspense>
      </main>
    )
  if (app.enrolling)
    return (
      <main className="start-first">
        <div className="start-drag" />
        <Suspense fallback={null}>{app.enrolling.stage === "recover" || app.enrolling.stage === "welcome" ? <Recover enrolling={app.enrolling} /> : <Enroll enrolling={app.enrolling} />}</Suspense>
      </main>
    )
  return <NameForm />
}

function NameForm() {
  const { app } = useApp()
  const [name, setName] = useState("")
  const inputId = useId()
  const hintId = useId()
  const clean = name.trim()
  const problem = problemWith(clean)
  return (
    <main className="start-first">
      <div className="start-drag" />
      <form
        className="start-first-box"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (clean && !problem) app.actions.setName(clean)
        }}
      >
        <span className="start-mark">
          <img src="/icon.svg" width={40} height={40} alt="" />
        </span>
        <h1 className="start-word">channels</h1>
        <p className="start-lede">Real-time channels where people and AI agents work together. End-to-end encrypted.</p>
        <label className="start-ask" htmlFor={inputId}>
          What should people call you?
        </label>
        <div className="start-row">
          <input
            id={inputId}
            aria-label="Your name"
            className="input"
            autoFocus
            autoComplete="nickname"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="e.g. maya"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={hintId}
          />
          <button type="submit" className="btn is-primary" disabled={!clean || !!problem}>
            Continue
          </button>
        </div>
        <p id={hintId} className={cx("start-hint", problem && "is-error")} aria-live="polite">
          {problem ?? "Shown with everything you write."}
        </p>
        <button type="button" className="btn is-quiet start-other" onClick={() => app.actions.enrollBegin()}>
          I use Channels on another computer
        </button>
      </form>
    </main>
  )
}
