import "~/styles/tasks.css"

import { useState } from "react"

import { Avatar, cx, Dot, Empty, Loading, statusWord } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Task, type TaskStatus } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"
import { NowCard } from "~/tasks/now"

export const openTasks = (channel: Channel): Task[] => channel.tasks.filter((t) => t.status !== "done" && !t.archived)

export const TONES: Record<TaskStatus, string> = { todo: "", doing: "tone-doing", review: "tone-review", done: "tone-live", waiting: "tone-decide" }

const GROUPS: { status: TaskStatus; title: string }[] = [
  { status: "waiting", title: "Needs you" },
  { status: "doing", title: "Working" },
  { status: "review", title: "In review" },
  { status: "todo", title: "To do" },
  { status: "done", title: "Done" },
]

const DONE_SHOWN = 5

export function Board({ channel, needs }: { channel: Channel; needs: number }) {
  const { nav } = useApp()
  const [allDone, setAllDone] = useState(false)
  const live = channel.tasks.filter((t) => !t.archived)
  const on = nav.panel?.kind === "task" ? nav.panel.task : null
  return (
    <div className="board">
      <div className="board-list">
        {live.length > 0 && <NowCard channel={channel} needs={needs} />}
        <NewTask channel={channel} />
        {live.length === 0 && channel.loading ? (
          <Loading />
        ) : live.length === 0 ? (
          <Empty title="No tasks yet.">
            {channel.people.some((p) => p.kind === "agent")
              ? "Say what you want done in the conversation. The lead turns it into tasks."
              : "Add one above, or add an agent from the sidebar and say what you want done."}
          </Empty>
        ) : (
          GROUPS.map((g) => {
            const list = live.filter((t) => t.status === g.status).sort((a, b) => b.updatedAt - a.updatedAt)
            if (!list.length) return null
            const shown = g.status === "done" && !allDone ? list.slice(0, DONE_SHOWN) : list
            return (
              <section key={g.status} className="board-group" aria-label={g.title}>
                <h2 className="board-h">
                  {g.title}
                  <span className="board-n num">{list.length}</span>
                </h2>
                <ul className="board-rows">
                  {shown.map((t) => (
                    <li key={t.id}>
                      <Row channel={channel} t={t} on={t.id === on} />
                    </li>
                  ))}
                </ul>
                {g.status === "done" && list.length > DONE_SHOWN && (
                  <button type="button" className="board-more" onClick={() => setAllDone(!allDone)}>
                    {allDone ? "Show fewer" : `Show all ${list.length} done`}
                  </button>
                )}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

function Row({ channel, t, on }: { channel: Channel; t: Task; on: boolean }) {
  const { go } = useApp()
  const owner = t.owner ? memberOf(channel, t.owner) : undefined
  return (
    <button
      type="button"
      className={cx("board-row", `is-${t.status}`, on && "is-on")}
      aria-current={on || undefined}
      onClick={() => go({ to: "panel", panel: on ? null : { kind: "task", task: t.id } })}
    >
      <Dot status={t.status} />
      <span className="board-title">{t.title}</span>
      <span className="board-meta">
        T{t.id}
        {t.owner && ` · ${nickname(channel, t.owner)}`} · {statusWord(t)}
        {t.pr && ` · PR #${t.pr.number}`} · {ago(t.updatedAt)}
      </span>
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
