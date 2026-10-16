import { ArrowDown01Icon, ArrowRight01Icon, GitPullRequestIcon } from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"

import type { TaskState } from "@mc/protocol.ts"
import { taskId, type ChannelState, type Task } from "@mc/state.ts"
import type { RecentPr } from "@mc/work.ts"
import { formatAgo, formatFull } from "@/lib/format"
import { remember, remembered } from "@/lib/side"
import { cx } from "@/lib/utils"
import { AgentLine, busy, byBusy, type AgentNow } from "./agent-strip"
import { Icon } from "./icon"
import { StateMark, labelOf } from "./tasks"

const SHOWN = 5

type Filter = "all" | TaskState

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["todo", "Open"],
  ["doing", "In progress"],
  ["review", "Review"],
  ["done", "Done"],
]

function Card({ id, title, count, children }: { id: string; title: string; count?: ReactNode; children: ReactNode }) {
  const key = `mc.side.${id}`
  const [open, setOpen] = useState(() => remembered(key))
  return (
    <section aria-label={title} className="glass rounded-dock">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          remember(key, !open)
          setOpen(!open)
        }}
        className="flex w-full items-center gap-2 rounded-dock px-4 py-3 text-left"
      >
        <span className="text-ui font-semibold text-ink">{title}</span>
        {count !== undefined && <span className="text-meta text-ink-3 tabular-nums">{count}</span>}
        <Icon icon={ArrowDown01Icon} size={14} className={cx("ml-auto shrink-0 text-ink-3 transition-transform duration-200", !open && "-rotate-90")} />
      </button>
      {open && <div className="px-1.5 pb-1.5">{children}</div>}
    </section>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pt-0.5 pb-2.5 text-ui leading-normal text-ink-3">{children}</p>
}

function Agents({ agents, now, onOpenTask }: { agents: AgentNow[]; now: number; onOpenTask: (id: number) => void }) {
  const working = agents.filter(busy).length
  const here = agents.filter((a) => a.here).length
  return (
    <Card id="agents" title="Agents" count={agents.length ? (working ? `${working} working` : `${here} online`) : undefined}>
      {agents.length ? (
        <ul aria-label="What the agents are doing">
          {byBusy(agents).map((a) => (
            <AgentLine key={a.name} a={a} now={now} onOpenTask={onOpenTask} />
          ))}
        </ul>
      ) : (
        <Quiet>No agent has joined yet. Add one from the channel’s details.</Quiet>
      )}
    </Card>
  )
}

function TaskLine({ task, now, nameOf, onOpen }: { task: Task; now: number; nameOf: (n: string) => string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-2.5 rounded-bubble px-2.5 py-2 text-left transition-colors hover:bg-wash-2">
        <span className="pt-0.5">
          <StateMark state={task.state} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("line-clamp-2 text-ui leading-snug", task.state === "done" ? "text-ink-2" : "text-ink")}>{task.title}</span>
          <span className="mt-0.5 block truncate text-meta text-ink-3">
            <span className="tabular-nums">{taskId(task.id)}</span>
            {` · ${labelOf(task)}`}
            {` · ${task.owner ? nameOf(task.owner) : "Unassigned"}`}
            {" · "}
            <time title={formatFull(task.updatedAt)}>{formatAgo(task.updatedAt, now)}</time>
          </span>
        </span>
      </button>
    </li>
  )
}

function Tasks({ state, now, nameOf, onOpen, onAll }: { state: ChannelState; now: number; nameOf: (n: string) => string; onOpen: (id: number) => void; onAll: () => void }) {
  const [filter, setFilter] = useState<Filter>("all")
  const all = [...state.tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  const countOf = (f: Filter) => (f === "all" ? all.length : all.filter((t) => t.state === f).length)
  const list = all.filter((t) => filter === "all" || t.state === filter)
  const open = all.filter((t) => t.state !== "done").length
  return (
    <Card id="tasks" title="Tasks" count={all.length ? `${open} open` : undefined}>
      {all.length ? (
        <>
          <div role="radiogroup" aria-label="Show tasks" className="flex [scrollbar-width:none] gap-1 overflow-x-auto px-1 pb-2">
            {FILTERS.map(([f, word]) => {
              const on = filter === f
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setFilter(f)}
                  className={cx(
                    "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-meta font-medium transition-colors",
                    on ? "bg-ink text-canvas" : "bg-wash text-ink-2 hover:bg-wash-2 hover:text-ink"
                  )}
                >
                  {word}
                  <span className={cx("tabular-nums", on ? "text-canvas/70" : "text-ink-3")}>{countOf(f)}</span>
                </button>
              )
            })}
          </div>
          {list.length ? (
            <ul aria-label="Recently updated tasks">
              {list.slice(0, SHOWN).map((t) => (
                <TaskLine key={t.id} task={t} now={now} nameOf={nameOf} onOpen={() => onOpen(t.id)} />
              ))}
            </ul>
          ) : (
            <Quiet>No task is {FILTERS.find(([f]) => f === filter)?.[1].toLowerCase()} right now.</Quiet>
          )}
          <button type="button" onClick={onAll} className="flex w-full items-center gap-1 rounded-bubble px-2.5 py-2 text-left text-ui font-medium text-accent-text transition-colors hover:bg-wash-2">
            All tasks
            <Icon icon={ArrowRight01Icon} size={14} />
          </button>
        </>
      ) : (
        <Quiet>When agents split up work, the newest tasks show up here.</Quiet>
      )}
    </Card>
  )
}

const FATE: Record<RecentPr["state"], string> = { open: "text-live", merged: "text-doing", closed: "text-ink-3" }

function Pulls({ prs, state, now, nameOf }: { prs: RecentPr[]; state: ChannelState; now: number; nameOf: (n: string) => string }) {
  return (
    <Card id="prs" title="Pull requests" count={prs.length || undefined}>
      {prs.length ? (
        <ul aria-label="Pull requests linked in this channel">
          {prs.map((pr) => {
            const task = pr.task === undefined ? undefined : state.tasks.get(pr.task)
            return (
              <li key={pr.url}>
                <a href={pr.url} target="_blank" rel="noreferrer" title={pr.url} className="flex w-full items-start gap-2.5 rounded-bubble px-2.5 py-2 text-left transition-colors hover:bg-wash-2">
                  <Icon icon={GitPullRequestIcon} size={16} className={cx("mt-0.5 shrink-0", FATE[pr.state])} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 text-ui">
                      <span className="font-semibold text-ink tabular-nums">#{pr.number}</span>
                      <span className="truncate text-ink-3">{pr.repo}</span>
                      {pr.state !== "open" && <span className="shrink-0 text-meta text-ink-3">{pr.state}</span>}
                    </span>
                    <span className="block truncate text-meta text-ink-3">
                      {task ? (
                        <>
                          <span className="tabular-nums">{taskId(task.id)}</span> {task.title}
                        </>
                      ) : (
                        <>Linked by {nameOf(pr.by)}</>
                      )}
                      {" · "}
                      <time title={formatFull(pr.last)}>{formatAgo(pr.last, now)}</time>
                    </span>
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      ) : (
        <Quiet>When someone links a GitHub pull request here, the last {SHOWN} show up.</Quiet>
      )}
    </Card>
  )
}

export const FLOAT_W = 340

export function Overview({
  state,
  agents,
  prs,
  now,
  nameOf,
  onOpenTask,
  onAllTasks,
}: {
  state: ChannelState
  agents: AgentNow[]
  prs: RecentPr[]
  now: number
  nameOf: (n: string) => string
  onOpenTask: (id: number) => void
  onAllTasks: () => void
}) {
  return (
    <aside aria-label="Overview" style={{ width: FLOAT_W }} className="pointer-events-none absolute top-[calc(var(--head)+4px)] right-3 bottom-4 z-30 hidden flex-col lg:flex">
      <div className="pointer-events-auto flex max-h-full [scrollbar-width:none] flex-col gap-3 overflow-y-auto rounded-dock">
        <Agents agents={agents} now={now} onOpenTask={onOpenTask} />
        <Tasks state={state} now={now} nameOf={nameOf} onOpen={onOpenTask} onAll={onAllTasks} />
        <Pulls prs={prs} state={state} now={now} nameOf={nameOf} />
      </div>
    </aside>
  )
}
