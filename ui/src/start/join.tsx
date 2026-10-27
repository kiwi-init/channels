import { useEffect, useId, useRef, useState } from "react"

import { handleFor, NAME_RE, RESERVED_NAMES } from "@kiwi/core/membership.ts"

import "~/styles/start.css"
import { cx, Dialog, DialogHead } from "~/kit/bits"
import type { InviteInfo } from "~/model"
import { useApp } from "~/nav"

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
  const t = text.trim()
  if (!t) return null
  const link = /^kiwi:\/\/join\/([^?#\s]+)/i.exec(t)
  const raw = link ? link[1] : /^https?:\/\/\S*#/i.test(t) ? t.slice(t.lastIndexOf("#") + 1) : t
  const code = decode(raw ?? "").replace(/\/+$/, "")
  return CODE.test(code) ? code : null
}

const focusFirst = (el: HTMLInputElement | null) => el?.setAttribute("autofocus", "")

export function JoinDialog() {
  const { nav, go } = useApp()
  const open = nav.dialog === "join"
  const close = () => go({ to: "dialog", dialog: null })
  return (
    <Dialog open={open} onClose={() => open && close()} label="Join a channel">
      <JoinForm onClose={close} />
    </Dialog>
  )
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
  const nameProblem = !NAME_RE.test(name.trim())
    ? "Letters, numbers, dots, dashes or underscores, up to 32"
    : RESERVED_NAMES.has(name.trim().toLowerCase())
      ? "That name is kept for Channels itself"
      : null

  const inspect = async (c: string) => {
    try {
      const info = await app.actions.inviteInfo(c)
      if (info.state === "member") return go({ to: "channel", code: info.code })
      if (info.state === "gone") setError("This invite no longer works: the channel was closed, or the code is wrong. Ask whoever sent it for a new one.")
      else setInvite(info)
    } catch (err) {
      setError(`Couldn't check the invite: ${err instanceof Error ? err.message : String(err)}`)
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
      <>
        <DialogHead
          title={owner ? `${owner} invited you to a channel` : "You're invited to a channel"}
          sub={`A code only lets you ask. ${owner ?? "The owner"} approves every member, person or agent.`}
          onClose={onClose}
        />
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
              setError(`Couldn't send the request: ${err instanceof Error ? err.message : String(err)}`)
              setBusy(false)
            }
          }}
        >
          <label className="field" htmlFor={nameId}>
            <span className="field-label">Your name in this channel</span>
            <input
              id={nameId}
              ref={focusFirst}
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
            {error ?? nameProblem ?? `${owner ?? "The owner"} sees this name and a code to check, then lets you in.`}
          </p>
          <div className="dialog-foot start-foot">
            <button type="button" className="btn is-quiet" onClick={() => (setInvite(null), setError(null))}>
              Back
            </button>
            <button type="submit" className="btn is-primary" disabled={busy || !!nameProblem}>
              {busy ? "Asking…" : "Ask to join"}
            </button>
          </div>
        </form>
      </>
    )
  }

  const hint =
    error ?? (bad ? "That isn't an invite. It looks like kiwi://join/…, a link with #mc2-…, or a code." : busy ? "Checking the invite…" : "Next you choose your name, then the owner lets you in.")
  return (
    <>
      <DialogHead title="Join a channel" sub="Paste the invite link or code someone sent you." onClose={onClose} />
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
          <span className="field-label">Invite link or code</span>
          <input
            id={inputId}
            ref={focusFirst}
            className="input is-mono"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="kiwi://join/… or a code"
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
        <div className="dialog-foot start-foot">
          <button type="submit" className="btn is-primary" disabled={!code || busy}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </div>
      </form>
    </>
  )
}
