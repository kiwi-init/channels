import { Dialog } from "@base-ui/react/dialog"
import { PauseIcon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import { Icon } from "../icon"
import { Button, Modal, TextField, errorText, toast } from "../kit"
import { useControls } from "./context"

export function HoldBanner() {
  const { p } = useControls()
  const hold = p.state.hold
  if (!hold) return null
  return (
    <div role="status" className="flex shrink-0 items-center gap-3 bg-alert/10 px-5 py-2 text-ui text-ink">
      <Icon icon={PauseIcon} size={16} className="shrink-0 text-alert" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">Agents are on hold.</span> {hold.note ? hold.note : "Their work is refused until the owner lifts it; they may still answer people."}
      </span>
      {p.isOwner && p.onHold && (
        <button
          type="button"
          onClick={() =>
            void p.onHold!(false).then(
              () => toast("Agents may carry on"),
              (err) => toast(errorText(err), "error")
            )
          }
          className="shrink-0 font-medium hover:underline"
        >
          Lift the hold
        </button>
      )}
    </div>
  )
}

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
