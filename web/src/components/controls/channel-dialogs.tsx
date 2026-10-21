import { Dialog } from "@base-ui/react/dialog"
import { useState } from "react"

import { BRANCH_PREFIX_RE, MAX_CHARTER } from "@kiwi/core/protocol.ts"
import { Button, Modal, TextField, errorText, toast } from "../kit"

export function CharterDialog({ text, onClose, onSave }: { text: string; onClose: () => void; onSave?: (text: string | null) => Promise<void> }) {
  const [draft, setDraft] = useState(text)
  const [busy, setBusy] = useState(false)
  const next = draft.trim()
  const save = async () => {
    setBusy(true)
    try {
      await onSave!(next || null)
      toast(next ? "Charter saved" : "Charter cleared")
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
          if (onSave && next !== text) void save()
        }}
      >
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Charter</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">
          What this channel is for, and where its limits are. Every agent is shown it, and escalates a request that falls outside it to its person and you instead of doing it.
        </Dialog.Description>
        {onSave ? (
          <textarea
            autoFocus
            value={draft}
            maxLength={MAX_CHARTER}
            rows={6}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ship the Windows input driver. Only this repo; nothing in production; no new dependencies without asking."
            aria-label="Charter"
            className="mt-4 w-full resize-y rounded-ctl border border-edge bg-raised px-3 py-2 text-body outline-none placeholder:text-ink-3 focus:border-edge-strong"
          />
        ) : (
          <p className="mt-4 text-body whitespace-pre-wrap text-ink">{text}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {onSave ? "Cancel" : "Close"}
          </Button>
          {onSave && (
            <Button type="submit" disabled={busy || next === text.trim()}>
              {next || !text ? "Save" : "Clear"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

export function BranchPrefixDialog({ prefix, onClose, onSave }: { prefix: string | null; onClose: () => void; onSave?: (prefix: string | null) => Promise<void> }) {
  const [draft, setDraft] = useState(prefix ?? "")
  const [busy, setBusy] = useState(false)
  const next = draft.trim()
  const valid = !next || BRANCH_PREFIX_RE.test(next)
  const save = async () => {
    setBusy(true)
    try {
      await onSave!(next || null)
      toast(next ? "Branch prefix saved" : "Branch prefix cleared")
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
          if (onSave && valid && next !== (prefix ?? "")) void save()
        }}
      >
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Branch prefix</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">
          A pull request from a branch named with this prefix and a task’s number shows on that task. Leave it empty and a pull request shows on a task only when someone posts its link.
        </Dialog.Description>
        {onSave ? (
          <TextField
            className="mt-4 font-mono"
            autoFocus
            value={draft}
            maxLength={32}
            spellCheck={false}
            placeholder="T"
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Branch prefix"
            aria-invalid={!valid}
            aria-describedby="branch-prefix-example"
          />
        ) : (
          <p className="mt-4 font-mono text-body text-ink">{prefix}</p>
        )}
        <p id="branch-prefix-example" role={valid ? undefined : "alert"} className={valid ? "mt-2 text-meta text-ink-3" : "mt-2 text-meta text-alert"}>
          {!valid ? (
            "Letters, numbers, and . _ / - only"
          ) : next ? (
            <>
              A pull request from <span className="font-mono">{next}7-fix-login</span> shows on task T7.
            </>
          ) : (
            "No branch links a pull request to a task."
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {onSave ? "Cancel" : "Close"}
          </Button>
          {onSave && (
            <Button type="submit" disabled={busy || !valid || next === (prefix ?? "")}>
              {next || !prefix ? "Save" : "Clear"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

export function RenameDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = name.trim()
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave(next)
      toast(`Renamed to ${next}`)
      onClose()
    } catch (err) {
      setError(errorText(err))
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
          if (next && next !== title) void save()
        }}
      >
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Rename channel</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">Everyone in the channel sees the new name. It’s encrypted, so the relay can’t read it.</Dialog.Description>
        <TextField
          className="mt-4"
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          aria-label="Channel name"
          aria-invalid={!!error}
          aria-describedby={error ? "rename-error" : undefined}
          onFocus={(e) => e.currentTarget.select()}
        />
        {error && (
          <p id="rename-error" role="alert" className="mt-2 text-ui text-alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !next || next === title}>
            Rename
          </Button>
        </div>
      </form>
    </Modal>
  )
}
