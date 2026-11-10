import "~/i18n/en/shell-later"
import { lazy, Suspense, useId, useState } from "react"

import "~/styles/start.css"
import { cx } from "~/kit/bits"
import { useApp } from "~/nav"
import { onboarded } from "~/start/onboarded"
import { Onboarding } from "~/start/onboarding"
import { t } from "~/i18n/i18n"
import { useNoMatch } from "~/start/no-match"

const Enroll = lazy(() => import("~/start/enroll"))
const NoMatch = lazy(() => import("~/start/enroll").then((m) => ({ default: m.NoMatch })))
const GithubSignIn = lazy(() => import("~/start/github-sign-in"))

const ALLOWED = /^[A-Za-z0-9._-]+$/

function problemWith(name: string): string | null {
  if (!name) return null
  if (name.length > 32) return t("start.first.run.too.long", { max: 32 })
  if (/\s/.test(name)) return t("start.first.run.no.spaces", { name: name.split(/\s+/).join("-") })
  if (!ALLOWED.test(name)) return t("start.first.run.allowed")
  return null
}

export function FirstRun() {
  const { app } = useApp()
  const [intro, setIntro] = useState(() => {
    const show = !app.account && !onboarded(false)
    if (show)
      void import("~/meadow/meadow").catch(() => {
        // The intro loads it again itself and shows without the scene if it can't.
      })
    return show
  })
  return (
    <>
      <FirstStep />
      {intro && <Onboarding onDone={() => setIntro(false)} />}
    </>
  )
}

function FirstStep() {
  const { app } = useApp()
  const signIn = app.signIn
  const missed = useNoMatch()
  if (missed && !app.enrolling)
    return (
      <main className="start-first">
        <div className="start-drag" />
        <Suspense fallback={null}>
          <NoMatch fingerprint={missed} />
        </Suspense>
      </main>
    )
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
        <Suspense fallback={null}>
          <Enroll enrolling={app.enrolling} />
        </Suspense>
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
        <p className="start-lede">{t("start.first.run.lede")}</p>
        <label className="start-ask" htmlFor={inputId}>
          {t("start.first.run.ask")}
        </label>
        <div className="start-row">
          <input
            id={inputId}
            aria-label={t("start.first.run.your.name")}
            className="input"
            autoFocus
            autoComplete="nickname"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t("start.first.run.placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={hintId}
          />
          <button type="submit" className="btn is-primary" disabled={!clean || !!problem}>
            {t("start.first.run.continue")}
          </button>
        </div>
        <p id={hintId} className={cx("start-hint", problem && "is-error")} aria-live="polite">
          {problem}
        </p>
        <button type="button" className="btn is-quiet start-other" onClick={() => app.actions.enrollBegin()}>
          {t("start.first.run.other.computer")}
        </button>
      </form>
    </main>
  )
}
