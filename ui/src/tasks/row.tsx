import "~/i18n/en/specs"
import "~/styles/tasks.css"

import { liveOf } from "~/doing"
import { t } from "~/i18n/i18n"
import { Avatar, Count, cx, Dot, statusWord } from "~/kit/bits"
import { ago, lasting } from "~/kit/time"
import { memberOf, type Channel, type PullRequest, type Task } from "~/model"
import { useGo } from "~/nav"
import { nickname, Shown } from "~/names"
import { moverTag, quietFor, useTaskNow } from "~/tasks/mover"
import { TONES } from "~/tasks/tones"

function stateOf(channel: Channel, task: Task): { text: string; tone: string } | null {
  const owner = task.owner ? memberOf(channel, task.owner) : undefined
  const live = owner && owner.load?.doing.includes(task.id) ? liveOf(owner) : null
  if (live && task.status !== "done") return { text: live.text, tone: live.busy ? "tone-doing" : "" }
  if (task.cancelled) return { text: t("tasks.row.cancelled"), tone: "" }
  if (task.status === "done" && task.release) return { text: t("tasks.row.shipped.in", { release: task.release }), tone: "" }
  if (!task.owner && task.leftBy && task.status !== "done") return { text: t("tasks.row.left", { who: nickname(channel, task.leftBy) }), tone: "" }
  if (task.status === "waiting") return { text: statusWord(task), tone: TONES.waiting }
  return null
}

function failedOf(pr: PullRequest): string | null {
  if (pr.state !== "open" && pr.state !== "draft") return null
  const failed = pr.ticks?.failed ?? []
  if (failed.length) return t("tasks.row.failed", { checks: failed.join(", ") })
  return pr.checks === "fail" ? t("tasks.row.checks.failed") : null
}

export function TaskRow({ channel, t: task, on }: { channel: Channel; t: Task; on: boolean }) {
  const go = useGo()
  const owner = task.owner ? memberOf(channel, task.owner) : undefined
  const state = stateOf(channel, task)
  const failed = task.pr ? failedOf(task.pr) : null
  const now = useTaskNow()
  const move = moverTag(channel, task, now)
  const quiet = quietFor(task, now)
  return (
    <button type="button" className={cx("board-row", `is-${task.status}`, on && "is-on")} aria-current={on || undefined} onClick={() => go({ to: "task", task: task.id })}>
      <Dot status={task.cancelled ? "todo" : task.status} />
      <span className="board-title">
        <Shown value={task.title} />
      </span>
      <span className="board-meta">
        T{task.id}
        {state ? (
          <>
            {" · "}
            <span className={state.tone}>{state.text}</span>
          </>
        ) : (
          <span className="sr"> {statusWord(task)}</span>
        )}
        {move && <> · {move}</>}
        {quiet && (
          <>
            {" · "}
            <span className="tone-alert">{t("tasks.row.quiet", { time: lasting(quiet.ms) })}</span>
          </>
        )}
        {task.pr && (
          <>
            {" · "}
            <span className={cx(failed && "tone-alert")} title={failed ?? undefined}>
              {t("tasks.row.pr", { number: String(task.pr.number) })}
            </span>
          </>
        )}
        {" · "}
        {ago(task.updatedAt)}
        {task.mentions ? " " : null}
        <Count n={task.mentions ?? 0} loud />
      </span>
      {task.owner && (
        <span className="board-owner" title={nickname(channel, task.owner)}>
          <Avatar person={owner} size="sm" />
        </span>
      )}
    </button>
  )
}
