import { cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { OutsideLink } from "~/kit/outside"
import type { Channel, PullRequest } from "~/model"
import { useAct } from "~/nav"
import { nickname, Shown } from "~/names"

export function TaskChip({ channel, id }: { channel: Channel; id: number }) {
  const { go } = useAct()
  const t = channel.tasks.find((t) => t.id === id)
  if (!t) return null
  return (
    <button type="button" className={cx("chip", `is-${t.status}`)} title={STATUS_WORDS[t.status]} onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
      <Dot status={t.status} />
      <span className="chip-id">T{t.id}</span>
      <span className="chip-title">
        <Shown value={t.title} />
      </span>
      {(t.owner || t.pr || t.status === "waiting") && (
        <span className="chip-meta">
          {[t.owner && nickname(channel, t.owner), t.pr && `#${t.pr.number}`].filter(Boolean).join(" · ")}
          {t.status === "waiting" && <span className="tone-decide">{t.owner || t.pr ? " · " : ""}needs you</span>}
        </span>
      )}
    </button>
  )
}

const CHECKS: Record<PullRequest["checks"], string> = { pass: "checks passed", fail: "checks failed", running: "checks running", none: "no checks" }

export function PrChip({ pr }: { pr: PullRequest }) {
  return (
    <OutsideLink className={cx("chip is-pr", `is-${pr.state}`)} href={pr.url}>
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
        <span
          className={
            pr.state === "merged"
              ? "tone-live"
              : pr.state === "closed"
                ? "tone-alert"
                : pr.checks === "pass"
                  ? "tone-quiet"
                  : pr.checks === "fail"
                    ? "tone-alert"
                    : pr.checks === "running"
                      ? "tone-decide"
                      : ""
          }
        >
          {pr.state === "merged" ? "merged" : pr.state === "closed" ? "closed" : CHECKS[pr.checks]}
        </span>
      </span>
    </OutsideLink>
  )
}
