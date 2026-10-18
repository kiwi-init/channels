// What the agents are doing, at a glance, under the composer's field: their faces and one line (who's
// working on what). A click grows the composer upward into the whole team, one row each: what they're
// on (a task opens it), what's queued, or that they're idle or away. Read from the task board every
// member already holds (load.ts), so it says what `kiwi status` says.

import { ArrowUp01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import type { Load } from "@kiwi/core/load.ts"
import type { Activity, Card, Color } from "@kiwi/core/protocol.ts"
import { taskId } from "@kiwi/core/state.ts"
import { formatAgo, shortTitle } from "@/lib/format"
import { howWords, type How } from "@/lib/presence"
import { cx } from "@/lib/utils"
import { RepoLine } from "./agent-facts"
import { Icon } from "./icon"
import { Monogram } from "./kit"

export interface AgentNow {
  name: string
  label: string
  color: Color | null
  here: How | null
  lead: boolean
  /** The model it says it runs on (its card, or what its harness says now). */
  model?: string
  /** What it's doing right now, live from its harness (presence). */
  activity?: Activity
  load: Load
  /** When they last said something in the channel. */
  lastAt?: number
  card?: Pick<Card, "repo" | "branch">
  outside?: boolean
}

/** What it's doing now, in a few words: live from its harness when it says, else from its tasks. */
export function doingNow(a: AgentNow): { text: string; busy: boolean } | null {
  const act = a.here ? a.activity : undefined
  if (act?.state === "working") return { text: act.tool ? `Running ${act.tool}` : "Thinking", busy: true }
  if (act?.state === "waiting") return { text: "Waiting for a person", busy: false }
  if (act?.state === "idle") return { text: "Idle", busy: false }
  return null
}

const busy = (a: AgentNow) => !!a.here && (doingNow(a)?.busy ?? a.load.current.length > 0)

export const byBusy = (agents: AgentNow[]) => [...agents].sort((a, b) => Number(busy(b)) - Number(busy(a)) || Number(!!b.here) - Number(!!a.here))

const face = (a: AgentNow, size: number) => <Monogram name={a.label} hue={a.name} agent color={a.color} size={size} online={size > 20 && !!a.here} />

export function AgentRow({ a, onOpenTask }: { a: AgentNow; onOpenTask: (id: number) => void }) {
  const doing = doingNow(a)
  const task = a.load.current[0]
  const what = [task ? taskId(task.id) : null, doing?.text ?? (a.here ? (howWords(a.here) ?? "idle") : "away")].filter(Boolean).join(" · ")
  return (
    <li>
      <button
        type="button"
        onClick={() => task && onOpenTask(task.id)}
        disabled={!task}
        className="flex w-full items-center gap-3 rounded-row px-2 py-1.5 text-left transition-colors enabled:hover:bg-wash"
      >
        {face(a, 28)}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-ui font-medium text-ink">{a.label}</span>
            {a.lead && <span className="shrink-0 text-meta text-ink-3">lead</span>}
          </span>
          <span className="flex items-center gap-1.5 text-meta text-ink-3">
            {doing?.busy && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-doing" />}
            <span className="truncate">{what}</span>
          </span>
        </span>
      </button>
    </li>
  )
}

export function AgentLine({ a, now, onOpenTask, brief }: { a: AgentNow; now: number; onOpenTask: (id: number) => void; brief?: boolean }) {
  return (
    <li className="flex items-start gap-3 rounded-ctl px-2 py-2">
      <span className="flex pt-0.5">{face(a, 28)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-ui font-semibold">{a.label}</span>
          {a.model && !brief && <span className="truncate text-stamp text-ink-3">{a.model}</span>}
          {a.lead && <span className="shrink-0 text-stamp text-ink-3">lead</span>}
          <span className="ml-auto shrink-0 text-stamp text-ink-3">{a.here ? "online" : a.lastAt && !brief ? `away · ${formatAgo(a.lastAt, now)}` : "away"}</span>
        </span>
        {a.card?.repo && !brief && <RepoLine card={a.card} outside={!!a.outside} className="text-meta" />}
        {doingNow(a) && (
          <span className="flex items-center gap-1.5 text-meta">
            <span className={cx("size-1.5 shrink-0 rounded-full", doingNow(a)!.busy ? "animate-pulse bg-doing" : "bg-ink-3")} />
            <span className={doingNow(a)!.busy ? "font-medium text-ink" : "text-ink-3"}>{doingNow(a)!.text}</span>
            {a.activity?.since && <span className="text-ink-3">· {formatAgo(a.activity.since, now)}</span>}
          </span>
        )}
        {a.load.current.length ? (
          a.load.current.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpenTask(t.id)} className="block max-w-full truncate text-left text-meta text-ink-2 hover:text-ink hover:underline">
              <span className="font-medium text-doing">Working on</span> <span className="tabular-nums">{taskId(t.id)}</span> {t.title}
            </button>
          ))
        ) : doingNow(a) ? null : a.here ? (
          howWords(a.here) && <span className="block text-meta text-ink-3">{howWords(a.here)}</span>
        ) : (
          <span className="block text-meta text-ink-3">Not listening</span>
        )}
        {(a.load.queued.length > 0 || a.load.waiting.length > 0) && (
          <span className="block text-stamp text-ink-3">
            {[a.load.queued.length ? `${a.load.queued.length} queued` : null, a.load.waiting.length ? `${a.load.waiting.length} waiting for review` : null].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
    </li>
  )
}

export function AgentStrip({ agents, now, onOpenTask }: { agents: AgentNow[]; now: number; onOpenTask: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  if (!agents.length) return null
  const ordered = byBusy(agents)
  const working = ordered.filter(busy)
  const here = agents.filter((a) => a.here).length
  const line = working.length
    ? working
        .slice(0, 2)
        .map((a) => (a.load.current[0] ? `${a.label} on ${shortTitle(a.load.current[0].title)}` : `${a.label}: ${doingNow(a)?.text ?? "working"}`))
        .join(" · ") + (working.length > 2 ? ` · ${working.length - 2} more` : "")
    : here
      ? "Nobody's working on a task right now"
      : "No agent is online"

  return (
    <div className="border-t border-line">
      <div className={cx("grid transition-[grid-template-rows] duration-200", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="min-h-0 overflow-hidden">
          <ul aria-label="What the agents are doing" className="max-h-72 overflow-y-auto px-1.5 pt-1.5">
            {ordered.map((a) => (
              <AgentLine key={a.name} a={a} now={now} onOpenTask={onOpenTask} />
            ))}
          </ul>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-2.5 px-3.5 text-left text-meta text-ink-2 transition-colors hover:text-ink"
      >
        <span aria-hidden className="flex shrink-0 -space-x-1.5 [&>*]:rounded-full [&>*]:shadow-[0_0_0_2px_var(--canvas)]">
          {ordered.slice(0, 4).map((a) => (
            <span key={a.name} className="flex">
              {face(a, 20)}
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-ink">{working.length ? `${working.length} working` : `${here} online`}</span> · {line}
        </span>
        <Icon icon={ArrowUp01Icon} size={14} className={cx("shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-180")} />
      </button>
    </div>
  )
}
