import "~/styles/start.css"

import { GithubIcon } from "@hugeicons/core-free-icons"

import { GlyphIcon } from "~/kit/icons"
import type { GithubSignIn as SignIn } from "~/model"
import { useApp } from "~/nav"

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
  return (
    <>
      <h1 className="start-word">channels</h1>
      <p className="start-lede">
        {known
          ? "Channels signs in with GitHub now. Your key, your channels and your name stay as they are."
          : "A chat for you and your AI agents, like Slack, where they work with you and with each other. End-to-end encrypted."}
      </p>
      {code ? (
        <>
          <p className="start-ask">Type this code on the GitHub page that opened</p>
          <p className="start-digits start-gh-code" aria-live="polite">
            {code.code}
          </p>
          <p className="start-asking start-gh-wait">
            <span className="start-pip" aria-hidden="true" />
            Waiting for GitHub. The code is copied too.
          </p>
          <a className="btn is-quiet start-other" href={code.url} target="_blank" rel="noreferrer noopener">
            Open GitHub again
          </a>
        </>
      ) : (
        <>
          <button type="button" className="btn is-primary start-gh" autoFocus onClick={() => app.actions.signInWithGithub()}>
            <GlyphIcon glyph={GithubIcon} size={16} />
            Sign in with GitHub
          </button>
          <p className={problem ? "start-hint is-error" : "start-hint"} aria-live="polite">
            {problem ??
              (known
                ? "Your GitHub picture becomes your face, and your pull requests and their checks show up in tasks."
                : "Your GitHub name and picture are how people see you. Your pull requests and their checks show up in tasks.")}
          </p>
        </>
      )}
    </>
  )
}

function SignedIn({ login }: { login: string }) {
  const { app } = useApp()
  const name = nameFrom(login)
  return (
    <>
      <h1 className="start-word">You're in, {login}</h1>
      <p className="start-lede">People see you as {name}, with your GitHub picture.</p>
      <div className="start-row start-go">
        <button type="button" className="btn is-primary" autoFocus onClick={() => app.actions.setName(name)}>
          Continue
        </button>
      </div>
      <button type="button" className="btn is-quiet start-other" onClick={() => app.actions.enrollBegin()}>
        I use Channels on another computer
      </button>
    </>
  )
}

export default function GithubSignIn({ signIn }: { signIn: SignIn }) {
  if (signIn.stage === "checking") return null
  return (
    <div className="start-first-box">
      <Mark />
      {signIn.stage === "sign-in" ? <Ask code={signIn.code} problem={signIn.problem} /> : <SignedIn login={signIn.login} />}
    </div>
  )
}
