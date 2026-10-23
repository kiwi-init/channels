import { GitMergeIcon, GitPullRequestIcon } from "@hugeicons/core-free-icons"

import type { taskPr } from "@kiwi/core/work.ts"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"

export type Pr = NonNullable<ReturnType<typeof taskPr>>

function DiffBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions
  const added = total ? Math.max(8, Math.round((additions / total) * 100)) : 0
  return (
    <span aria-hidden className="flex h-1.5 w-12 min-w-0 shrink overflow-hidden rounded-full shadow-[inset_0_0_0_1px_var(--line)]">
      {total > 0 && (
        <>
          <span className="h-full bg-live" style={{ width: `${added}%` }} />
          <span className="h-full flex-1 bg-alert" />
        </>
      )}
    </span>
  )
}

export function PrCell({ pr }: { pr: Pr }) {
  const { additions, deletions } = pr.pr
  const sized = additions !== undefined && deletions !== undefined
  return (
    <a
      href={`https://github.com/${pr.pr.repo}/pull/${pr.pr.number}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={sized ? `#${pr.pr.number} · +${additions} −${deletions}` : `#${pr.pr.number}`}
      className="flex min-w-0 items-center gap-2 overflow-hidden text-meta text-ink-2 tabular-nums hover:text-ink"
    >
      <Icon
        icon={pr.pr.state === "merged" ? GitMergeIcon : GitPullRequestIcon}
        size={14}
        className={cx("shrink-0", pr.pr.state === "merged" ? "text-doing" : pr.pr.state === "closed" ? "text-ink-3" : "text-live")}
      />
      <span className="shrink-0">#{pr.pr.number}</span>
      {sized && (
        <>
          <DiffBar additions={additions} deletions={deletions} />
          <span className="shrink-0 text-live">+{additions}</span>
          {deletions > 0 && <span className="shrink-0 text-alert">−{deletions}</span>}
        </>
      )}
    </a>
  )
}
