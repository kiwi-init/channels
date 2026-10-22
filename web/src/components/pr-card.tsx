import { CancelCircleIcon, CheckmarkCircle02Icon, GitPullRequestIcon, Loading03Icon } from "@hugeicons/core-free-icons"
import { useEffect, useState } from "react"

import type { GithubDiff } from "@kiwi/core/client.ts"
import { prChecks, type ChannelState, type GithubPr } from "@kiwi/core/state.ts"
import { FAILED } from "@kiwi/core/work.ts"
import { fileStats, type FileStat } from "@/lib/diff"
import { cx } from "@/lib/utils"
import { DiffDialog } from "./diff-dialog"
import { Icon } from "./icon"
import { Button } from "./kit"

const FILES = 4

type Load = (repo: string, sha: string) => Promise<GithubDiff>

function useFiles(pr: GithubPr, load: Load | undefined): FileStat[] | "loading" | null {
  const [files, setFiles] = useState<FileStat[] | "loading" | null>(pr.sha && load ? "loading" : null)
  useEffect(() => {
    if (!pr.sha || !load) return
    let live = true
    load(pr.repo, pr.sha)
      .then((d) => live && setFiles(fileStats(d.diff)))
      .catch(() => {
        // The diff is a nicety on the card: without it the card still shows the checks and the links.
        if (live) setFiles(null)
      })
    return () => {
      live = false
    }
  }, [pr.repo, pr.sha, load])
  return files
}

function Plus({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-live">+{additions}</span> <span className="text-alert">−{deletions}</span>
    </span>
  )
}

export function PrCard({ pr, state, load }: { pr: GithubPr; state: ChannelState; load: Load | undefined }) {
  const files = useFiles(pr, load)
  const [diffOpen, setDiffOpen] = useState(false)
  const checks = prChecks(state.github, pr)
  const shown = Array.isArray(files) ? files.slice(0, FILES) : []
  const rest = Array.isArray(files) ? files.slice(FILES) : []
  const url = pr.url ?? `https://github.com/${pr.repo}/pull/${pr.number}`
  return (
    <section aria-label={`PR #${pr.number}`} className="flex flex-col gap-3 rounded-card edge p-3.5">
      <header className="flex min-w-0 items-center gap-2 text-ui font-semibold">
        <Icon icon={GitPullRequestIcon} size={15} className="shrink-0" />
        <span className="tabular-nums">PR #{pr.number}</span>
        {pr.branch && <span className="ml-auto min-w-0 truncate font-mono text-meta font-normal text-ink-3">{pr.branch}</span>}
      </header>
      {files === "loading" ? (
        <p className="text-meta text-ink-3">Loading the files…</p>
      ) : shown.length ? (
        <ul aria-label="Files" className="flex flex-col gap-0.5 font-mono text-meta text-ink-2">
          {shown.map((f) => (
            <li key={f.path} className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate" title={f.path}>
                {f.path}
              </span>
              <Plus additions={f.additions} deletions={f.deletions} />
            </li>
          ))}
          {rest.length > 0 && (
            <li className="flex items-baseline gap-2">
              <span className="flex-1">+{rest.length} more</span>
              <Plus additions={rest.reduce((n, f) => n + f.additions, 0)} deletions={rest.reduce((n, f) => n + f.deletions, 0)} />
            </li>
          )}
        </ul>
      ) : null}
      {checks.length > 0 && (
        <ul aria-label="Checks" className="flex flex-col gap-1.5 border-t border-line pt-3">
          {checks.map((c) => {
            const failed = !!c.conclusion && FAILED.has(c.conclusion)
            const running = !c.conclusion
            return (
              <li key={c.name} className="flex min-w-0 items-center gap-2 text-meta text-ink-2">
                <Icon
                  icon={failed ? CancelCircleIcon : running ? Loading03Icon : CheckmarkCircle02Icon}
                  size={15}
                  className={cx("shrink-0", failed ? "text-alert" : running ? "text-doing" : "text-live")}
                />
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-ink hover:underline">
                    {c.name}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                )}
                <span className="shrink-0 text-ink-3">
                  {failed ? (c.conclusion ?? "failed").replace("_", " ") : running ? (c.status === "queued" ? "waiting" : "running") : (c.conclusion ?? "passed")}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex gap-2">
        {pr.sha && load && (
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => setDiffOpen(true)}>
            See the diff
          </Button>
        )}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-7 flex-1 items-center justify-center rounded-row bg-wash px-2.5 text-ui font-medium text-ink transition-colors hover:bg-wash-2"
        >
          GitHub
        </a>
      </div>
      {diffOpen && pr.sha && load && <DiffDialog repo={pr.repo} sha={pr.sha} title={`PR #${pr.number}`} load={load} onClose={() => setDiffOpen(false)} />}
    </section>
  )
}
