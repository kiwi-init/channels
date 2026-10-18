import { Dialog } from "@base-ui/react/dialog"
import { useState } from "react"

import { MAX_REPOS, REPO_RE } from "@kiwi/core/protocol.ts"
import { reposOf } from "@kiwi/core/state.ts"
import { Button, Modal, errorText, toast } from "../kit"

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
