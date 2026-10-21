import { Alert02Icon, CheckmarkCircle02Icon, HelpCircleIcon, Loading03Icon, SquareLock01Icon } from "@hugeicons/core-free-icons"
import { useMemo, type ReactNode } from "react"

import type { ChannelState, Lease } from "@kiwi/core/state.ts"
import { checksLine, freesOf, freesWord, suggestFor, takesWork, unassigned, type Frees } from "@/lib/frees"
import { excerpt, formatAgoShort } from "@/lib/format"
import { cx } from "@/lib/utils"
import type { AgentNow } from "../agent-strip"
import { Icon } from "../icon"
import { Button } from "../kit"
import { Face, NowLine, TaskName } from "./parts"

type GroupKey = "you" | "stalled" | "lease" | "working" | "free"

interface Seat {
  a: AgentNow
  f: Frees
}

const GROUPS: { key: GroupKey; title: string; icon: typeof HelpCircleIcon; tone: string; unblock: string }[] = [
  { key: "you", title: "Waiting on you", icon: HelpCircleIcon, tone: "text-decide", unblock: "Your answer frees them" },
  { key: "stalled", title: "Stalled", icon: Alert02Icon, tone: "text-alert", unblock: "Away with work in hand: hand it on" },
  { key: "lease", title: "In line for a lease", icon: SquareLock01Icon, tone: "text-decide", unblock: "Frees itself when the holder lets go" },
  { key: "working", title: "Working", icon: Loading03Icon, tone: "text-doing", unblock: "Nothing to do: they are on it" },
  { key: "free", title: "Can take work", icon: CheckmarkCircle02Icon, tone: "text-live", unblock: "Give them what is up next" },
]

function groupOf(f: Frees): GroupKey | null {
  if (f.kind === "you") return "you"
  if (f.kind === "away") return f.task ? "stalled" : null
  if (f.kind === "lease") return "lease"
  if (f.kind === "working" || f.kind === "reviewing") return "working"
  return "free"
}

function Who({ a, now, nameOf, children }: { a: AgentNow; now: number; nameOf: (n: string) => string; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Face a={a} size={32} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-ui font-semibold">{nameOf(a.name)}</span>
          <span className="shrink-0 truncate text-stamp text-ink-3">{a.model}</span>
        </span>
        {children ?? <NowLine a={a} now={now} />}
      </span>
    </span>
  )
}

function LeaseLine({ lease, now, nameOf }: { lease: Lease; now: number; nameOf: (n: string) => string }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2 text-ui">
        <span className="shrink-0 rounded-row px-1.5 font-mono text-meta text-ink-2 edge">{lease.name}</span>
        <span className="truncate text-ink-2">
          <span className="font-semibold text-ink">{lease.holder ? nameOf(lease.holder) : "nobody"}</span> has it · {Math.max(1, Math.round((lease.until - now) / 60_000))}m left
          {lease.note ? <span className="text-ink-3"> · {lease.note}</span> : null}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-meta text-ink-3">
        {lease.queue.map((q, i) => (
          <span key={q.name} className="truncate tabular-nums">
            {i + 1}. {nameOf(q.name)}
            {q.note ? ` · ${q.note}` : ""}
          </span>
        ))}
      </span>
    </span>
  )
}

function SeatLine({ seat, group, state, now, nameOf, agents }: { seat: Seat; group: GroupKey; state: ChannelState; now: number; nameOf: (n: string) => string; agents: Map<string, AgentNow> }) {
  const { a, f } = seat
  if (f.kind === "you") {
    const choices = f.ask.choices ?? []
    return (
      <li className="grid gap-x-4 gap-y-2 py-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto] md:items-center">
        <Who a={a} now={now} nameOf={nameOf}>
          {f.task && <TaskName task={f.task} className="text-meta text-ink-3" />}
        </Who>
        <span className="min-w-0">
          <span className="line-clamp-2 block text-body text-ink">{excerpt(f.ask.body, 160)}</span>
          <span className="block text-meta text-ink-3 tabular-nums">{freesWord(f, now, nameOf).when}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {choices.map((c) => (
            <Button key={c} variant="secondary" size="sm">
              {c}
            </Button>
          ))}
        </span>
      </li>
    )
  }
  if (f.kind === "away" && f.task) {
    const able = suggestFor(state, f.task.id).ranked.filter((c) => c.name !== a.name && agents.get(c.name)?.here && c.score > 0)
    const next = able.find((c) => takesWork(freesOf(state, agents.get(c.name)!, now))) ?? able[0]
    const last = [...state.tasks.get(f.task.id)!.notes].at(-1)
    return (
      <li className="grid gap-x-4 gap-y-2 py-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto] md:items-center">
        <Who a={a} now={now} nameOf={nameOf}>
          <span className="block truncate text-meta text-alert tabular-nums">Away {formatAgoShort(f.since, now)} · not reachable</span>
        </Who>
        <span className="min-w-0">
          <TaskName task={f.task} className="text-body text-ink" />
          <span className="block truncate text-meta text-ink-3">{last ? `last: ${excerpt(last.text, 90)}` : "no checkpoint written"}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {next && (
            <Button variant="secondary" size="sm">
              Give to {nameOf(next.name)}
            </Button>
          )}
          <Button variant="ghost" size="sm">
            Back to Up next
          </Button>
        </span>
      </li>
    )
  }
  if (f.kind === "lease")
    return (
      <li className="grid gap-x-4 gap-y-2 py-3 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:items-center">
        <Who a={a} now={now} nameOf={nameOf}>
          {f.task && <TaskName task={f.task} className="text-meta text-ink-3" />}
        </Who>
        <LeaseLine lease={f.lease} now={now} nameOf={nameOf} />
      </li>
    )
  const work = f.kind === "working" || f.kind === "reviewing" || f.kind === "review" ? f.task : undefined
  const checks = f.kind === "working" || f.kind === "review" ? checksLine(f.checks) : null
  const w = freesWord(f, now, nameOf)
  return (
    <li className={cx("grid gap-x-4 gap-y-1 py-2.5 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,280px)] md:items-center", group === "working" && "py-2")}>
      <Who a={a} now={now} nameOf={nameOf} />
      <span className="min-w-0">{work ? <TaskName task={work} className="text-ui text-ink" /> : <span className="text-ui text-ink-3">Nothing in hand</span>}</span>
      <span className="truncate text-meta text-ink-3 tabular-nums">
        {checks ? <span className={cx(checks.startsWith("CI") && "text-doing")}>{checks} · </span> : null}
        {w.when}
      </span>
    </li>
  )
}

export function Bottlenecks({ state, agents, now, nameOf }: { state: ChannelState; agents: AgentNow[]; now: number; nameOf: (n: string) => string }) {
  const seats = useMemo(() => agents.filter((a) => !a.lead).map((a) => ({ a, f: freesOf(state, a, now) })), [agents, state, now])
  const byName = useMemo(() => new Map(agents.map((a) => [a.name, a])), [agents])
  const queue = useMemo(() => unassigned(state), [state])
  const placed = queue.map((t) => ({ t, pick: suggestFor(state, t.id).pick }))
  const groups = GROUPS.map((g) => ({ ...g, seats: seats.filter((s) => groupOf(s.f) === g.key) })).filter((g) => g.seats.length)
  const waiting = seats.filter((s) => ["you", "stalled", "lease"].includes(groupOf(s.f) ?? "")).length
  return (
    <div className="pb-8">
      <div className="px-3 pt-4 pb-2">
        <h2 className="text-title">What frees the crowd</h2>
        <p className="mt-0.5 text-meta text-ink-3 tabular-nums">
          {seats.length} agents · {waiting} held up · {groups.find((g) => g.key === "free")?.seats.length ?? 0} can take work · {queue.length} tasks up next
        </p>
      </div>
      <div className="divide-y divide-line">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.title} className="grid gap-x-6 px-3 py-3 md:grid-cols-[208px_minmax(0,1fr)]">
            <header className="flex items-start gap-3 pt-2.5">
              <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-row edge", g.tone)}>
                <Icon icon={g.icon} size={18} />
              </span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-1.5 text-ui font-semibold">
                  {g.title} <span className="font-normal text-ink-3 tabular-nums">{g.seats.length}</span>
                </span>
                <span className="block text-meta text-ink-3">{g.unblock}</span>
              </span>
            </header>
            <div className="min-w-0">
              <ul className="divide-y divide-line">
                {g.seats.map((s) => (
                  <SeatLine key={s.a.name} seat={s} group={g.key} state={state} now={now} nameOf={nameOf} agents={byName} />
                ))}
              </ul>
              {g.key === "free" && queue.length > 0 && (
                <div className="mt-1 mb-1 rounded-card px-3 py-2.5 edge">
                  <p className="flex items-baseline gap-2 text-ui font-semibold">
                    Up next <span className="font-normal text-ink-3 tabular-nums">{queue.length}</span>
                    <span className="ml-auto text-meta font-normal text-ink-3">by context</span>
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {placed.map(({ t, pick }) => (
                      <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-meta">
                        <TaskName task={t} className="text-ui text-ink" />
                        <span className={cx("truncate", pick ? "text-ink-2" : "text-decide")}>{pick ? `→ ${nameOf(pick.name)}` : "no one has its context"}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Button size="sm">Hand these out</Button>
                    <span className="text-meta text-ink-3">{placed.filter((p) => p.pick).length} go now; the rest wait for you</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
