import { CheckListIcon } from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"

import type { Message, TaskState } from "@kiwi/core/protocol.ts"
import type { TaskCards } from "@kiwi/core/standup.ts"
import { taskId, tasksAwaitingPeople, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { activityOf, type Activity } from "@/lib/activity"
import { formatFull, memberName } from "@/lib/format"
import { githubSummary } from "@/lib/github-line"
import { DECISION, stateWord, YOUR_REVIEW } from "@/lib/task-labels"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { EventRow, GithubRow, shortEvent, standsAlone } from "./message"
import { StateMark } from "./tasks"

type TaskEntry = Extract<Activity, { kind: "task" }>

const TONE: Record<TaskState, string> = { todo: "text-ink-3", doing: "text-doing", review: "text-accent-text", done: "text-live" }

const toneOf = (t: Pick<Task, "state" | "cancelled">) => (t.cancelled ? "text-ink-3" : TONE[t.state])

const LINE = "flex min-w-0 items-center gap-1.5 py-[3px] pr-4 pl-11 text-meta text-ink-3"

function TaskLine({ entry, task, state, urgent, onOpen, anchor }: { entry: TaskEntry; task: Task; state: ChannelState; urgent?: string; onOpen?: (id: number) => void; anchor: string }) {
  const owner = task.owner ? memberName(state.members.get(task.owner), task.owner) : undefined
  return (
    <p id={`${anchor}${entry.seqs[0]}`} className={LINE}>
      {task.cancelled ? (
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
          <span className="block size-2 rounded-full bg-ink-3/55" />
        </span>
      ) : (
        <StateMark state={task.state} />
      )}
      <button
        type="button"
        onClick={() => onOpen?.(entry.id)}
        aria-label={`Open ${taskId(entry.id)}, ${task.title}`}
        title={`Open ${taskId(entry.id)}`}
        className="flex min-w-0 items-baseline gap-1.5 text-left hover:text-ink-2"
      >
        <span className="shrink-0 font-medium text-ink-2 tabular-nums">{taskId(entry.id)}</span>
        <span className="min-w-0 truncate">{task.title}</span>
      </button>
      {owner && <span className="shrink-0">· {owner}</span>}
      <span className={cx("shrink-0", urgent ? "font-semibold text-decide" : toneOf(task))}>· {urgent ?? stateWord(task)}</span>
      {entry.prs.map((pr) => (
        <a
          key={`${pr.repo}#${pr.number}`}
          href={`https://github.com/${pr.repo}/pull/${pr.number}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-ink-2 tabular-nums hover:text-ink hover:underline"
        >
          #{pr.number}
        </a>
      ))}
    </p>
  )
}

function Label({ entry, state, onOpen }: { entry: Activity; state: ChannelState; onOpen?: (id: number) => void }) {
  if (entry.kind === "task") {
    const task = state.tasks.get(entry.id)
    return (
      <>
        <button
          type="button"
          onClick={() => onOpen?.(entry.id)}
          aria-label={`Open ${taskId(entry.id)}${task ? `, ${task.title}` : ""}`}
          title={task?.title}
          className="font-medium text-ink-2 tabular-nums hover:text-ink hover:underline"
        >
          {taskId(entry.id)}
        </button>{" "}
        {task && <span className={toneOf(task)}>{stateWord(task)}</span>}
      </>
    )
  }
  if (entry.kind === "github") {
    const first = githubSummary(entry.messages.flatMap((m) => (m.ev?.op === "github" ? m.ev.items : [])))[0]
    return <span>GitHub{first ? ` ${first.ref ? `${first.ref} ` : ""}${first.text}` : ""}</span>
  }
  return <span>{shortEvent(entry.m, state)}</span>
}

export function ActivityRun({
  run,
  state,
  cards,
  me,
  now,
  onOpenTask,
  highlight,
  anchor = "m",
}: {
  run: Message[]
  state: ChannelState
  cards: TaskCards
  me: string
  now: number
  onOpenTask?: (id: number) => void
  highlight: number | null
  anchor?: string
}) {
  const [open, setOpen] = useState(false)
  const entries = activityOf(run, state.tasks)
  const awaiting = tasksAwaitingPeople(state)
  const urgentOf = (e: Activity): string | undefined => {
    if (e.kind !== "task") return undefined
    if (awaiting.has(e.id)) return DECISION
    return cards.card(e.id, me)?.waiting ? YOUR_REVIEW : undefined
  }
  const alone = (e: Activity) =>
    !!urgentOf(e) || (e.kind === "event" && standsAlone(e.m, state, me)) || (e.kind === "task" && e.seqs.some((s) => run.some((m) => m.seq === s && standsAlone(m, state, me))))
  const line = (e: Activity): ReactNode => {
    if (e.kind === "github") return <GithubRow key={`g${e.messages[0]!.seq}`} messages={e.messages} anchor={anchor} />
    if (e.kind === "event") return <EventRow key={e.m.seq} m={e.m} state={state} now={now} onOpenTask={onOpenTask} anchor={anchor} />
    const task = state.tasks.get(e.id)
    return task ? <TaskLine key={`t${e.id}`} entry={e} task={task} state={state} urgent={urgentOf(e)} onOpen={onOpenTask} anchor={anchor} /> : null
  }
  const pinned = entries.filter(alone)
  const folded = entries.filter((e) => !alone(e))
  const forced = highlight !== null && run.some((m) => m.seq === highlight)
  const shown = open || forced
  const span = `${formatFull(run[0]!.ts)} – ${formatFull(run[run.length - 1]!.ts)}`
  return (
    <div className="my-1">
      {folded.length === 1 && line(folded[0]!)}
      {folded.length > 1 && (
        <>
          <p id={`${anchor}${run[0]!.seq}`} title={span} className={LINE}>
            <Icon icon={CheckListIcon} size={14} className="shrink-0" />
            <span className="min-w-0 truncate">
              {folded.slice(0, 3).map((e, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <Label entry={e} state={state} onOpen={onOpenTask} />
                </span>
              ))}
              {folded.length > 3 && ` and ${folded.length - 3} more`}
            </span>
            <button type="button" aria-expanded={shown} onClick={() => setOpen(!shown)} className="shrink-0 text-ink-2 hover:text-ink">
              {shown ? "· fewer" : `· ${run.length} updates`}
            </button>
          </p>
          {shown && <div className="ml-5">{folded.map(line)}</div>}
        </>
      )}
      {pinned.map(line)}
    </div>
  )
}
