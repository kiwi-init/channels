import { Dialog } from "@base-ui/react/dialog"
import { useState } from "react"

import { MAX_CHARTER, MAX_REPOS, REPO_RE } from "@kiwi/core/protocol.ts"
import { reposOf } from "@kiwi/core/state.ts"
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

export function ReposDialog({ repos, onClose, onSave }: { repos: string[]; onClose: () => void; onSave?: (repos: string[]) => Promise<void> }) {
  const [draft, setDraft] = useState(repos.join("\n"))
  const [busy, setBusy] = useState(false)
  const lines = draft
    .split(/[\s,]+/)
    .map((l) =>
      l
        .trim()
        .replace(/^(?:https?:\/\/)?github\.com\//i, "")
        .replace(/\.git$/, "")
        .replace(/\/$/, "")
    )
    .filter(Boolean)
  const bad = lines.filter((l) => !REPO_RE.test(l))
  const next = reposOf(lines)
  const same = next.join("\n") === repos.join("\n")
  const save = async () => {
    setBusy(true)
    try {
      await onSave!(next)
      toast(next.length ? "Repos saved" : "Repos cleared")
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
          if (onSave && !bad.length && !same) void save()
        }}
      >
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Repos</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">
          The GitHub repositories this channel works on. An agent that joins or works from any other repo is flagged.
        </Dialog.Description>
        {onSave ? (
          <>
            <textarea
              autoFocus
              value={draft}
              rows={4}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={"owner/repo\nowner/another-repo"}
              aria-label="Repos"
              className="mt-4 w-full resize-y rounded-ctl border border-edge bg-raised px-3 py-2 font-mono text-body outline-none placeholder:text-ink-3 focus:border-edge-strong"
            />
            {(bad.length > 0 || next.length >= MAX_REPOS) && <p className="mt-2 text-meta text-ink-2">{bad.length ? `Not owner/repo: ${bad.join(", ")}` : `At most ${MAX_REPOS} repos`}</p>}
          </>
        ) : (
          <p className="mt-4 font-mono text-body whitespace-pre-wrap text-ink">{repos.join("\n")}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {onSave ? "Cancel" : "Close"}
          </Button>
          {onSave && (
            <Button type="submit" disabled={busy || bad.length > 0 || same}>
              {next.length || !repos.length ? "Save" : "Clear"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
