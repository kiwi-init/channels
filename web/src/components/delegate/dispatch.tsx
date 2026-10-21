import { DragDropVerticalIcon } from "@hugeicons/core-free-icons"
import { useMemo, useState, type DragEvent } from "react"

import { taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { checksLine, freesOf, suggestFor, takesWork, toneOf, unassigned, type Frees, type Suggestion } from "@/lib/frees"
import { formatAgoShort } from "@/lib/format"
import { cx } from "@/lib/utils"
import type { AgentNow } from "../agent-strip"
import { Icon } from "../icon"
import { Button } from "../kit"
import { Face, FreesLine, ModelLine, NowLine, Segmented, TaskName } from "./parts"

export type HandOut = "auto" | "hold"

const ORDER: Record<Frees["kind"], number> = { free: 0, review: 0, working: 1, reviewing: 1, you: 2, lease: 2, away: 3 }

interface Seat {
  a: AgentNow
  f: Frees
}

function seatsOf(state: ChannelState, agents: AgentNow[], now: number): Seat[] {
  return agents
    .filter((a) => !a.lead)
    .map((a) => ({ a, f: freesOf(state, a, now) }))
    .sort((x, y) => ORDER[x.f.kind] - ORDER[y.f.kind] || x.a.name.localeCompare(y.a.name))
}

function reasonOf(s: Suggestion, name: string): string | null {
  return s.ranked.find((c) => c.name === name)?.reasons[0] ?? null
}

function QueueCard({
  task,
  s,
  mode,
  now,
  nameOf,
  agentOf,
  moving,
  onGive,
  onDrag,
}: {
  task: Task
  s: Suggestion
  mode: HandOut
  now: number
  nameOf: (n: string) => string
  agentOf: (n: string) => AgentNow | undefined
  moving: boolean
  onGive: (id: number, name: string) => void
  onDrag: (id: number | null) => void
}) {
  const pick = s.pick ? agentOf(s.pick.name) : undefined
  const from = task.from !== undefined ? ` · from ${taskId(task.from)}` : ""
  return (
    <li
      draggable
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData("text/plain", String(task.id))
        e.dataTransfer.effectAllowed = "move"
        onDrag(task.id)
      }}
      onDragEnd={() => onDrag(null)}
      aria-label={`${taskId(task.id)}, ${task.title}`}
      className={cx("group cursor-grab rounded-card px-3 py-2.5 transition-colors active:cursor-grabbing", moving ? "border border-dashed border-edge-strong opacity-45" : "edge hover:bg-wash")}
    >
      <span className="flex items-start gap-2">
        <Icon icon={DragDropVerticalIcon} size={16} className="mt-0.5 shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-ui font-semibold text-ink">{task.title}</span>
          <span className="mt-0.5 block text-meta text-ink-3 tabular-nums">
            {taskId(task.id)}
            {from} · {formatAgoShort(task.createdAt, now)}
          </span>
        </span>
      </span>
      <span className="mt-2 flex items-center gap-2 border-t border-line pt-2 pl-6">
        {pick ? (
          <>
            <Face a={pick} size={18} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-meta text-ink-2">
                {mode === "auto" ? "Goes to " : ""}
                <span className="font-semibold text-ink">{nameOf(pick.name)}</span>
                {s.pick!.queue ? <span className="text-ink-3"> · {s.pick!.queue} ahead</span> : null}
              </span>
              <span className="line-clamp-2 block text-stamp text-ink-3">{s.pick!.reasons[0]}</span>
            </span>
            {mode === "hold" && (
              <Button variant="secondary" size="sm" onClick={() => onGive(task.id, pick.name)}>
                Give
              </Button>
            )}
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-meta text-decide">No one has its context</span>
            <Button variant="secondary" size="sm">
              Pick…
            </Button>
          </>
        )}
      </span>
    </li>
  )
}

function GhostCard({ task }: { task: Task }) {
  return (
    <span aria-hidden className="pointer-events-none absolute top-[62%] left-[-210px] z-10 w-[280px] -translate-y-1/2 rotate-[-1.5deg] rounded-card bg-raised px-3 py-2.5 shadow-pop">
      <span className="flex items-start gap-2">
        <Icon icon={DragDropVerticalIcon} size={16} className="mt-0.5 shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-ui font-semibold text-ink">{task.title}</span>
          <span className="mt-0.5 block text-meta text-ink-3 tabular-nums">{taskId(task.id)}</span>
        </span>
      </span>
    </span>
  )
}

function SeatRow({
  seat,
  state,
  now,
  nameOf,
  over,
  carrying,
  carryReason,
  onOver,
  onDrop,
}: {
  seat: Seat
  state: ChannelState
  now: number
  nameOf: (n: string) => string
  over: boolean
  carrying: Task | null
  carryReason: string | null
  onOver: (name: string | null) => void
  onDrop: (name: string) => void
}) {
  const { a, f } = seat
  const work = f.kind === "working" ? f.task : f.kind === "review" || f.kind === "reviewing" ? f.task : f.kind === "away" || f.kind === "you" || f.kind === "lease" ? f.task : undefined
  const checks = f.kind === "working" || f.kind === "review" ? checksLine(f.checks) : null
  const pr = f.kind === "working" || f.kind === "review" ? f.pr : undefined
  const queued = a.load.queued
  const open = takesWork(f)
  return (
    <li
      onDragOver={(e) => {
        e.preventDefault()
        onOver(a.name)
      }}
      onDragLeave={() => onOver(null)}
      onDrop={(e) => {
        e.preventDefault()
        onDrop(a.name)
      }}
      className={cx(
        "relative grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-row px-3 py-3 transition-colors md:grid-cols-[36px_minmax(0,0.9fr)_minmax(0,1.3fr)_176px]",
        over ? "bg-accent-wash shadow-[inset_0_0_0_1px_var(--accent)]" : "hover:bg-wash"
      )}
    >
      <Face a={a} size={36} />
      <span className="min-w-0">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-ui font-semibold">{nameOf(a.name)}</span>
          {a.lead && <span className="shrink-0 text-meta text-ink-3">lead</span>}
          {state.roleSets.get(a.name)?.role === "reviewer" && <span className="shrink-0 text-meta text-ink-3">reviewer</span>}
        </span>
        <ModelLine a={a} />
        <NowLine a={a} now={now} />
      </span>
      <span className="col-span-2 min-w-0 md:col-span-1">
        {over && carrying ? (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui font-semibold text-accent-text">
              Drop to give {taskId(carrying.id)} to {nameOf(a.name)}
            </span>
            <span className="truncate text-meta text-ink-2">{carryReason ?? "no context from earlier work"}</span>
          </span>
        ) : work ? (
          <span className="flex min-w-0 flex-col">
            <TaskName task={work} className="text-ui text-ink" />
            <span className="flex min-w-0 items-center gap-1.5 text-meta text-ink-3 tabular-nums">
              {pr ? <span className="shrink-0">PR #{pr}</span> : null}
              {checks ? <span className={cx("truncate", checks.includes("failed") ? "text-alert" : checks.startsWith("CI") && "text-doing")}>· {checks}</span> : null}
              {f.kind === "review" && <span className="truncate">· round {f.task.rounds.length || 1}</span>}
              {queued.length > 0 && <span className="truncate">· then {queued.map((t) => taskId(t.id)).join(", ")}</span>}
            </span>
          </span>
        ) : (
          <span className="text-meta text-ink-3">{open ? "Ready for the next task" : ""}</span>
        )}
      </span>
      <FreesLine f={f} now={now} nameOf={nameOf} className="col-span-2 pl-12 md:col-span-1 md:pl-0" />
      {over && carrying && <GhostCard task={carrying} />}
    </li>
  )
}

export function Dispatch({
  state,
  agents,
  now,
  nameOf,
  mode: startMode = "auto",
  demo,
  onAssign,
}: {
  state: ChannelState
  agents: AgentNow[]
  now: number
  nameOf: (n: string) => string
  mode?: HandOut
  demo?: { dragging: number; over: string }
  onAssign?: (task: number, name: string) => void
}) {
  const [mode, setMode] = useState<HandOut>(startMode)
  const [dragging, setDragging] = useState<number | null>(demo?.dragging ?? null)
  const [over, setOver] = useState<string | null>(demo?.over ?? null)
  const queue = useMemo(() => unassigned(state), [state])
  const suggestions = useMemo(() => new Map(queue.map((t) => [t.id, suggestFor(state, t.id)])), [queue, state])
  const seats = useMemo(() => seatsOf(state, agents, now), [state, agents, now])
  const byName = useMemo(() => new Map(agents.map((a) => [a.name, a])), [agents])
  const carrying = dragging !== null ? (state.tasks.get(dragging) ?? null) : null
  const give = (id: number, name: string) => {
    onAssign?.(id, name)
    setDragging(null)
    setOver(null)
  }
  const free = seats.filter((s) => takesWork(s.f) && !s.a.lead).length
  const blocked = seats.filter((s) => toneOf(s.f) === "decide").length
  const away = seats.filter((s) => s.f.kind === "away").length
  return (
    <div className="pb-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pt-4 pb-3">
        <h2 className="text-title">Hand out work</h2>
        <Segmented
          label="How new tasks are handed out"
          value={mode}
          onChange={setMode}
          options={[
            ["auto", "Auto, by context"],
            ["hold", "Hold for me"],
          ]}
        />
        <span className="text-meta text-ink-3">
          {mode === "auto" ? `${state.lead ? nameOf(state.lead) : "The lead"} gives each new task to whoever has its context and room for it` : "Nothing is handed out until you give it to someone"}
        </span>
        <span className="flex-1" />
        <span className="text-meta text-ink-2 tabular-nums">
          {free} can take work · {blocked} waiting · {away} away
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
        <section aria-label="Up next" className="px-1">
          <h3 className="flex items-baseline gap-2 px-2 pb-2 text-ui font-semibold">
            Up next <span className="font-normal text-ink-3 tabular-nums">{queue.length}</span>
            <span className="ml-auto text-meta font-normal text-ink-3">drag onto an agent</span>
          </h3>
          <ul className="flex flex-col gap-2">
            {queue.map((t) => (
              <QueueCard
                key={t.id}
                task={t}
                s={suggestions.get(t.id)!}
                mode={mode}
                now={now}
                nameOf={nameOf}
                agentOf={(n) => byName.get(n)}
                moving={dragging === t.id}
                onGive={give}
                onDrag={setDragging}
              />
            ))}
          </ul>
        </section>
        <section aria-label="Agents" className="min-w-0">
          <h3 className="hidden grid-cols-[36px_minmax(0,0.9fr)_minmax(0,1.3fr)_176px] gap-x-3 px-3 pb-2 text-meta text-ink-3 md:grid">
            <span />
            <span>Agent</span>
            <span>On it now</span>
            <span>Frees when</span>
          </h3>
          <ul className="divide-y divide-line">
            {seats.map((s) => (
              <SeatRow
                key={s.a.name}
                seat={s}
                state={state}
                now={now}
                nameOf={nameOf}
                over={over === s.a.name && carrying !== null}
                carrying={carrying}
                carryReason={carrying ? reasonOf(suggestions.get(carrying.id) ?? { pick: null, ranked: [] }, s.a.name) : null}
                onOver={setOver}
                onDrop={(name) => dragging !== null && give(dragging, name)}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
