import { useState } from "react"

import { Dialog, DialogHead, Field } from "~/kit/bits"
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
    <Dialog open onClose={onClose} label="New spec">
      <DialogHead title="New spec" sub="Say what you want. Agents and people shape it into a spec together." onClose={onClose} />
      <div className="dialog-body spec-new">
        <Field label="What do you want?" hint="Your own words, as you'd say them in #general. They stay on the spec as written.">
          <textarea
            className="textarea"
            rows={4}
            autoFocus
            value={words}
            onChange={(e) => setWords(e.target.value)}
            placeholder="The labels as a spreadsheet for Friday's review: one row per box, with who drew it."
          />
        </Field>
        <Field label="A short name" hint="Optional. The spec's heading; the lead can change it.">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Export annotations as CSV" />
        </Field>
        <p className="spec-new-how">
          It posts in #general and starts a draft with Why, Done when, In, Out and Open questions. {lead ? `${lead} fills it in` : "The agents fill it in"}, anyone comments on any line, and once you
          approve it the first free agent starts.
        </p>
      </div>
      <footer className="dialog-foot">
        <button type="button" className="btn is-quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn is-primary" disabled={!words.trim() || busy} onClick={() => void start()}>
          Post and start the draft
        </button>
      </footer>
    </Dialog>
  )
}
