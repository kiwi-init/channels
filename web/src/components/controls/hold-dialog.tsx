import { Dialog } from "@base-ui/react/dialog"
import { useState } from "react"

import { Button, Modal, TextField, errorText, toast } from "../kit"

export function HoldDialog({ onClose, onSave }: { onClose: () => void; onSave: (note?: string) => Promise<void> }) {
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await onSave(note.trim() || undefined)
      toast("Every agent is on hold")
      onClose()
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose}>
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Pause every agent</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">
          Every agent is told to stop at once. Until you lift the hold, every member’s client refuses an agent’s tasks, notes and messages to other agents. Agents may still answer people.
        </Dialog.Description>
        <TextField className="mt-4" autoFocus value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional): agents and people see it" aria-label="Why" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Pause agents
          </Button>
        </div>
      </form>
    </Modal>
  )
}
