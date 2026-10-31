import { cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel, PullRequest } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"

export function TaskChip({ channel, id }: { channel: Channel; id: number }) {
  const { go } = useAct()
  const t = channel.tasks.find((t) => t.id === id)
  if (!t) return null
  return (
    <button type="button" className={cx("chip", `is-${t.status}`)} onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
      <Dot status={t.status} />
      <span className="chip-id">T{t.id}</span>
      <span className="chip-title">{t.title}</span>
      <span className="chip-meta">
        {t.owner ? `${nickname(channel, t.owner)} · ` : ""}
        {STATUS_WORDS[t.status]}
        {t.pr ? ` · PR #${t.pr.number}` : ""}
      </span>
    </button>
  )
}

export const CHECKS: Record<PullRequest["checks"], string> = { pass: "checks passed", fail: "checks failed", running: "checks running", none: "no checks" }

export function PrChip({ pr }: { pr: PullRequest }) {
  return (
    <a className={cx("chip is-pr", `is-${pr.state}`)} href={pr.url} target="_blank" rel="noreferrer noopener">
      <Icon name="pr" size={14} />
      <span className="chip-id">#{pr.number}</span>
      <span className="chip-title">{pr.title}</span>
      <span className="chip-meta">
        {pr.additions !== undefined && (
          <>
            <span className="num">+{pr.additions}</span> <span className="num">−{pr.deletions}</span>
            {" · "}
          </>
        )}
        <span className={pr.state === "merged" ? "tone-live" : pr.state === "closed" ? "tone-alert" : pr.checks === "fail" ? "tone-alert" : pr.checks === "running" ? "tone-decide" : ""}>
          {pr.state === "merged" ? "merged" : pr.state === "closed" ? "closed" : CHECKS[pr.checks]}
        </span>
      </span>
    </a>
  )
}
