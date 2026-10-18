import { Dialog } from "@base-ui/react/dialog"
import { useEffect, useState } from "react"

import type { GithubDiff } from "@kiwi/core/client.ts"
import { diffLineClass } from "@/lib/diff"
import { cx } from "@/lib/utils"
import { Button, Modal, errorText } from "./kit"

export function DiffDialog({ repo, sha, title, load, onClose }: { repo: string; sha: string; title: string; load: (repo: string, sha: string) => Promise<GithubDiff>; onClose: () => void }) {
  const [got, setGot] = useState<{ diff: GithubDiff } | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    load(repo, sha).then(
      (diff) => live && setGot({ diff }),
      (err: unknown) => live && setGot({ error: errorText(err) })
    )
    return () => {
      live = false
    }
  }, [load, repo, sha])
  return (
    <Modal open onClose={onClose} wide>
      <div className="flex max-h-[80vh] flex-col p-5">
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
        <Dialog.Description className="mt-1 text-meta text-ink-3">
          <span className="font-mono">{repo}</span> at <span className="font-mono">{sha.slice(0, 7)}</span>
          {got && "diff" in got && ` against ${got.diff.base}`}
        </Dialog.Description>
        <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-ctl bg-field p-3">
          {!got && <p className="text-ui text-ink-3">Asking GitHub…</p>}
          {got && "error" in got && <p className="text-ui text-alert">{got.error}</p>}
          {got && "diff" in got && (
            <pre className="font-mono text-meta leading-snug">
              {got.diff.diff.split("\n").map((line, i) => (
                <div key={i} className={cx("whitespace-pre", diffLineClass(line))}>
                  {line || " "}
                </div>
              ))}
              {got.diff.truncated && <div className="mt-2 text-ink-3">The diff is longer than 2 MB; the rest is on GitHub.</div>}
            </pre>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}
