import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { OutsideLink } from "~/kit/outside"
import type { Channel, PullRequest } from "~/model"
import { useAct } from "~/nav"
import { nickname, Shown } from "~/names"

export function TaskChip({ channel, id }: { channel: Channel; id: number }) {
  const { go } = useAct()
  const task = channel.tasks.find((x) => x.id === id)
  if (!task) return null
  return (
    <button type="button" className={cx("chip", `is-${task.status}`)} title={STATUS_WORDS[task.status]} onClick={() => go({ to: "panel", panel: { kind: "task", task: task.id } })}>
      <Dot status={task.status} />
      <span className="chip-id">T{task.id}</span>
      <span className="chip-title">
        <Shown value={task.title} />
      </span>
      {(task.owner || task.pr || task.status === "waiting") && (
        <span className="chip-meta">
          {[task.owner && nickname(channel, task.owner), task.pr && `#${task.pr.number}`].filter(Boolean).join(" · ")}
          {task.status === "waiting" && (
            <span className="tone-decide">
              {task.owner || task.pr ? " · " : ""}
              {t("chat.cards.needs.you")}
            </span>
          )}
        </span>
      )}
    </button>
  )
}

const CHECKS: Record<PullRequest["checks"], Key> = { pass: "chat.cards.checks.pass", fail: "chat.cards.checks.fail", running: "chat.cards.checks.running", none: "chat.cards.checks.none" }

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
          {pr.state === "merged" ? t("chat.cards.merged") : pr.state === "closed" ? t("chat.cards.closed") : t(CHECKS[pr.checks])}
        </span>
      </span>
    </OutsideLink>
  )
}
