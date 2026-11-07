import "~/styles/mods.css"

import { useState, type FormEvent } from "react"

import MODS_SKILL from "../../../src/mods-skill.txt?raw"
import { autofocus } from "~/kit/bits"
import { Field } from "~/kit/form"
import { Modal } from "~/kit/modal"
import { copyText } from "~/kit/toasts"
import { useApp } from "~/nav"

const GUIDE = MODS_SKILL.replace(/^---\n[\s\S]*?\n---\n+/, "").trim()

const modPrompt = (words: string): string => `<mods-guide>\n${GUIDE}\n</mods-guide>\n\nMake me a Channels mod with the guide above: ${words.trim()}\n\nTell me when it checks out and how to open it.`

export function NewModDialog() {
  const { go } = useApp()
  const [words, setWords] = useState("")
  const close = () => go({ to: "dialog", dialog: null })

  const copy = (e: FormEvent) => {
    e.preventDefault()
    if (!words.trim()) return
    copyText(modPrompt(words), "Prompt copied. Paste it into any agent.")
    close()
  }

  return (
    <Modal dismiss="x" onClose={close} label="New mod" title="New mod">
      <form className="mod-new" onSubmit={copy}>
        <Field label="What should it do?" hint="The prompt holds the mods guide and your words, for any agent.">
          <textarea className="textarea" rows={4} ref={autofocus} value={words} onChange={(e) => setWords(e.target.value)} placeholder="A panel with my open Linear issues, newest first" />
        </Field>
        <div className="modal-foot">
          <button type="button" className="btn is-quiet" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn is-primary" disabled={!words.trim()}>
            Copy prompt
          </button>
        </div>
      </form>
    </Modal>
  )
}
