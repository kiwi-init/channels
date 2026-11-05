import { useState } from "react"

import { autofocus, Modal, Field } from "~/kit/bits"
import type { Channel } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { SPEC_TEMPLATE } from "~/specs/read"

export function NewSpec({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { actions, go } = useAct()
  const [words, setWords] = useState("")
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const lead = channel.lead ? nickname(channel, channel.lead) : null
  const start = async () => {
    if (!words.trim() || busy) return
    setBusy(true)
    const name = title.trim() || words.trim().split("\n")[0]!.slice(0, 80)
    const ask = await actions.newSpec(channel.code, words, SPEC_TEMPLATE(name))
    setBusy(false)
    if (ask === null) return
    onClose()
    go({ to: "spec", ask, part: "spec" })
  }
  return (
    <Modal
      dismiss="x"
      open
      onClose={onClose}
      label="New spec"
      title="New spec"
      foot={
        <>
          <button type="button" className="btn is-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn is-primary" disabled={!words.trim() || busy} onClick={() => void start()}>
            Post and start the draft
          </button>
        </>
      }
    >
      <div className="spec-new">
        <Field label="What do you want?" hint="Your words stay on the spec as written.">
          <textarea
            className="textarea"
            rows={4}
            ref={autofocus}
            value={words}
            onChange={(e) => setWords(e.target.value)}
            placeholder="The labels as a spreadsheet for Friday's review: one row per box, with who drew it."
          />
        </Field>
        <Field label="A short name" hint="Optional.">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Export annotations as CSV" />
        </Field>
        <p className="spec-new-how">It posts in #general, and {lead ?? "the lead"} drafts the spec for you to approve.</p>
      </div>
    </Modal>
  )
}
