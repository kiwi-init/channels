import { CancelCircleIcon, CheckmarkCircle02Icon, Loading03Icon } from "@hugeicons/core-free-icons"
import { Component, createRef, useRef, useState, type ReactNode } from "react"

import { MAX_GOAL_NAME } from "@kiwi/core/protocol.ts"
import { colorOf, mayNameGoal, taskId, tasksAwaitingPeople, type AskHead, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { taskPr, type PrChecks } from "@kiwi/core/work.ts"
import { formatAgoShort, memberName } from "@/lib/format"
import { labelOf } from "@/lib/task-labels"
import { taskGroups, type View } from "@/lib/views"
import { cx } from "@/lib/utils"
import { doingNow, type AgentNow } from "./agent-strip"
import { Icon } from "./icon"
import { Monogram } from "./kit"
import { isAgent } from "./message"
import { PrCell, type Pr } from "./pr-cell"
import { DecisionMark, StateMark } from "./tasks"

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
  if (!pr?.checks) return null
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
  prs,
  onOpen,
}: {
  task: Task
  state: ChannelState
  now: number
  agent: AgentNow | undefined
  waiting: boolean
  open: boolean
  prs: boolean
  onOpen: (id: number) => void
}) {
  const owner = task.owner ? state.members.get(task.owner) : undefined
  const doing = agent && agent.load.current.some((t) => t.id === task.id) ? doingNow(agent) : null
  const pr = taskPr(state, task.id)
  return (
    <li data-slide={`t${task.id}`} className="bg-canvas">
      <div
        role="button"
        tabIndex={0}
        aria-current={open || undefined}
        aria-label={`${taskId(task.id)}, ${task.title}`}
        onClick={() => onOpen(task.id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(task.id))}
        className={cx(
          "relative grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_44px] items-center gap-x-3.5 rounded-row px-3 py-2.5 transition-colors hover:bg-wash",
          prs && "@lg:grid-cols-[28px_minmax(0,1fr)_168px_44px] @2xl:grid-cols-[28px_minmax(0,1fr)_168px_128px_44px]",
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
        {prs && (
          <>
            <span className="hidden min-w-0 @lg:block">{pr && <PrCell pr={pr} />}</span>
            <span className="hidden min-w-0 @2xl:block">
              <ChecksCell pr={pr} />
            </span>
          </>
        )}
        <time className="text-right text-meta text-ink-3 tabular-nums">{formatAgoShort(task.updatedAt, now)}</time>
      </div>
    </li>
  )
}

function GoalName({ ask, onSave, onDone }: { ask: AskHead; onSave: (name: string | null) => Promise<void>; onDone: () => void }) {
  const [value, setValue] = useState(ask.goal ?? "")
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const save = async () => {
    if (busy.current) return
    const name = value.trim()
    if (name === (ask.goal ?? "")) return onDone()
    busy.current = true
    setSaving(true)
    try {
      await onSave(name || null)
      onDone()
    } catch {
      // The send failed and onSave said so: keep the field open with what was typed.
      busy.current = false
      setSaving(false)
    }
  }
  return (
    <input
      autoFocus
      aria-label={`Goal of #${ask.id}`}
      value={value}
      maxLength={MAX_GOAL_NAME}
      disabled={saving}
      placeholder="The goal in plain words"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          void save()
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          busy.current = true
          onDone()
        }
      }}
      className="min-w-0 flex-1 rounded-ctl bg-transparent px-2 py-0.5 text-ui font-semibold text-ink edge placeholder:font-normal placeholder:text-ink-3"
    />
  )
}

function AskGroup({
  ask,
  count,
  state,
  me,
  onJump,
  onNameGoal,
  children,
}: {
  ask: AskHead | null
  count: number
  state: ChannelState
  me: string
  onJump: (seq: number) => void
  onNameGoal: (ask: number, name: string | null) => Promise<void>
  children: ReactNode
}) {
  const [naming, setNaming] = useState(false)
  const words = ask?.words.trim() ?? ""
  const said = words ? `“${words}”` : `#${ask?.id}`
  const label = ask ? (ask.goal ?? said) : "Unfiled"
  const by = ask ? memberName(state.members.get(ask.by), ask.by) : ""
  const may = !!ask && mayNameGoal(state, me, ask)
  return (
    <section aria-label={label} className="group/goal pt-4">
      <div data-slide={`g${ask?.id ?? "unfiled"}`}>
        <h2 title={ask?.goal ? undefined : words || undefined} className={cx("flex min-w-0 items-baseline gap-2 px-3 text-ui font-semibold", naming && "pb-1.5")}>
          {ask && naming ? <GoalName ask={ask} onSave={(name) => onNameGoal(ask.id, name)} onDone={() => setNaming(false)} /> : <span className="truncate">{label}</span>}
          {!naming && <span className="shrink-0 font-normal text-ink-3 tabular-nums">{count}</span>}
          {may && !naming && (
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="ml-auto shrink-0 rounded-row px-1.5 text-meta font-normal text-ink-3 opacity-0 transition-opacity group-hover/goal:opacity-100 hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100"
            >
              {ask.goal ? "Rename" : "Name the goal"}
            </button>
          )}
        </h2>
        {ask ? (
          <p className="flex min-w-0 items-baseline gap-1.5 px-3 pb-1.5 text-meta text-ink-3">
            <button type="button" onClick={() => onJump(ask.id)} className="shrink-0 tabular-nums underline decoration-line underline-offset-2 hover:text-ink hover:decoration-ink-3">
              from #{ask.id}
            </button>
            <span aria-hidden>·</span>
            <span className="shrink-0">{by}</span>
            {ask.goal && words && (
              <>
                <span aria-hidden>·</span>
                <span title={words} className="truncate">
                  {said}
                </span>
              </>
            )}
          </p>
        ) : (
          <p className="truncate px-3 pb-1.5 text-meta text-ink-3">No person's message holds these</p>
        )}
      </div>
      {children}
    </section>
  )
}

const SLIDE: KeyframeAnimationOptions = { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }

function slides(box: HTMLElement): Map<string, HTMLElement> {
  return new Map([...box.querySelectorAll<HTMLElement>("[data-slide]")].map((el) => [el.dataset.slide ?? "", el]))
}

const SLIDES_UP_TO = 24

class Reorder extends Component<{ order: string; rows: number; children: ReactNode }> {
  box = createRef<HTMLDivElement>()

  getSnapshotBeforeUpdate(prev: { order: string }): Map<string, number> | null {
    const box = this.box.current
    if (prev.order === this.props.order || this.props.rows > SLIDES_UP_TO || !box || document.documentElement.classList.contains("reduce-motion")) return null
    return new Map([...slides(box)].map(([key, el]) => [key, el.getBoundingClientRect().top]))
  }

  componentDidUpdate(_prev: unknown, _state: unknown, first: Map<string, number> | null) {
    const box = this.box.current
    if (!first || !box) return
    const near = (y: number) => y > -200 && y < window.innerHeight + 200
    for (const [key, el] of slides(box)) {
      const from = first.get(key)
      if (from === undefined) continue
      for (const a of el.getAnimations()) a.cancel()
      const to = el.getBoundingClientRect().top
      if (Math.abs(from - to) > 0.5 && (near(from) || near(to))) el.animate([{ transform: `translateY(${from - to}px)` }, { transform: "none" }], SLIDE)
    }
  }

  render() {
    return (
      <div ref={this.box} className="@container pb-8">
        {this.props.children}
      </div>
    )
  }
}

export function TasksView({
  state,
  now,
  view,
  agents,
  needs,
  empty,
  open,
  onOpen,
  me,
  onJump,
  onNameGoal,
}: {
  state: ChannelState
  now: number
  view: View
  agents: AgentNow[]
  needs: ReactNode
  empty?: ReactNode
  open: number | null
  onOpen: (id: number) => void
  me: string
  onJump: (seq: number) => void
  onNameGoal: (ask: number, name: string | null) => Promise<void>
}) {
  const groups = taskGroups(state, view, now)
  const prs = groups.some((g) => g.tasks.some((t) => taskPr(state, t.id)))
  const byName = new Map(agents.map((a) => [a.name, a]))
  const showNeeds = view === "everything" || view === "needs"
  const waiting = tasksAwaitingPeople(state)
  if (!state.tasks.size && empty)
    return (
      <div className="pb-8">
        {showNeeds && needs && <div className="px-3">{needs}</div>}
        {empty}
      </div>
    )
  if (!state.tasks.size && !(showNeeds && needs))
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="max-w-xs">
          <p className="text-body font-semibold">No tasks yet</p>
          <p className="mt-1 text-ui leading-normal text-ink-2">When agents split up work, each task and who has it shows up here, and in the conversation where it was made.</p>
        </div>
      </div>
    )
  const order = groups.map((g) => `${g.key}:${g.tasks.map((t) => t.id).join(",")}`).join(" ")
  return (
    <Reorder order={order} rows={groups.reduce((n, g) => n + g.tasks.length, 0)}>
      {showNeeds && <div className="px-3">{needs}</div>}
      {view === "needs" && !needs && <p className="px-3 pt-6 text-ui text-ink-3">Nothing needs you right now.</p>}
      {groups.map((g) => (
        <AskGroup key={g.key} ask={g.ask} count={g.tasks.length} state={state} me={me} onJump={onJump} onNameGoal={onNameGoal}>
          <ul className="divide-y divide-line">
            {g.tasks.map((t) => (
              <TaskRow key={t.id} task={t} state={state} now={now} agent={t.owner ? byName.get(t.owner) : undefined} waiting={waiting.has(t.id)} open={open === t.id} prs={prs} onOpen={onOpen} />
            ))}
          </ul>
        </AskGroup>
      ))}
      {!groups.length && view !== "everything" && view !== "needs" && <p className="px-3 pt-6 text-ui text-ink-3">Nothing here right now.</p>}
    </Reorder>
  )
}
