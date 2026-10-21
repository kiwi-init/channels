import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { useMemo, useState } from "react"

import { taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { freesOf, freesWord, suggestFor, takesWork, toneOf, unassigned, type Frees, type Suggestion } from "@/lib/frees"
import { formatAgoShort } from "@/lib/format"
import { cx } from "@/lib/utils"
import type { AgentNow } from "../agent-strip"
import { Icon } from "../icon"
import { Button } from "../kit"
import { StateMark } from "../tasks"
import { TasksView } from "../tasks-view"
import { Face, TONE_DOT, TONE_TEXT } from "./parts"

const ORDER: Record<Frees["kind"], number> = { free: 0, review: 0, working: 1, reviewing: 1, you: 2, lease: 2, away: 3 }

function SeatChip({ a, f, now, nameOf }: { a: AgentNow; f: Frees; now: number; nameOf: (n: string) => string }) {
  const tone = toneOf(f)
  return (
    <li className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 edge">
      <Face a={a} size={22} />
      <span className="text-ui font-medium text-ink">{nameOf(a.name)}</span>
      <span className={cx("flex items-center gap-1 text-meta", tone === "free" ? "text-ink-2" : TONE_TEXT[tone])}>
        <span aria-hidden className={cx("size-1.5 rounded-full", TONE_DOT[tone])} />
        {freesWord(f, now, nameOf).label}
      </span>
    </li>
  )
}

function Candidates({ s, state, agents, now, nameOf }: { s: Suggestion; state: ChannelState; agents: Map<string, AgentNow>; now: number; nameOf: (n: string) => string }) {
  return (
    <div className="mx-3 mb-3 ml-[54px] rounded-card edge">
      <p className="border-b border-line px-3 py-2 text-meta text-ink-3">Who could take it, best first: context from earlier work, then how much is ahead of it</p>
      <ul className="divide-y divide-line">
        {s.ranked
          .flatMap((c) => {
            const a = agents.get(c.name)
            return a ? [{ c, a, f: freesOf(state, a, now) }] : []
          })
          .sort((x, y) => y.c.score - x.c.score || Number(takesWork(y.f)) - Number(takesWork(x.f)) || x.c.queue - y.c.queue)
          .map(({ c, a, f }) => {
            const tone = toneOf(f)
            return (
              <li key={c.name} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 md:grid-cols-[24px_minmax(0,160px)_minmax(0,1fr)_150px_auto]">
                <Face a={a} size={24} />
                <span className="truncate text-ui font-semibold">{nameOf(c.name)}</span>
                <span className="hidden truncate text-meta text-ink-3 md:block">{c.reasons[0] ?? "no context from earlier work"}</span>
                <span className={cx("hidden items-center gap-1.5 text-meta md:flex", tone === "free" ? "text-ink-2" : TONE_TEXT[tone])}>
                  <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
                  <span className="truncate">{freesWord(f, now, nameOf).label}</span>
                  {c.queue ? <span className="shrink-0 text-ink-3 tabular-nums">· {c.queue} ahead</span> : null}
                </span>
                <Button variant={takesWork(f) ? "secondary" : "ghost"} size="sm">
                  Give
                </Button>
              </li>
            )
          })}
      </ul>
    </div>
  )
}

function UpNextRow({
  task,
  s,
  now,
  nameOf,
  agents,
  state,
  choosing,
  onChoose,
}: {
  task: Task
  s: Suggestion
  now: number
  nameOf: (n: string) => string
  agents: Map<string, AgentNow>
  state: ChannelState
  choosing: boolean
  onChoose: () => void
}) {
  const pick = s.pick ? agents.get(s.pick.name) : undefined
  return (
    <li>
      <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3.5 rounded-row px-3 py-2.5 transition-colors hover:bg-wash md:grid-cols-[28px_minmax(0,1fr)_236px_auto_44px]">
        <span className="flex size-7 items-center justify-center">
          <StateMark state={task.state} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-body leading-snug text-ink">{task.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-ink-3">
            <span className="shrink-0 tabular-nums">{taskId(task.id)}</span>
            {task.from !== undefined && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0 tabular-nums">from {taskId(task.from)}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="shrink-0">unassigned</span>
          </span>
        </span>
        <span className="hidden min-w-0 items-center gap-2 md:flex">
          {pick ? (
            <>
              <Face a={pick} size={22} />
              <span className="min-w-0">
                <span className="block truncate text-meta font-semibold text-ink">{nameOf(pick.name)}</span>
                <span className="line-clamp-2 block text-stamp text-ink-3">{s.pick!.reasons[0]}</span>
              </span>
            </>
          ) : (
            <span className="text-meta text-decide">No one has its context</span>
          )}
        </span>
        {pick ? (
          <Button variant="secondary" size="sm">
            Give to {nameOf(pick.name)}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={onChoose} aria-expanded={choosing}>
            Choose
            <Icon icon={ArrowDown01Icon} size={14} className={cx("transition-transform", choosing && "rotate-180")} />
          </Button>
        )}
        <time className="hidden text-right text-meta text-ink-3 tabular-nums md:block">{formatAgoShort(task.createdAt, now)}</time>
      </div>
      {choosing && <Candidates s={s} state={state} agents={agents} now={now} nameOf={nameOf} />}
    </li>
  )
}

export function HandOff({ state, agents, now, nameOf, choosing: startChoosing }: { state: ChannelState; agents: AgentNow[]; now: number; nameOf: (n: string) => string; choosing: number | null }) {
  const [choosing, setChoosing] = useState<number | null>(startChoosing)
  const queue = useMemo(() => unassigned(state), [state])
  const byName = useMemo(() => new Map(agents.map((a) => [a.name, a])), [agents])
  const seats = useMemo(
    () =>
      agents
        .filter((a) => !a.lead)
        .map((a) => ({ a, f: freesOf(state, a, now) }))
        .sort((x, y) => ORDER[x.f.kind] - ORDER[y.f.kind]),
    [agents, state, now]
  )
  const free = seats.filter((s) => takesWork(s.f)).length
  return (
    <div>
      <section aria-label="Who can take work" className="px-3 pt-4">
        <h2 className="flex items-baseline gap-2 pb-2 text-ui font-semibold">
          Agents <span className="font-normal text-ink-3 tabular-nums">{free} can take work</span>
        </h2>
        <ul className="flex flex-wrap gap-1.5">
          {seats.map((s) => (
            <SeatChip key={s.a.name} a={s.a} f={s.f} now={now} nameOf={nameOf} />
          ))}
        </ul>
      </section>
      <section aria-label="Up next" className="pt-5">
        <h2 className="flex items-baseline gap-2 px-3 pb-1.5 text-ui font-semibold">
          Up next <span className="font-normal text-ink-3 tabular-nums">{queue.length}</span>
          <span className="ml-auto text-meta font-normal text-ink-3">suggested by context, as kiwi task who ranks them</span>
        </h2>
        <ul className="divide-y divide-line">
          {queue.map((t) => (
            <UpNextRow
              key={t.id}
              task={t}
              s={suggestFor(state, t.id)}
              now={now}
              nameOf={nameOf}
              agents={byName}
              state={state}
              choosing={choosing === t.id}
              onChoose={() => setChoosing((c) => (c === t.id ? null : t.id))}
            />
          ))}
        </ul>
      </section>
      <TasksView state={state} now={now} view="doing" agents={agents} needs={null} open={null} onOpen={() => {}} />
    </div>
  )
}
