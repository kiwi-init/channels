import "~/i18n/en/shell-later"
import "~/styles/start.css"

import { GithubIcon } from "@hugeicons/core-free-icons"

import { GlyphIcon } from "~/kit/icons"
import { useLate } from "~/kit/late"
import type { GithubSignIn as SignIn } from "~/model"
import { useApp } from "~/nav"
import { OutsideLink } from "~/kit/outside"
import { t } from "~/i18n/i18n"

const NAME_MAX = 32

const nameFrom = (login: string): string => login.replace(/[^A-Za-z0-9._-]/g, "").slice(0, NAME_MAX) || "me"

function Mark() {
  return (
    <span className="start-mark">
      <img src="/icon.svg" width={40} height={40} alt="" />
    </span>
  )
}

function Ask({ code, problem }: { code: { code: string; url: string } | null; problem: string | null }) {
  const { app } = useApp()
  const known = !!app.account
  if (code)
    return (
      <>
        <h1 className="start-word">{t("start.github.type.code")}</h1>
        <p className="start-digits start-gh-code" aria-live="polite">
          {code.code}
        </p>
        <p className="start-asking start-gh-wait">
          <span className="start-pip" aria-hidden="true" />
          {t("start.github.waiting")}
        </p>
        <OutsideLink className="btn is-quiet start-other" href={code.url}>
          {t("start.github.open.again")}
        </OutsideLink>
      </>
    )
  return (
    <>
      <h1 className="start-word">channels</h1>
      <p className="start-lede">{known ? t("start.github.lede.known") : t("start.github.lede")}</p>
      <button type="button" className="btn is-primary start-gh" autoFocus onClick={() => app.actions.signInWithGithub()}>
        <GlyphIcon glyph={GithubIcon} size={16} />
        {t("start.github.sign.in")}
      </button>
      <p className={problem ? "start-hint is-error" : "start-hint"} aria-live="polite">
        {problem}
      </p>
    </>
  )
}

function SignedIn({ login }: { login: string }) {
  const { app } = useApp()
  const name = nameFrom(login)
  return (
    <>
      <h1 className="start-word">{t("start.github.signed.in", { login })}</h1>
      {name !== login && <p className="start-lede">{t("start.github.seen.as", { name })}</p>}
      <div className="start-row start-go">
        <button type="button" className="btn is-primary" autoFocus onClick={() => app.actions.setName(name)}>
          {t("start.github.continue")}
        </button>
      </div>
      <button type="button" className="btn is-quiet start-other" onClick={() => app.actions.enrollBegin()}>
        {t("start.github.other.computer")}
      </button>
    </>
  )
}

function Checking() {
  const late = useLate(true)
  if (!late) return null
  return (
    <div className="start-first-box">
      <Mark />
      <p className="start-asking" role="status">
        <span className="start-pip" aria-hidden="true" />
        {t("start.github.checking")}
      </p>
    </div>
  )
}

export default function GithubSignIn({ signIn }: { signIn: SignIn }) {
  if (signIn.stage === "checking") return <Checking />
  return (
    <div className="start-first-box">
      <Mark />
      {signIn.stage === "sign-in" ? <Ask code={signIn.code} problem={signIn.problem} /> : <SignedIn login={signIn.login} />}
    </div>
  )
}
