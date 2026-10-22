import { useMemo } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import { taskId, type ChannelState } from "@kiwi/core/state.ts"
import { prsByTask, type PrChecks, type PrRef } from "@kiwi/core/work.ts"
import { formatAgo, formatTime } from "@/lib/format"
import { laneWork, type LaneTask } from "@/lib/lanes"
import { STATE_LABEL, stateWord } from "@/lib/task-labels"
import { cx } from "@/lib/utils"
import { agentNow, byBusy, contextNow, type AgentNow } from "./agent-strip"
import { Monogram } from "./kit"

const MAX_TICKS = 8

function Ticks({ checks }: { checks: PrChecks }) {
  const ticks = [...checks.failed.map(() => "bg-alert"), ...Array.from({ length: checks.running }, () => "bg-doing"), ...Array.from({ length: checks.passed }, () => "bg-live")].slice(0, MAX_TICKS)
  const label = [checks.passed ? `${checks.passed} passed` : null, checks.failed.length ? `${checks.failed.length} failed` : null, checks.running ? `${checks.running} running` : null]
    .filter(Boolean)
    .join(", ")
  return (
    <span role="img" aria-label={`Checks: ${label}`} title={checks.failed.length ? `Failed: ${checks.failed.join(", ")}` : label} className="flex items-center gap-0.5">
      {ticks.map((c, i) => (
        <span key={i} className={cx("h-1 w-2.5 rounded-full", c)} />
      ))}
    </span>
  )
}

function PrLine({ pr }: { pr: PrRef }) {
  return (
    <span className="mt-1.5 flex items-center gap-2 text-meta text-ink-3">
      <a href={pr.url} target="_blank" rel="noreferrer" className="tabular-nums hover:text-ink hover:underline">
        PR #{pr.number}
      </a>
      {pr.state !== "open" ? <span>{pr.state}</span> : pr.checks ? <Ticks checks={pr.checks} /> : <span>no checks yet</span>}
    </span>
  )
}

function TaskBlock({ c, now, onOpen }: { c: LaneTask; now: number; onOpen: (id: number) => void }) {
  return (
    <li className="rounded-card bg-wash px-3 py-2.5">
      <button type="button" onClick={() => onOpen(c.task.id)} className="block w-full text-left">
        <span className="block text-meta text-ink-3">
          <span className="tabular-nums">{taskId(c.task.id)}</span> · {stateWord(c.task)} · {formatAgo(c.since, now)}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-ui font-semibold hover:underline">{c.task.title}</span>
      </button>
      {c.pr ? <PrLine pr={c.pr} /> : <span className="mt-1.5 block text-meta text-ink-3">no PR yet</span>}
    </li>
  )
}

function Lane({
  a,
  state,
  messages,
  prs,
  now,
  nameOf,
  onOpenTask,
}: {
  a: AgentNow
  state: ChannelState
  messages: Message[]
  prs: Map<number, PrRef[]>
  now: number
  nameOf: (n: string) => string
  onOpenTask: (id: number) => void
}) {
  const work = useMemo(() => laneWork(state, messages, a.name, prs), [state, messages, a.name, prs])
  const line = agentNow(a)
  const context = contextNow(a)
  const sponsor = state.members.get(a.name)?.sponsor?.name
  return (
    <section aria-label={a.label} className="flex min-h-0 w-72 shrink-0 flex-col gap-4 px-4 py-3 md:w-auto md:min-w-64 md:flex-1">
      <header className="flex items-center gap-3">
        <Monogram name={a.label} hue={a.name} agent color={a.color} size={36} online={!!a.here} />
        <span className="min-w-0">
          <span className="block truncate text-ui font-semibold">
            {a.label}
            {a.lead && <span className="ml-1.5 font-normal text-ink-3">lead</span>}
          </span>
          <span className="block truncate text-meta text-ink-3">{[a.name !== a.label ? `@${a.name}` : null, sponsor ? `for ${nameOf(sponsor)}` : null, a.model].filter(Boolean).join(" · ")}</span>
        </span>
      </header>

      <p className="flex items-center gap-2 border-y border-line py-2 font-mono text-meta">
        <span className={cx("size-1.5 shrink-0 rounded-full", line.busy ? "bg-doing" : a.here ? "bg-live" : "bg-ink-3")} />
        <span className={cx("truncate", line.busy ? "text-ink" : "text-ink-3")}>{line.text}</span>
        {context && <span className={cx("ml-auto shrink-0 tabular-nums", context.over ? "text-alert" : "text-ink-3")}>{context.text}</span>}
      </p>

      {work.current.length > 0 && (
        <ul className="flex flex-col gap-2">
          {work.current.map((c) => (
            <TaskBlock key={c.task.id} c={c} now={now} onOpen={onOpenTask} />
          ))}
        </ul>
      )}

      {work.next.length > 0 && (
        <div>
          <p className="mb-1 text-meta font-medium text-ink-3">{STATE_LABEL.todo}</p>
          <ul>
            {work.next.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onOpenTask(t.id)} className="flex w-full gap-3 py-1 text-left text-ui hover:underline">
                  <span className="w-12 shrink-0 text-ink-3 tabular-nums">{taskId(t.id)}</span>
                  <span className="min-w-0 truncate">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {work.watching.length > 0 && (
        <div>
          <p className="mb-1 text-meta font-medium text-ink-3">Watching</p>
          <ul>
            {work.watching.map((pr) => (
              <li key={pr.url} className="flex gap-3 py-1 text-ui">
                <a href={pr.url} target="_blank" rel="noreferrer" className="w-12 shrink-0 text-ink-3 tabular-nums hover:underline">
                  #{pr.number}
                </a>
                <span className="min-w-0 truncate">{pr.title ?? pr.branch ?? pr.repo}</span>
                {pr.checks && (
                  <span className="ml-auto self-center">
                    <Ticks checks={pr.checks} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!work.current.length && !work.next.length && !work.watching.length && <p className="text-ui text-ink-3">Nothing on its plate.</p>}

      {work.events.length > 0 && (
        <ul aria-label="Recent" className="mt-auto border-t border-line pt-2">
          {work.events.map((e) => (
            <li key={e.seq} className="flex gap-3 py-0.5 text-meta">
              <time className="w-16 shrink-0 whitespace-nowrap text-ink-3 tabular-nums">{formatTime(e.at)}</time>
              <span className="min-w-0 text-ink-2">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function AgentLanes({
  agents,
  state,
  messages,
  now,
  nameOf,
  onOpenTask,
}: {
  agents: AgentNow[]
  state: ChannelState
  messages: Message[]
  now: number
  nameOf: (name: string) => string
  onOpenTask: (id: number) => void
}) {
  const prs = useMemo(() => prsByTask(state, messages), [state, messages])
  if (!agents.length) return <p className="py-12 text-center text-ui text-ink-3">No agent has joined yet.</p>
  const ordered = byBusy(agents).sort((a, b) => Number(a.lead) - Number(b.lead))
  return (
    <div role="region" aria-label="Agent lanes" className="-mx-4 flex min-h-[calc(100dvh-var(--head)-16px)] divide-x divide-line overflow-x-auto">
      {ordered.map((a) => (
        <Lane key={a.name} a={a} state={state} messages={messages} prs={prs} now={now} nameOf={nameOf} onOpenTask={onOpenTask} />
      ))}
    </div>
  )
}
