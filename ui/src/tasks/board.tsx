import "~/styles/tasks.css"

import { useState } from "react"

import { MAX_GOAL_NAME } from "@kiwi/core/protocol.ts"
import { liveOf } from "~/doing"
import { Avatar, cx, Dot, Empty, Loading, statusWord } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type PullRequest, type Task, type TaskGroupHead, type TaskStatus } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"
import { NowCard } from "~/tasks/now"

export const TONES: Record<TaskStatus, string> = { todo: "", doing: "tone-doing", review: "tone-review", done: "tone-live", waiting: "tone-decide" }

const ROWS_SHOWN = 5

const day = (at: number): string => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })

function headOf(channel: Channel, head: TaskGroupHead): { label: string; sub: string } {
  switch (head.kind) {
    case "ask":
      return { label: head.goal ?? (head.words ? `“${head.words}”` : `#${head.id}`), sub: nickname(channel, head.by) }
    case "unfiled":
      return { label: "Unfiled", sub: "No person's message holds these" }
    case "next":
      return { label: head.name ? `Next: ${head.name}` : "Next release", sub: "Merged, not in a release yet" }
    case "release":
      return { label: `Shipped in ${head.tag}`, sub: `Released ${day(head.at)}` }
    case "cancelled":
      return { label: "Cancelled", sub: "Closed without shipping" }
  }
}

const finished = (head: TaskGroupHead): boolean => head.kind === "next" || head.kind === "release" || head.kind === "cancelled"

export function Board({ channel, needs, tall }: { channel: Channel; needs: number; tall?: boolean }) {
  const { nav } = useApp()
  const live = channel.tasks.filter((t) => !t.archived)
  const byId = new Map(live.map((t) => [t.id, t]))
  const groups = channel.taskGroups.map((g) => ({ ...g, rows: g.tasks.flatMap((id) => byId.get(id) ?? []) })).filter((g) => g.rows.length)
  const prs = groups.some((g) => g.rows.some((t) => t.pr))
  const on = nav.panel?.kind === "task" ? nav.panel.task : null
  return (
    <div className="board">
      <div className={cx("board-list", prs && "has-prs")}>
        {live.length > 0 && !tall && <NowCard channel={channel} needs={needs} />}
        <NewTask channel={channel} />
        {live.length === 0 && channel.loading ? (
          <Loading />
        ) : live.length === 0 ? (
          <Empty title="No tasks yet." icon="tasks">
            {channel.people.some((p) => p.kind === "agent")
              ? "Say what you want done in the conversation. The lead turns it into tasks."
              : "Add one above, or add an agent from the sidebar and say what you want done."}
          </Empty>
        ) : (
          groups.map((g) => <Group key={g.key} channel={channel} head={g.head} rows={g.rows} on={on} />)
        )}
      </div>
    </div>
  )
}

function Group({ channel, head, rows, on }: { channel: Channel; head: TaskGroupHead; rows: Task[]; on: number | null }) {
  const { go } = useApp()
  const [all, setAll] = useState(false)
  const [naming, setNaming] = useState(false)
  const { label, sub } = headOf(channel, head)
  const shown = finished(head) && !all ? rows.slice(0, ROWS_SHOWN) : rows
  return (
    <section className="board-group" aria-label={label}>
      <div className="board-head">
        <h2 className="board-h">
          {head.kind === "ask" && naming ? (
            <GoalName channel={channel} ask={head.id} goal={head.goal} onDone={() => setNaming(false)} />
          ) : (
            <span className="board-label" title={head.kind === "ask" && !head.goal ? head.words : undefined}>
              {label}
            </span>
          )}
          {!naming && <span className="board-n num">{rows.length}</span>}
          {head.kind === "ask" && head.mayName && !naming && (
            <button type="button" className="board-name" onClick={() => setNaming(true)}>
              {head.goal ? "Rename" : "Name the goal"}
            </button>
          )}
        </h2>
        <p className="board-sub">
          {head.kind === "ask" && head.goal && head.words && <span className="board-words">“{head.words}”</span>}
          <span>{sub}</span>
          {head.kind === "ask" && (
            <button type="button" className="board-from num" onClick={() => go({ to: "panel", panel: { kind: "thread", seq: head.id } })}>
              from #{head.id}
            </button>
          )}
        </p>
      </div>
      <ul className="board-rows">
        {shown.map((t) => (
          <li key={t.id}>
            <Row channel={channel} t={t} on={t.id === on} />
          </li>
        ))}
      </ul>
      {finished(head) && rows.length > ROWS_SHOWN ? (
        <button type="button" className="board-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </section>
  )
}

function GoalName({ channel, ask, goal, onDone }: { channel: Channel; ask: number; goal: string | undefined; onDone: () => void }) {
  const { app } = useApp()
  const [value, setValue] = useState(goal ?? "")
  const save = () => {
    const name = value.trim()
    if (name !== (goal ?? "")) app.actions.nameGoal(channel.code, ask, name || null)
    onDone()
  }
  return (
    <input
      className="input board-goal"
      autoFocus
      aria-label={`Goal of #${ask}`}
      value={value}
      maxLength={MAX_GOAL_NAME}
      placeholder="The goal in plain words"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          save()
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onDone()
        }
      }}
    />
  )
}

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

function Row({ channel, t, on }: { channel: Channel; t: Task; on: boolean }) {
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

function NewTask({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const [title, setTitle] = useState("")
  return (
    <form
      className="board-new"
      onSubmit={(e) => {
        e.preventDefault()
        const text = title.trim()
        if (!text) return
        app.actions.addTask(channel.code, text)
        setTitle("")
      }}
    >
      <Icon name="plus" />
      <input
        className="board-new-input"
        value={title}
        aria-label="New task"
        placeholder="What needs doing?"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && title) {
            e.stopPropagation()
            setTitle("")
          }
        }}
      />
      <button type="submit" className="btn is-primary" disabled={!title.trim()}>
        Add
      </button>
    </form>
  )
}
