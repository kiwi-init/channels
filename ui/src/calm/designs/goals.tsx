import { useMemo } from "react"

import { usual } from "~/calm/designs/day"
import { useAway } from "~/calm/designs/shared"
import { cx } from "~/kit/bits"
import type { Channel, Task, TaskGroup, TaskStatus } from "~/model"
import { nickname } from "~/names"
import { useApp } from "~/nav"
import { wordsPlain } from "~/words"

const MINUTE = 60_000
const ORDER: Record<TaskStatus, number> = { done: 0, landing: 1, review: 2, doing: 3, waiting: 4, todo: 5 }

interface Goal {
  key: string
  title: string
  tasks: Task[]
  done: number
  left: number
  next: { tone: "decide" | "doing" | "quiet"; text: string } | null
}

function titleOf(g: TaskGroup): string | null {
  const h = g.head
  if (h.kind === "ask") return h.goal ?? h.words.replace(/^@\S+\s*/, "").replace(/^./, (c) => c.toUpperCase())
  if (h.kind === "next") return h.name ? `Release ${h.name}` : "Next release"
  return null
}

function goalsOf(ch: Channel, now: number): Goal[] {
  const typical = usual(ch.tasks)
  return ch.taskGroups.flatMap((g): Goal[] => {
    const title = titleOf(g)
    if (!title) return []
    const tasks = g.tasks
      .map((id) => ch.tasks.find((t) => t.id === id))
      .filter((t): t is Task => !!t && !t.cancelled)
      .sort((a, b) => ORDER[a.status] - ORDER[b.status])
    if (!tasks.length) return []
    const done = tasks.filter((t) => t.status === "done").length
    const owners = new Set(tasks.filter((t) => t.status === "doing" && t.owner).map((t) => t.owner)).size
    const left = tasks.length === done ? 0 : Math.round(((tasks.length - done) * typical) / Math.max(1, owners) / MINUTE)
    const waiting = tasks.find((t) => t.status === "waiting")
    const doing = tasks.find((t) => t.status === "doing")
    const todo = tasks.find((t) => t.status === "todo")
    const name = (t: Task): string => `T${t.id} ${wordsPlain(t.title, ch.nicknames)}`
    const next = waiting
      ? { tone: "decide" as const, text: `Needs you: ${name(waiting)}` }
      : doing
        ? { tone: "doing" as const, text: `${doing.owner ? nickname(ch, doing.owner) : "Someone"} is on ${name(doing)}` }
        : todo
          ? { tone: "quiet" as const, text: `Next: ${name(todo)}` }
          : null
    return [{ key: g.key, title, tasks, done, left: now ? left : 0, next }]
  })
}

function eta(minutes: number): string {
  if (!minutes) return "done"
  if (minutes < 90) return `≈ ${Math.max(5, Math.round(minutes / 5) * 5)} min`
  return `≈ ${Math.round(minutes / 60)} h`
}

export function Goals({ open }: { open: (code: string) => void }) {
  const { app } = useApp()
  const away = useAway()
  const ch = app.channel
  const goals = useMemo(() => (ch ? goalsOf(ch, Date.now()) : []), [ch])
  const others = away.pairs.filter((p) => p.tile.code !== ch?.code)
  return (
    <section className="afk-goals afk-float" aria-label="Goals">
      {ch && (
        <h2 className="afk-goals-title">
          <button type="button" className="afk-link" data-afk-keep="" onClick={() => open(ch.code)}>
            {ch.title}
          </button>
          <span className="afk-meta mono">{goals.length} goals</span>
        </h2>
      )}
      <ol className="afk-goal-list">
        {goals.map((g) => (
          <li key={g.key} className="afk-goal">
            <p className="afk-goal-head">
              <b>{g.title}</b>
              <span className="afk-meta mono">
                {g.done} of {g.tasks.length} · {eta(g.left)}
              </span>
            </p>
            <span className="afk-segs" aria-hidden="true">
              {g.tasks.map((t) => (
                <span key={t.id} className={cx("afk-seg", `is-${t.status}`)} title={`T${t.id}`} />
              ))}
            </span>
            {g.next && <p className={cx("afk-goal-next", `is-${g.next.tone}`)}>{g.next.text}</p>}
          </li>
        ))}
        {others.map((p) => (
          <li key={p.tile.code} className="afk-goal">
            <p className="afk-goal-head">
              <button type="button" className="afk-link" data-afk-keep="" onClick={() => open(p.tile.code)}>
                {p.tile.title}
              </button>
              <span className="afk-meta mono">
                {p.home.working} working{p.home.doneToday ? ` · ${p.home.doneToday} done today` : ""}
              </span>
            </p>
            <p className="afk-goal-next is-quiet">{p.home.moving[0] ? `${p.home.moving[0].who ?? "Someone"} is on T${p.home.moving[0].id} ${p.home.moving[0].title}` : "Quiet"}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
