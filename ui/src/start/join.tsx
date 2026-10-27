import { useId, useState } from "react"

import "~/styles/start.css"
import { cx, Dialog, DialogHead } from "~/kit/bits"
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
  const { app, go } = useApp()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const inputId = useId()
  const hintId = useId()
  const code = inviteCode(text)
  const bad = text.trim() !== "" && !code
  const hint = failed
    ? "Couldn't send the request. Check the code and try again."
    : bad
      ? "That isn't an invite. It looks like kiwi://join/… or a short code."
      : code && code !== text.trim()
        ? `Code ${code}. Next, the owner lets you in.`
        : "Next, the owner lets you in. You'll get a code to tell them."
  return (
    <>
      <DialogHead title="Join a channel" sub="Paste the invite link or code someone sent you." onClose={onClose} />
      <form
        className="start-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!code || busy) return
          setBusy(true)
          setFailed(false)
          try {
            const joined = await app.actions.joinChannel(code)
            go({ to: "channel", code: joined })
          } catch {
            // The dialog stays open with the link kept, so they can fix it or try again.
            setFailed(true)
            setBusy(false)
          }
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
              setFailed(false)
            }}
            aria-invalid={bad || failed ? true : undefined}
            aria-describedby={hintId}
          />
        </label>
        <p id={hintId} className={cx("start-hint", (bad || failed) && "is-error")} aria-live="polite">
          {hint}
        </p>
        <div className="dialog-foot start-foot">
          <button type="submit" className="btn is-primary" disabled={!code || busy}>
            {busy ? "Asking…" : "Ask to join"}
          </button>
        </div>
      </form>
    </>
  )
}
