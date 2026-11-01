import "~/styles/tasks.css"

import { liveOf } from "~/doing"
import { Avatar, cx, Dot, statusWord } from "~/kit/bits"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type PullRequest, type Task, type TaskStatus } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"

export const TONES: Record<TaskStatus, string> = { todo: "", doing: "tone-doing", review: "tone-review", done: "tone-live", waiting: "tone-decide" }

function stateOf(channel: Channel, t: Task): { text: string; tone: string; busy?: boolean } {
  const owner = t.owner ? memberOf(channel, t.owner) : undefined
  const live = owner && owner.load?.doing.includes(t.id) ? liveOf(owner) : null
  if (live && t.status !== "done") return { text: live.text, tone: live.busy ? "tone-doing" : "", busy: live.busy }
  if (t.status === "done" && t.release && !t.cancelled) return { text: `shipped in ${t.release}`, tone: "" }
  if (!t.owner && t.leftBy && t.status !== "done") return { text: `${nickname(channel, t.leftBy)} left`, tone: "" }
  return { text: statusWord(t), tone: t.cancelled ? "" : t.status === "waiting" ? TONES.waiting : "" }
}

function checksWord(pr: PullRequest): { text: string; tone: string } | null {
  if (pr.state === "merged") return { text: "merged", tone: "" }
  if (pr.state === "closed") return { text: "closed", tone: "" }
  const ticks = pr.ticks
  if (ticks) {
    const total = ticks.passed + ticks.running + ticks.failed.length
    if (ticks.failed.length) return { text: ticks.failed.length === 1 ? `${ticks.failed[0]} failed` : `${ticks.failed.length} failed`, tone: "tone-alert" }
    if (ticks.running) return { text: `${ticks.passed} of ${total} checks`, tone: "tone-doing" }
    if (total) return { text: "checks passed", tone: "" }
  }
  if (pr.checks === "fail") return { text: "checks failed", tone: "tone-alert" }
  if (pr.checks === "running") return { text: "checks running", tone: "tone-doing" }
  if (pr.checks === "pass") return { text: "checks passed", tone: "" }
  return null
}

const DIFF_W = 48

function DiffBar({ pr }: { pr: PullRequest }) {
  const add = pr.additions ?? 0
  const del = pr.deletions ?? 0
  if (!add && !del) return null
  const plus = Math.round((DIFF_W * add) / (add + del))
  return (
    <span className="board-diff" role="img" aria-label={`${add} added, ${del} removed`}>
      <span className="is-add" style={{ width: plus }} />
      <span className="is-del" style={{ width: DIFF_W - plus }} />
    </span>
  )
}

export function TaskRow({ channel, t, on }: { channel: Channel; t: Task; on: boolean }) {
  const { go } = useApp()
  const owner = t.owner ? memberOf(channel, t.owner) : undefined
  const state = stateOf(channel, t)
  const checks = t.pr ? checksWord(t.pr) : null
  return (
    <button
      type="button"
      className={cx("board-row", `is-${t.status}`, on && "is-on")}
      aria-current={on || undefined}
      onClick={() => go({ to: "panel", panel: on ? null : { kind: "task", task: t.id } })}
    >
      <Dot status={t.cancelled ? "todo" : t.status} />
      <span className="board-title">{t.title}</span>
      <span className="board-meta">
        T{t.id}
        {t.owner && ` · ${nickname(channel, t.owner)}`} ·{" "}
        <span className={cx("board-state", state.tone)}>
          {state.busy && <span className="board-busy" aria-hidden="true" />}
          {state.text}
        </span>
        {t.pr && <span className="board-pr-short"> · PR #{t.pr.number}</span>} · {ago(t.updatedAt)}
      </span>
      <span className="board-pr num">
        {t.pr && (
          <>
            #{t.pr.number}
            <DiffBar pr={t.pr} />
            {t.pr.additions ? <span className="tone-live">+{t.pr.additions}</span> : null}
          </>
        )}
      </span>
      <span className={cx("board-checks", checks?.tone)}>{checks?.text}</span>
      {t.owner && (
        <span className="board-owner" title={nickname(channel, t.owner)}>
          <Avatar person={owner} size="sm" />
        </span>
      )}
    </button>
  )
}
