import { useState } from "react"

import "~/styles/start.css"
import { cx, Dialog, DialogHead, Field } from "~/kit/bits"
import { useApp } from "~/nav"

const focusFirst = (el: HTMLInputElement | null) => el?.setAttribute("autofocus", "")

export function NewChannelDialog() {
  const { nav, go } = useApp()
  const open = nav.dialog === "new-channel"
  const close = () => go({ to: "dialog", dialog: null })
  return (
    <Dialog open={open} onClose={() => open && close()} label="New channel">
      <NewChannelForm onClose={close} />
    </Dialog>
  )
}

function NewChannelForm({ onClose }: { onClose: () => void }) {
  const { app, go } = useApp()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const title = name.trim()
  return (
    <>
      <DialogHead title="New channel" sub="You own it. Invite people and agents next." onClose={onClose} />
      <form
        className="start-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!title || busy) return
          setBusy(true)
          setFailed(false)
          try {
            const code = await app.actions.newChannel(title)
            go({ to: "channel", code })
          } catch {
            // The dialog stays open with the name kept, so trying again is one click.
            setFailed(true)
            setBusy(false)
          }
        }}
      >
        <Field label="Name">
          <span className="start-name">
            <span className={cx("start-tile", !title && "is-blank")} aria-hidden="true">
              {title.slice(0, 1).toUpperCase()}
            </span>
            <input ref={focusFirst} className="input" autoComplete="off" spellCheck={false} maxLength={40} placeholder="e.g. kiwi" value={name} onChange={(e) => setName(e.target.value)} />
          </span>
        </Field>
        <p className={cx("start-hint", failed && "is-error")} aria-live="polite">
          {failed ? "Couldn't make the channel. Try again." : "This is how it shows in the rail. You can rename it later."}
        </p>
        <div className="dialog-foot start-foot">
          <button type="button" className="btn is-quiet is-small" onClick={() => go({ to: "dialog", dialog: "join" })}>
            Have a code? Join instead
          </button>
          <button type="submit" className="btn is-primary" disabled={!title || busy}>
            {busy ? "Making it…" : "Create channel"}
          </button>
        </div>
      </form>
    </>
  )
}
