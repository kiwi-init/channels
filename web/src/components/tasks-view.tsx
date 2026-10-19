import { CancelCircleIcon, CheckmarkCircle02Icon, Loading03Icon } from "@hugeicons/core-free-icons"
import type { ReactNode } from "react"

import { colorOf, taskId, tasksAwaitingPeople, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { taskPr, type PrChecks } from "@kiwi/core/work.ts"
import { formatAgoShort, memberName } from "@/lib/format"
import { taskGroups, type View } from "@/lib/views"
import { cx } from "@/lib/utils"
import { doingNow, type AgentNow } from "./agent-strip"
import { Icon } from "./icon"
import { Monogram } from "./kit"
import { isAgent } from "./message"
import { PrCell, type Pr } from "./pr-cell"
import { DecisionMark, labelOf, StateMark } from "./tasks"

function checksWords(checks: PrChecks): { icon: typeof CheckmarkCircle02Icon; tone: string; text: string } {
  const total = checks.passed + checks.failed.length + checks.running
  if (checks.failed.length) return { icon: CancelCircleIcon, tone: "text-alert", text: checks.failed.length === 1 ? `${checks.failed[0]} failed` : `${checks.failed.length} failed` }
  if (checks.running) return { icon: Loading03Icon, tone: "text-doing", text: `${checks.passed} of ${total} checks` }
  return { icon: CheckmarkCircle02Icon, tone: "text-live", text: "checks passed" }
}

function ChecksCell({ pr }: { pr: Pr | undefined }) {
  if (pr?.pr.state === "merged")
    return (
      <span className="flex items-center gap-1.5 text-meta text-ink-2">
        <Icon icon={CheckmarkCircle02Icon} size={15} className="shrink-0 text-live" />
        merged
      </span>
    )
  if (!pr?.checks) return <span className="text-meta text-ink-3">—</span>
  const w = checksWords(pr.checks)
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-meta text-ink-2">
      <Icon icon={w.icon} size={15} className={cx("shrink-0", w.tone)} />
      <span className="truncate">{w.text}</span>
    </span>
  )
}

function TaskRow({
  task,
  state,
  now,
  agent,
  waiting,
  open,
  detail,
  onOpen,
}: {
  task: Task
  state: ChannelState
  now: number
  agent: AgentNow | undefined
  waiting: boolean
  open: boolean
  detail: ReactNode
  onOpen: (id: number) => void
}) {
  const owner = task.owner ? state.members.get(task.owner) : undefined
  const doing = agent && agent.load.current.some((t) => t.id === task.id) ? doingNow(agent) : null
  const pr = taskPr(state, task.id)
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${taskId(task.id)}, ${task.title}`}
        onClick={() => onOpen(task.id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(task.id))}
        className={cx(
          "relative grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_44px] items-center gap-x-3.5 rounded-row px-3 py-2.5 transition-colors hover:bg-wash md:grid-cols-[28px_minmax(0,1fr)_168px_44px] lg:grid-cols-[28px_minmax(0,1fr)_168px_128px_44px]",
          open && "before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
        )}
      >
        {task.owner ? (
          <Monogram name={memberName(owner, task.owner)} hue={task.owner} agent={isAgent(owner)} color={colorOf(state, task.owner)} size={28} />
        ) : (
          <span className="flex size-7 items-center justify-center">
            <StateMark state={task.state} />
          </span>
        )}
        <span className="min-w-0">
          <span className={cx("block truncate text-body leading-snug", task.state === "done" ? "text-ink-2" : "text-ink", open && "font-semibold")}>{task.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-ink-3">
            <span className="shrink-0 tabular-nums">{taskId(task.id)}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{task.owner ? memberName(owner, task.owner) : "unassigned"}</span>
            <span aria-hidden>·</span>
            {waiting ? (
              <DecisionMark />
            ) : doing ? (
              <span className={cx("flex min-w-0 items-center gap-1.5", doing.busy ? "text-doing" : "text-ink-3")}>
                {doing.busy && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-doing shadow-[0_0_0_3px_color-mix(in_srgb,var(--doing)_18%,transparent)]" />}
                <span className="truncate">{doing.text}</span>
              </span>
            ) : (
              <span className="truncate">{labelOf(task)}</span>
            )}
          </span>
        </span>
        <span className="hidden min-w-0 md:block">
          <PrCell pr={pr} done={task.state === "done"} />
        </span>
        <span className="hidden min-w-0 lg:block">
          <ChecksCell pr={pr} />
        </span>
        <time className="text-right text-meta text-ink-3 tabular-nums">{formatAgoShort(task.updatedAt, now)}</time>
      </div>
      {open && detail}
    </li>
  )
}

function Group({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <section aria-label={label} className="pt-4">
      <h2 className="flex items-baseline gap-2 px-3 pb-1.5 text-ui font-semibold">
        {label} <span className="font-normal text-ink-3 tabular-nums">{count}</span>
      </h2>
      {children}
    </section>
  )
}

export function TasksView({
  state,
  now,
  view,
  agents,
  needs,
  open,
  detail,
  onOpen,
}: {
  state: ChannelState
  now: number
  view: View
  agents: AgentNow[]
  needs: ReactNode
  open: number | null
  detail: (id: number) => ReactNode
  onOpen: (id: number) => void
}) {
  const groups = taskGroups(state, view, now)
  const byName = new Map(agents.map((a) => [a.name, a]))
  const showNeeds = view === "everything" || view === "needs"
  const waiting = tasksAwaitingPeople(state)
  if (!state.tasks.size && !(showNeeds && needs))
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="max-w-xs">
          <p className="text-body font-semibold">No tasks yet</p>
          <p className="mt-1 text-ui leading-normal text-ink-2">When agents split up work, each task and who has it shows up here, and in the conversation where it was made.</p>
        </div>
      </div>
    )
  return (
    <div className="pb-8">
      {showNeeds && <div className="px-3">{needs}</div>}
      {view === "needs" && !needs && <p className="px-3 pt-6 text-ui text-ink-3">Nothing needs you right now.</p>}
      {groups.map((g) =>
        g.tasks.length || view !== "everything" ? (
          <Group key={g.key} label={g.label} count={g.tasks.length}>
            {g.tasks.length ? (
              <ul className="divide-y divide-line">
                {g.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    state={state}
                    now={now}
                    agent={t.owner ? byName.get(t.owner) : undefined}
                    waiting={waiting.has(t.id)}
                    open={open === t.id}
                    detail={open === t.id ? detail(t.id) : null}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-3 py-2 text-ui text-ink-3">Nothing here right now.</p>
            )}
          </Group>
        ) : null
      )}
    </div>
  )
}
