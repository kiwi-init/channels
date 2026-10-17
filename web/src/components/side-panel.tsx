import { ArrowDown01Icon, GitPullRequestIcon } from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"

import { taskId, tasksAwaitingPeople, type ChannelState, type Task } from "@mc/state.ts"
import type { RecentPr } from "@mc/work.ts"
import { formatAgo, formatFull } from "@/lib/format"
import { remember, remembered } from "@/lib/side"
import { cx } from "@/lib/utils"
import { AgentLine, busy, byBusy, type AgentNow } from "./agent-strip"
import { Icon } from "./icon"
import { DecisionMark, StateMark, TaskFilterBar, type TaskFilter } from "./tasks"

const SHOWN = 5

export const FLOAT_W = 384

export const FLOAT_GAP = 24

const FILTERS: [TaskFilter, string][] = [
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
    <section aria-label={title} className="rounded-card shadow-[0_0_0_1px_var(--edge-strong)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          remember(key, !open)
          setOpen(!open)
        }}
        className="flex h-11 w-full items-center gap-2 rounded-card px-4 text-left"
      >
        <span className="text-ui font-semibold text-ink">{title}</span>
        {count !== undefined && <span className="text-meta text-ink-3 tabular-nums">{count}</span>}
        <Icon icon={ArrowDown01Icon} size={14} className={cx("ml-auto shrink-0 text-ink-3 transition-transform duration-200", !open && "-rotate-90")} />
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </section>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-2 pb-2 text-ui leading-normal text-ink-3">{children}</p>
}

function When({ at, now }: { at: number; now: number }) {
  return (
    <time title={formatFull(at)} className="shrink-0 pt-px text-meta text-ink-3 tabular-nums">
      {formatAgo(at, now)}
    </time>
  )
}

function Agents({ agents, now, onOpenTask }: { agents: AgentNow[]; now: number; onOpenTask: (id: number) => void }) {
  const working = agents.filter(busy).length
  const here = agents.filter((a) => a.here).length
  return (
    <Card id="agents" title="Agents" count={agents.length ? (working ? `${working} working` : `${here} online`) : undefined}>
      {agents.length ? (
        <ul aria-label="What the agents are doing">
          {byBusy(agents).map((a) => (
            <AgentLine key={a.name} a={a} now={now} onOpenTask={onOpenTask} brief />
          ))}
        </ul>
      ) : (
        <Quiet>No agent has joined yet.</Quiet>
      )}
    </Card>
  )
}

function TaskLine({ task, now, nameOf, waiting, onOpen }: { task: Task; now: number; nameOf: (n: string) => string; waiting: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-2 rounded-ctl px-2 py-1.5 text-left transition-colors hover:bg-wash">
        <span className="pt-0.5">
          <StateMark state={task.state} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("line-clamp-2 text-ui leading-snug", task.state === "done" ? "text-ink-2" : "text-ink")}>{task.title}</span>
          <span className="mt-0.5 block truncate text-meta text-ink-3">
            <span className="tabular-nums">{taskId(task.id)}</span> · {task.owner ? nameOf(task.owner) : "Unassigned"}
          </span>
          {waiting && (
            <span className="mt-1 flex">
              <DecisionMark />
            </span>
          )}
        </span>
        <When at={task.updatedAt} now={now} />
      </button>
    </li>
  )
}

function Tasks({ state, now, nameOf, onOpen, onAll }: { state: ChannelState; now: number; nameOf: (n: string) => string; onOpen: (id: number) => void; onAll: () => void }) {
  const [filter, setFilter] = useState<TaskFilter>("all")
  const all = [...state.tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  const list = all.filter((t) => filter === "all" || t.state === filter)
  const open = all.filter((t) => t.state !== "done").length
  const shown = FILTERS.filter(([f]) => f === "all" || f === filter || all.some((t) => t.state === f))
  const waiting = tasksAwaitingPeople(state)
  return (
    <Card id="tasks" title="Tasks" count={all.length ? `${open} open` : undefined}>
      {all.length ? (
        <>
          <TaskFilterBar value={filter} options={shown} onChange={setFilter} className="mx-2 mb-2" />
          {list.length ? (
            <ul aria-label="Recently updated tasks">
              {list.slice(0, SHOWN).map((t) => (
                <TaskLine key={t.id} task={t} now={now} nameOf={nameOf} waiting={waiting.has(t.id)} onOpen={() => onOpen(t.id)} />
              ))}
            </ul>
          ) : (
            <Quiet>Nothing here right now.</Quiet>
          )}
          <button type="button" onClick={onAll} className="mt-1 w-full rounded-ctl px-2 py-1.5 text-left text-ui font-medium text-accent-text transition-colors hover:bg-wash">
            All tasks
          </button>
        </>
      ) : (
        <Quiet>When agents split up work, the newest tasks show up here.</Quiet>
      )}
    </Card>
  )
}

const FATE: Record<RecentPr["state"], { color: string; word: string }> = {
  open: { color: "text-live", word: "Open" },
  merged: { color: "text-doing", word: "Merged" },
  closed: { color: "text-ink-3", word: "Closed" },
}

function Pulls({ prs, state, now, nameOf }: { prs: RecentPr[]; state: ChannelState; now: number; nameOf: (n: string) => string }) {
  const repos = new Set(prs.map((p) => p.repo))
  return (
    <Card id="prs" title="Pull requests" count={prs.length || undefined}>
      {prs.length ? (
        <ul aria-label="Pull requests linked in this channel">
          {prs.map((pr) => {
            const task = pr.task === undefined ? undefined : state.tasks.get(pr.task)
            return (
              <li key={pr.url}>
                <a href={pr.url} target="_blank" rel="noreferrer" title={pr.url} className="flex w-full items-start gap-2 rounded-ctl px-2 py-1.5 text-left transition-colors hover:bg-wash">
                  <Icon icon={GitPullRequestIcon} size={15} className={cx("mt-0.5 shrink-0", FATE[pr.state].color)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui leading-snug text-ink">
                      <span className="font-semibold tabular-nums">#{pr.number}</span> {task ? task.title : `Linked by ${nameOf(pr.by)}`}
                    </span>
                    <span className="mt-0.5 block truncate text-meta text-ink-3">
                      {FATE[pr.state].word}
                      {task && (
                        <>
                          {" · "}
                          <span className="tabular-nums">{taskId(task.id)}</span>
                        </>
                      )}
                      {repos.size > 1 && ` · ${pr.repo}`}
                    </span>
                  </span>
                  <When at={pr.last} now={now} />
                </a>
              </li>
            )
          })}
        </ul>
      ) : (
        <Quiet>GitHub pull requests linked here show up as they come.</Quiet>
      )}
    </Card>
  )
}

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
    <aside aria-label="Overview" style={{ width: FLOAT_W, right: FLOAT_GAP }} className="pointer-events-none absolute top-[calc(var(--head)+8px)] bottom-6 z-30 hidden flex-col xl:flex">
      <div className="pointer-events-auto flex max-h-full [scrollbar-width:none] flex-col gap-3 overflow-y-auto p-px">
        <Agents agents={agents} now={now} onOpenTask={onOpenTask} />
        <Tasks state={state} now={now} nameOf={nameOf} onOpen={onOpenTask} onAll={onAllTasks} />
        <Pulls prs={prs} state={state} now={now} nameOf={nameOf} />
      </div>
    </aside>
  )
}
