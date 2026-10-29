import { Fragment, useMemo, useState, type ReactNode } from "react"

import { linesOf, type EventLine, type TaskRun } from "~/chat/fold-events"
import { cx, Dot, statusWord } from "~/kit/bits"
import { clock } from "~/kit/time"
import type { Channel, Message, Task } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"

interface Props {
  channel: Channel
  run: readonly Message[]
  here: number | null
  jump: number | null
}

export function EventRun({ channel, run, here, jump }: Props) {
  const tasks = useMemo(() => new Map(channel.tasks.map((t) => [t.id, t])), [channel.tasks])
  const lines = linesOf(run, tasks)
  return lines.map((line) => {
    const key = `${line.kind}${line.kind === "one" ? line.m.seq : line.list[0]?.seq}`
    const forced = jump !== null && line.kind !== "one" && line.list.some((m) => m.seq === jump)
    return <Line key={key} channel={channel} line={line} tasks={tasks} here={here} forced={forced} />
  })
}

function Line({ channel, line, tasks, here, forced }: { channel: Channel; line: EventLine; tasks: ReadonlyMap<number, Task>; here: number | null; forced: boolean }) {
  const [open, setOpen] = useState(false)
  const shown = open || forced
  const toggle = (more: string) => (
    <button type="button" className="sys-more" aria-expanded={shown} onClick={() => setOpen(!shown)}>
      {shown ? "· fewer" : `· ${more}`}
    </button>
  )
  if (line.kind === "one") return <Row m={line.m} here={here} yours={!!(line.m.task !== undefined && tasks.get(line.m.task)?.youReview)} />
  if (line.kind === "events") {
    const last = line.list[line.list.length - 1]!
    if (!shown) return <Row m={last} here={here} more={toggle(`${line.list.length - 1} more`)} />
    return line.list.map((m) => <Row key={m.seq} m={m} here={here} more={m === last ? toggle("") : undefined} />)
  }
  if (line.kind === "github") return <GithubRow line={line} />
  return (
    <>
      <TasksRow line={line} tasks={tasks} more={toggle(`${line.list.length} updates`)} />
      {shown && line.tasks.map((t) => <TaskRow key={t.id} channel={channel} run={t} task={tasks.get(t.id)} />)}
    </>
  )
}

function Row({ m, here, yours, more }: { m: Message; here: number | null; yours?: boolean; more?: ReactNode }) {
  const { go } = useApp()
  return (
    <p className={cx("sys", yours && "is-yours")} data-seq={m.seq}>
      <span className="sys-line" />
      <span className="sys-text">{m.text}</span>
      <time>{clock(m.at)}</time>
      {m.task !== undefined && m.task !== here && (
        <button type="button" className="fold-act" onClick={() => go({ to: "panel", panel: { kind: "task", task: m.task! } })}>
          Open
        </button>
      )}
      {more}
    </p>
  )
}

function TasksRow({ line, tasks, more }: { line: Extract<EventLine, { kind: "tasks" }>; tasks: ReadonlyMap<number, Task>; more: ReactNode }) {
  const { go } = useApp()
  const named = line.tasks.slice(0, 3)
  const last = line.list[line.list.length - 1]!
  return (
    <p className="sys" data-seq={line.list[0]!.seq} title={line.list.map((m) => m.text).join("\n")}>
      <span className="sys-line" />
      <span className="sys-text">
        {named.map((t, i) => {
          const task = tasks.get(t.id)
          return (
            <Fragment key={t.id}>
              {i > 0 && ", "}
              <button type="button" className="sys-task" title={task?.title} onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
                T{t.id}
              </button>
              {task && <span className={cx("sys-state", `is-${task.cancelled ? "cancelled" : task.status}`)}> {statusWord(task)}</span>}
            </Fragment>
          )
        })}
        {line.tasks.length > named.length && ` and ${line.tasks.length - named.length} more`}
      </span>
      <time>{clock(last.at)}</time>
      {more}
    </p>
  )
}

function TaskRow({ channel, run, task }: { channel: Channel; run: TaskRun; task: Task | undefined }) {
  const { go } = useApp()
  const last = run.list[run.list.length - 1]!
  if (!task) return <Row m={last} here={null} />
  return (
    <p className="sys is-task-row" data-seq={last.seq}>
      <Dot status={task.status} />
      <button type="button" className="sys-task" onClick={() => go({ to: "panel", panel: { kind: "task", task: task.id } })}>
        T{task.id}
      </button>
      <span className="sys-text">{task.title}</span>
      {task.owner && <span>· {nickname(channel, task.owner)}</span>}
      <span className={cx("sys-state", `is-${task.cancelled ? "cancelled" : task.status}`)}>· {statusWord(task)}</span>
      {task.pr && (
        <a className="sys-task" href={task.pr.url} target="_blank" rel="noreferrer">
          #{task.pr.number}
        </a>
      )}
    </p>
  )
}

function GithubRow({ line }: { line: Extract<EventLine, { kind: "github" }> }) {
  const last = line.list[line.list.length - 1]!
  return (
    <p className="sys" data-seq={line.list[0]!.seq} title={line.list.map((m) => m.text).join("\n")}>
      <span className="sys-line" />
      <span className="sys-text">
        GitHub
        {line.parts.map((p, i) => (
          <Fragment key={i}>
            {i === 0 ? " · " : ", "}
            {p.ref &&
              (p.url ? (
                <a className="sys-task" href={p.url} target="_blank" rel="noreferrer">
                  {p.ref}
                </a>
              ) : (
                <span className="sys-task">{p.ref}</span>
              ))}
            {p.ref ? ` ${p.text}` : p.text}
          </Fragment>
        ))}
      </span>
      <time>{clock(last.at)}</time>
      {line.updates > 1 && <span>· {line.updates} updates</span>}
    </p>
  )
}
