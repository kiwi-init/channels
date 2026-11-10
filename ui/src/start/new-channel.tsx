import "~/i18n/en/shell-later"
import { useState } from "react"

import "~/styles/start.css"
import { autofocus, cx } from "~/kit/bits"
import { Field } from "~/kit/form"
import { Modal } from "~/kit/modal"
import { useGo, useActions } from "~/nav"
import { t } from "~/i18n/i18n"

export function NewChannelDialog() {
  const go = useGo()
  return <NewChannelForm onClose={() => go({ to: "dialog", dialog: null })} />
}

function NewChannelForm({ onClose }: { onClose: () => void }) {
  const actions = useActions()
  const go = useGo()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const title = name.trim()
  return (
    <Modal dismiss="x" onClose={onClose} label={t("start.new.channel.title")} title={t("start.new.channel.title")}>
      <form
        className="start-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!title || busy) return
          setBusy(true)
          setFailed(false)
          try {
            const code = await actions.newChannel(title)
            go({ to: "channel", code })
          } catch {
            // The dialog stays open with the name kept, so trying again is one click.
            setFailed(true)
            setBusy(false)
          }
        }}
      >
        <Field label={t("start.new.channel.name")}>
          <span className="start-name">
            <span className={cx("start-tile", !title && "is-blank")} aria-hidden="true">
              {title.slice(0, 1).toUpperCase()}
            </span>
            <input
              ref={autofocus}
              className="input"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              placeholder={t("start.new.channel.placeholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </span>
        </Field>
        <p className={cx("start-hint", failed && "is-error")} aria-live="polite">
          {failed ? t("start.new.channel.failed") : null}
        </p>
        <div className="modal-foot start-foot">
          <button type="button" className="btn is-quiet is-small" onClick={() => go({ to: "dialog", dialog: "join" })}>
            {t("start.new.channel.join.instead")}
          </button>
          <button type="submit" className="btn is-primary" disabled={!title || busy}>
            {busy ? t("start.new.channel.making") : t("start.new.channel.create")}
          </button>
        </div>
      </form>
    </Modal>
  )
}
