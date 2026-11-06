import "~/styles/tasks.css"

import { liveOf } from "~/doing"
import { Avatar, cx, Dot, statusWord } from "~/kit/bits"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type PullRequest, type Task, type TaskStatus } from "~/model"
import { useApp } from "~/nav"
import { nickname, Shown } from "~/names"

export const TONES: Record<TaskStatus, string> = { todo: "", doing: "tone-doing", review: "tone-review", done: "tone-live", waiting: "tone-decide" }

function stateOf(channel: Channel, t: Task): { text: string; tone: string } | null {
  const owner = t.owner ? memberOf(channel, t.owner) : undefined
  const live = owner && owner.load?.doing.includes(t.id) ? liveOf(owner) : null
  if (live && t.status !== "done") return { text: live.text, tone: live.busy ? "tone-doing" : "" }
  if (t.cancelled) return { text: "cancelled", tone: "" }
  if (t.status === "done" && t.release) return { text: `shipped in ${t.release}`, tone: "" }
  if (!t.owner && t.leftBy && t.status !== "done") return { text: `${nickname(channel, t.leftBy)} left`, tone: "" }
  if (t.status === "waiting") return { text: statusWord(t), tone: TONES.waiting }
  return null
}

function failedOf(pr: PullRequest): string | null {
  if (pr.state !== "open" && pr.state !== "draft") return null
  const failed = pr.ticks?.failed ?? []
  if (failed.length) return `Failed: ${failed.join(", ")}`
  return pr.checks === "fail" ? "Checks failed" : null
}

export function TaskRow({ channel, t, on }: { channel: Channel; t: Task; on: boolean }) {
  const { go } = useApp()
  const owner = t.owner ? memberOf(channel, t.owner) : undefined
  const state = stateOf(channel, t)
  const failed = t.pr ? failedOf(t.pr) : null
  return (
    <button
      type="button"
      className={cx("board-row", `is-${t.status}`, on && "is-on")}
      aria-current={on || undefined}
      onClick={() => go({ to: "panel", panel: on ? null : { kind: "task", task: t.id } })}
    >
      <Dot status={t.cancelled ? "todo" : t.status} />
      <span className="board-title">
        <Shown value={t.title} />
      </span>
      <span className="board-meta">
        T{t.id}
        {state ? (
          <>
            {" · "}
            <span className={state.tone}>{state.text}</span>
          </>
        ) : (
          <span className="sr"> {statusWord(t)}</span>
        )}
        {t.pr && (
          <>
            {" · "}
            <span className={cx(failed && "tone-alert")} title={failed ?? undefined}>
              PR #{t.pr.number}
            </span>
          </>
        )}
        {" · "}
        {ago(t.updatedAt)}
      </span>
      {t.owner && (
        <span className="board-owner" title={nickname(channel, t.owner)}>
          <Avatar person={owner} size="sm" />
        </span>
      )}
    </button>
  )
}
