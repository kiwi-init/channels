import "~/i18n/en/specs"
import { useState } from "react"

import { t } from "~/i18n/i18n"
import { autofocus } from "~/kit/bits"
import { Failed, failure, type Failure } from "~/kit/failed"
import { Field } from "~/kit/form"
import { mod } from "~/kit/keys"
import { Modal } from "~/kit/modal"
import type { Channel } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { SPEC_TEMPLATE } from "~/specs/read"

export function NewSpec({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { actions, go } = useAct()
  const [words, setWords] = useState("")
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<Failure | null>(null)
  const lead = channel.lead ? nickname(channel, channel.lead) : null
  const start = async () => {
    if (!words.trim() || busy) return
    setBusy(true)
    setFailed(null)
    const name = title.trim() || words.trim().split("\n")[0]!.slice(0, 80)
    let ask: number
    try {
      ask = await actions.newSpec(channel.code, words, SPEC_TEMPLATE(name))
    } catch (err) {
      // The dialog keeps what was typed and says what went wrong, so the person can post again.
      setFailed(failure(t("specs.new.failed"), err))
      return setBusy(false)
    }
    setBusy(false)
    onClose()
    go({ to: "spec", ask, part: "spec" })
  }
  return (
    <Modal
      open
      onClose={onClose}
      label={t("specs.new.title")}
      title={t("specs.new.title")}
      foot={
        <>
          <button type="button" className="btn is-quiet" onClick={onClose}>
            {t("specs.new.cancel")}
          </button>
          <button type="button" className="btn is-primary" disabled={!words.trim() || busy} onClick={() => void start()}>
            {t("specs.new.post")}
          </button>
        </>
      }
    >
      <div
        className="spec-new"
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !mod(e) || !words.trim() || busy) return
          e.preventDefault()
          void start()
        }}
      >
        <Field label={t("specs.new.want")} hint={t("specs.new.want.hint")}>
          <textarea className="textarea" rows={4} ref={autofocus} value={words} onChange={(e) => setWords(e.target.value)} placeholder={t("specs.new.want.placeholder")} />
        </Field>
        <Field label={t("specs.new.name")} hint={t("specs.new.optional")}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("specs.new.name.placeholder")} />
        </Field>
        <p className="spec-new-how">{t("specs.new.how", { lead: lead ?? t("specs.new.the.lead") })}</p>
        {failed && <Failed failure={failed} />}
      </div>
    </Modal>
  )
}
