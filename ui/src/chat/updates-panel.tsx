import "~/i18n/en/chat-later"
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { linesOf, type EventLine, type TaskRun } from "~/chat/fold-events"
import { t } from "~/i18n/i18n"
import { cx, Dot, statusWord } from "~/kit/bits"
import { useDismiss } from "~/kit/dismiss"
import { OutsideLink } from "~/kit/outside"
import { clock, day, sameDay } from "~/kit/time"
import type { Channel, Message, Task } from "~/model"
import { useGo, useNicknames } from "~/nav"
import { wordsPlain } from "~/words"
import { nickname, Shown } from "~/names"

const PAGE = 60

type Item = { kind: "day"; at: number } | { kind: "line"; line: EventLine }

interface Shown {
  channel: Channel
  runs: readonly Message[][]
  here: number | null
  target: number | null
}

export function Panel({ onClose, ...shown }: Shown & { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useDismiss(onClose, { on: "document", keys: "capture", escape: "stop", ignore: { box, toggle: "[data-updates-toggle]" } })
  return (
    <div ref={box} role="dialog" aria-label={t("chat.updates.panel.label")} className="updates-panel">
      <Log {...shown} />
    </div>
  )
}

export function Log({ channel, runs, here, target }: Shown) {
  const tasks = useMemo(() => new Map(channel.tasks.map((t) => [t.id, t])), [channel.tasks])
  const items = useMemo(() => {
    const out: Item[] = []
    let last: number | null = null
    for (const run of [...runs].reverse()) {
      const at = run[0]!.at
      if (last === null || !sameDay(last, at)) out.push({ kind: "day", at })
      last = at
      for (const line of linesOf(run, tasks).reverse()) out.push({ kind: "line", line })
    }
    return out
  }, [runs, tasks])
  const reach = target === null ? -1 : items.findIndex((i) => i.kind === "line" && (i.line.kind === "one" ? i.line.m.seq === target : i.line.list.some((m) => m.seq === target)))
  const [limit, setLimit] = useState(PAGE)
  const shownTo = Math.max(limit, reach + 1)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (target !== null) box.current?.querySelector(`[data-seq="${target}"]`)?.scrollIntoView({ block: "center" })
  }, [target])
  return (
    <div ref={box} className="updates-log">
      {items.slice(0, shownTo).map((item) =>
        item.kind === "day" ? (
          <p key={`day${item.at}`} className="updates-day">
            {day(item.at)}
          </p>
        ) : (
          <Line
            key={`${item.line.kind}${item.line.kind === "one" ? item.line.m.seq : item.line.list[0]?.seq}`}
            channel={channel}
            line={item.line}
            tasks={tasks}
            here={here}
            forced={target !== null && item.line.kind !== "one" && item.line.list.some((m) => m.seq === target)}
          />
        )
      )}
      {items.length > shownTo && (
        <button type="button" className="sys-more updates-older" onClick={() => setLimit(shownTo + PAGE)}>
          {t("chat.updates.panel.show.older")}
        </button>
      )}
    </div>
  )
}

function Line({ channel, line, tasks, here, forced }: { channel: Channel; line: EventLine; tasks: ReadonlyMap<number, Task>; here: number | null; forced: boolean }) {
  const [open, setOpen] = useState(false)
  const shown = open || forced
  const toggle = (more: string) => (
    <button type="button" className="sys-more" aria-expanded={shown} onClick={() => setOpen(!shown)}>
      {`· ${shown ? t("chat.updates.panel.fewer") : more}`}
    </button>
  )
  if (line.kind === "one") return <Row m={line.m} here={here} yours={!!(line.m.task !== undefined && tasks.get(line.m.task)?.youReview)} />
  if (line.kind === "events") {
    const last = line.list[line.list.length - 1]!
    if (!shown) return <Row m={last} here={here} more={toggle(t("chat.updates.panel.more", { count: line.list.length - 1 }))} />
    return [...line.list].reverse().map((m) => <Row key={m.seq} m={m} here={here} more={m === last ? toggle("") : undefined} />)
  }
  if (line.kind === "github") return <GithubRow line={line} />
  return (
    <>
      <TasksRow line={line} tasks={tasks} more={toggle(t("chat.updates.panel.updates", { count: line.list.length }))} />
      {shown && line.tasks.map((t) => <TaskRow key={t.id} channel={channel} run={t} task={tasks.get(t.id)} />)}
    </>
  )
}

function Row({ m, here, yours, more }: { m: Message; here: number | null; yours?: boolean; more?: ReactNode }) {
  const go = useGo()
  const names = useNicknames()
  return (
    <p className={cx("sys", yours && "is-yours")} data-seq={m.seq}>
      <span className="sys-line" />
      <span className="sys-text">{wordsPlain(m.text, names)}</span>
      <time>{clock(m.at)}</time>
      {m.task !== undefined && m.task !== here && (
        <button type="button" className="fold-act" onClick={() => go({ to: "task", task: m.task! })}>
          {t("chat.updates.panel.open")}
        </button>
      )}
      {more}
    </p>
  )
}

function TasksRow({ line, tasks, more }: { line: Extract<EventLine, { kind: "tasks" }>; tasks: ReadonlyMap<number, Task>; more: ReactNode }) {
  const go = useGo()
  const names = useNicknames()
  const named = line.tasks.slice(0, 3)
  const last = line.list[line.list.length - 1]!
  return (
    <p className="sys" data-seq={line.list[0]!.seq} title={line.list.map((m) => wordsPlain(m.text, names)).join("\n")}>
      <span className="sys-line" />
      <span className="sys-text">
        {named.map((t, i) => {
          const task = tasks.get(t.id)
          return (
            <Fragment key={t.id}>
              {i > 0 && ", "}
              <button type="button" className="sys-task" title={task ? wordsPlain(task.title, names) : undefined} onClick={() => go({ to: "task", task: t.id })}>
                T{t.id}
              </button>
              {task && <span className={cx("sys-state", `is-${task.cancelled ? "cancelled" : task.status}`)}> {statusWord(task)}</span>}
            </Fragment>
          )
        })}
        {line.tasks.length > named.length && t("chat.updates.panel.and.more", { count: line.tasks.length - named.length })}
      </span>
      <time>{clock(last.at)}</time>
      {more}
    </p>
  )
}

function TaskRow({ channel, run, task }: { channel: Channel; run: TaskRun; task: Task | undefined }) {
  const go = useGo()
  const last = run.list[run.list.length - 1]!
  if (!task) return <Row m={last} here={null} />
  return (
    <p className="sys is-task-row" data-seq={last.seq}>
      <Dot status={task.status} />
      <button type="button" className="sys-task" onClick={() => go({ to: "task", task: task.id })}>
        T{task.id}
      </button>
      <span className="sys-text">
        <Shown value={task.title} />
      </span>
      {task.owner && <span>· {nickname(channel, task.owner)}</span>}
      <span className={cx("sys-state", `is-${task.cancelled ? "cancelled" : task.status}`)}>· {statusWord(task)}</span>
      {task.pr && (
        <OutsideLink className="sys-task" href={task.pr.url}>
          #{task.pr.number}
        </OutsideLink>
      )}
    </p>
  )
}

function GithubRow({ line }: { line: Extract<EventLine, { kind: "github" }> }) {
  const names = useNicknames()
  const last = line.list[line.list.length - 1]!
  return (
    <p className="sys" data-seq={line.list[0]!.seq} title={line.list.map((m) => wordsPlain(m.text, names)).join("\n")}>
      <span className="sys-line" />
      <span className="sys-text">
        GitHub
        {line.parts.map((p, i) => (
          <Fragment key={i}>
            {i === 0 ? " · " : ", "}
            {p.ref &&
              (p.url ? (
                <OutsideLink className="sys-task" href={p.url}>
                  {p.ref}
                </OutsideLink>
              ) : (
                <span className="sys-task">{p.ref}</span>
              ))}
            {p.ref ? ` ${p.text}` : p.text}
          </Fragment>
        ))}
      </span>
      <time>{clock(last.at)}</time>
    </p>
  )
}
