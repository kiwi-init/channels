import { Alert02Icon, GitMergeIcon, LockIcon } from "@hugeicons/core-free-icons"
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import { colorOf, isPerson, taskId, type ChannelState } from "@kiwi/core/state.ts"
import { formatAgo, formatAgoShort, formatTime } from "@/lib/format"
import { byTask, pack, timeline, type Flag, type Handoff, type Rail, type Span, type TaskTrack, type Timeline } from "@/lib/timeline"
import { cx } from "@/lib/utils"
import { AgentLanes } from "./agent-lanes"
import { agentNow, byBusy, type AgentNow } from "./agent-strip"
import { Icon } from "./icon"
import { Monogram, Tabs } from "./kit"

const ROW = 56
const SUB = 36
const AXIS = 28
const WINDOWS = [
  { value: "30m", label: "30m", ms: 30 * 60_000, step: 5 * 60_000 },
  { value: "1h", label: "1h", ms: 60 * 60_000, step: 10 * 60_000 },
  { value: "3h", label: "3h", ms: 3 * 60 * 60_000, step: 30 * 60_000 },
  { value: "8h", label: "Today", ms: 8 * 60 * 60_000, step: 60 * 60_000 },
] as const
type WindowName = (typeof WINDOWS)[number]["value"]
export type TimelineMode = "lanes" | "tasks"

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

const SPAN_STYLE: Record<Span["kind"], [string, string]> = {
  doing: ["bg-doing/7 text-ink-2", "bg-doing/15 text-ink"],
  waiting: ["border border-dashed border-line text-ink-3", "border border-dashed border-edge-strong text-ink-2"],
  reviewing: ["border border-line text-ink-2", "border border-doing/50 bg-canvas text-ink"],
  decide: ["bg-decide-wash/50 text-ink-2", "bg-decide-wash text-ink"],
  done: ["bg-wash text-ink-3", "bg-wash text-ink-3"],
}

const SPAN_EDGE: Partial<Record<Span["kind"], string>> = {
  doing: "border-r-2 border-r-doing",
  decide: "border-r-2 border-r-decide",
  reviewing: "border-r-2 border-r-doing",
}

const KIND_WORD: Record<Span["kind"], string> = {
  doing: "doing",
  waiting: "in review",
  reviewing: "reviewing",
  decide: "waiting on you",
  done: "done",
}

const HANDOFF_STROKE: Record<Handoff["kind"], string> = {
  assign: "var(--ink-3)",
  follow: "var(--ink-3)",
  review: "var(--doing)",
  back: "var(--alert)",
  approved: "var(--live)",
  ask: "var(--decide)",
  question: "var(--ink-3)",
}

function NeedsChip({ f, onOpen }: { f: Flag; onOpen?: () => void }) {
  const red = f.kind === "red"
  return (
    <button
      type="button"
      onClick={onOpen}
      title={f.text}
      className={cx(
        "pointer-events-auto flex h-5 shrink-0 items-center gap-1 rounded-row border bg-canvas px-1.5 text-stamp font-semibold whitespace-nowrap",
        red ? "border-alert/40 text-alert" : "border-decide/40 text-decide"
      )}
    >
      <Icon icon={Alert02Icon} size={11} />
      {red ? "CI red" : f.kind === "permission" ? "Allow?" : "Needs you"}
    </button>
  )
}

interface Layout {
  top: number
  height: number
  first: number
  rowOf: Map<string, number>
}

function layout(spans: Span[], top: number): Layout {
  const { rowOf, rows } = pack(spans, 60_000)
  const height = Math.max(ROW, rows * SUB + 20)
  return { top, height, first: (height - (rows * SUB - 6)) / 2, rowOf }
}

function Block({
  s,
  x,
  top,
  room,
  flags,
  face,
  nameOf,
  onOpen,
}: {
  s: Span
  x: (t: number) => number
  top: number
  room: number
  flags: Flag[]
  face?: ReactNode
  nameOf: (n: string) => string
  onOpen: (id: number) => void
}) {
  const left = x(s.from)
  const width = Math.max(6, x(s.to) - left)
  const outside = s.open && width < 150 && room > 90
  const red = flags.find((f) => f.kind === "red")
  const needs = flags.filter((f) => f.kind !== "red" && f.kind !== "running" && f.kind !== "merged")
  const running = flags.find((f) => f.kind === "running")
  const roomy = width > 120
  const label = s.kind === "decide" && !s.task ? s.title : `${s.kind === "reviewing" ? "Review " : ""}${s.title}`
  return (
    <>
      {outside && (
        <button
          type="button"
          disabled={!s.task}
          onClick={() => s.task && onOpen(s.task)}
          className="absolute flex h-[30px] min-w-0 items-center justify-end gap-1.5 text-meta whitespace-nowrap"
          style={{ left: left - 8 - Math.min(room - 8, 340), width: Math.min(room - 8, 340), top }}
        >
          {s.by && <span className="shrink-0 font-semibold text-ink">{nameOf(s.by)}</span>}
          <span className="min-w-0 truncate text-ink-2">
            {s.kind === "decide" && s.round ? `wants your review on ${taskId(s.task)}: ` : s.task && !s.by ? `${taskId(s.task)} ` : ""}
            {s.title}
          </span>
        </button>
      )}
      <div
        className={cx("absolute flex h-[30px] items-center gap-1.5 overflow-hidden rounded-row pr-1 pl-2", SPAN_STYLE[s.kind][s.open ? 1 : 0], s.open && SPAN_EDGE[s.kind])}
        style={{ left, width, top }}
        title={`${s.task ? `${taskId(s.task)} ` : ""}${s.title} · ${KIND_WORD[s.kind]}${s.round ? ` · round ${s.round}` : ""} · ${formatTime(s.from)}–${s.open ? "now" : formatTime(s.to)}`}
      >
        {face}
        <button type="button" disabled={!s.task} onClick={() => s.task && onOpen(s.task)} className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left">
          {outside ? (
            <span className="text-stamp text-ink-3 tabular-nums">{formatAgoShort(s.from, s.to)}</span>
          ) : (
            <>
              {s.task > 0 && roomy && <span className="shrink-0 text-meta text-ink-3 tabular-nums">{taskId(s.task)}</span>}
              <span className={cx("truncate text-meta", s.kind === "done" || !s.open ? "" : "font-medium")}>{label}</span>
              {s.round && s.kind !== "doing" && roomy && <span className="shrink-0 text-stamp text-ink-3">r{s.round}</span>}
            </>
          )}
        </button>
        {running && roomy && (
          <span title={`Checks: ${running.text}`} className="flex shrink-0 items-center gap-0.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1 w-2 rounded-full bg-doing" />
            ))}
          </span>
        )}
        {s.pr && roomy && s.kind !== "reviewing" && <span className="shrink-0 text-stamp text-ink-3 tabular-nums">#{s.pr.number}</span>}
        {red && s.open && <NeedsChip f={red} onOpen={() => onOpen(s.task)} />}
        {needs.map((f) => (
          <NeedsChip key={f.key} f={f} onOpen={() => s.task && onOpen(s.task)} />
        ))}
        {red && s.open && <span className="pointer-events-none absolute right-0 bottom-0 h-0.5 bg-alert" style={{ width: Math.max(4, x(s.to) - Math.max(x(red.at), left)) }} />}
      </div>
    </>
  )
}

function Marker({ f, x, top }: { f: Flag; x: (t: number) => number; top: number }) {
  if (f.kind === "merged")
    return (
      <span title={f.text} className="absolute flex size-3.5 -translate-x-1/2 items-center justify-center rounded-full bg-live text-canvas" style={{ left: x(f.at), top: top + 8 }}>
        <Icon icon={GitMergeIcon} size={9} />
      </span>
    )
  return (
    <span className="absolute -translate-x-1/2" style={{ left: x(f.at), top: top + 5 }}>
      <NeedsChip f={f} />
    </span>
  )
}

function RailLine({ r, x }: { r: Rail; x: (t: number) => number }) {
  const left = x(r.from)
  const width = Math.max(4, x(r.to) - left)
  return (
    <div className="absolute bottom-[5px] flex items-center gap-1" style={{ left, width }} title={`${r.holding ? "Holding" : "Waiting for"} ${r.name} · ${formatTime(r.from)}–${formatTime(r.to)}`}>
      <span className={cx("h-0 flex-1", r.holding ? "border-t-2 border-ink-3/60" : "border-t border-dashed border-ink-3/60")} />
      {width > (r.holding ? 60 : 110) && (
        <span className="absolute -top-[6px] left-0 flex items-center gap-0.5 bg-canvas pr-1 font-mono text-stamp leading-none whitespace-nowrap text-ink-3">
          {r.holding && <Icon icon={LockIcon} size={9} />}
          {r.holding ? r.name : `queued for ${r.name}`}
        </span>
      )}
    </div>
  )
}

function Links({
  handoffs,
  y,
  x,
  width,
  height,
}: {
  handoffs: Handoff[]
  y: (lane: string, task: number | undefined, at: number, edge: 1 | -1) => number | undefined
  x: (t: number) => number
  width: number
  height: number
}) {
  if (!width) return null
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height}>
      {handoffs.map((h) => {
        const down = (y(h.to.lane, h.task, h.to.at, 1) ?? 0) > (y(h.from.lane, h.task, h.from.at, 1) ?? 0)
        const y1 = y(h.from.lane, h.task, h.from.at, down ? 1 : -1)
        const y2 = y(h.to.lane, h.task, h.to.at, down ? -1 : 1)
        if (y1 === undefined || y2 === undefined || h.from.lane === h.to.lane) return null
        const x1 = Math.max(0, x(h.from.at))
        const x2 = Math.max(0, x(h.to.at)) + 10
        const mid = (y1 + y2) / 2
        const stroke = HANDOFF_STROKE[h.kind]
        return (
          <g key={h.key}>
            <path d={`M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray="3 3" opacity={0.9} />
            <circle cx={x1} cy={y1} r={2.5} fill="var(--canvas)" stroke={stroke} strokeWidth={1.25} />
            <circle cx={x2} cy={y2} r={2.5} fill={stroke} />
          </g>
        )
      })}
    </svg>
  )
}

function Axis({ t, x, step, width }: { t: Timeline; x: (at: number) => number; step: number; width: number }) {
  const ticks: number[] = []
  for (let at = t.to - step; at > t.from + step / 3; at -= step) ticks.push(at)
  const near = (at: number) => t.looked !== undefined && Math.abs(x(at) - x(t.looked) - 40) < 64
  const word = (at: number) => {
    const m = Math.round((t.to - at) / 60_000)
    return m >= 60 ? `−${Math.round(m / 60)}h` : `−${m}m`
  }
  return (
    <div className="pointer-events-none absolute inset-0">
      {ticks.map((at) => (
        <div key={at} className="absolute top-0 bottom-0 border-l border-dashed border-line" style={{ left: x(at) }}>
          {width > 0 && !near(at) && <span className="absolute top-1.5 -translate-x-1/2 text-stamp text-ink-3 tabular-nums">{word(at)}</span>}
        </div>
      ))}
      {t.looked !== undefined && (
        <div className="absolute top-0 bottom-0 border-l border-ink-3/50" style={{ left: x(t.looked) }}>
          <span className="absolute top-1 left-1 rounded-row bg-wash-2 px-1.5 text-stamp whitespace-nowrap text-ink-2">you were here · {formatTime(t.looked)}</span>
        </div>
      )}
      <div className="absolute top-0 right-0 bottom-0 border-r border-accent/60">
        <span className="absolute top-1 right-0 translate-x-1/2 rounded-row bg-accent-wash px-1.5 text-stamp font-semibold text-accent-text">now</span>
      </div>
    </div>
  )
}

interface Lane {
  name: string
  label: string
  face: ReactNode
  line: ReactNode
}

function LaneLabel({ lane, compact, height }: { lane: Lane; compact: boolean; height: number }) {
  return (
    <div className="flex items-center gap-2.5 pr-3" style={{ height }}>
      {lane.face}
      {!compact && (
        <span className="min-w-0">
          <span className="block truncate text-ui font-semibold">{lane.label}</span>
          <span className="flex items-center gap-1.5 truncate text-meta text-ink-3">{lane.line}</span>
        </span>
      )}
    </div>
  )
}

export function AgentTimeline({
  agents,
  state,
  messages,
  now,
  me,
  nameOf,
  onOpenTask,
  mode,
  windowName: initialWindow = "1h",
  aside,
}: {
  agents: AgentNow[]
  state: ChannelState
  messages: Message[]
  now: number
  me: string
  nameOf: (name: string) => string
  onOpenTask: (id: number) => void
  mode: TimelineMode
  windowName?: WindowName
  aside?: ReactNode
}) {
  const [windowName, setWindow] = useState<WindowName>(initialWindow)
  const win = WINDOWS.find((w) => w.value === windowName)!
  const t = useMemo(() => timeline(state, messages, me, now, win.ms), [state, messages, me, now, win.ms])
  const [plotRef, width] = useWidth<HTMLDivElement>()
  const compact = width > 0 && width < 520
  const x = (at: number) => ((Math.max(at, t.from) - t.from) / (t.to - t.from)) * width

  const meMember = state.members.get(me)
  const myLane: Lane = {
    name: me,
    label: "You",
    face: <Monogram name={nameOf(me)} hue={me} color={colorOf(state, me)} size={28} />,
    line: (() => {
      const n = t.spans.filter((s) => s.lane === me && s.open).length
      return n ? <span className="font-medium text-decide">{n} waiting on you</span> : "nothing waiting on you"
    })(),
  }
  const agentLanes: Lane[] = byBusy(agents)
    .sort((a, b) => Number(a.lead) - Number(b.lead))
    .map((a) => {
      const now = agentNow(a)
      const asking = t.flags.some((f) => f.lane === a.name && f.open && (f.kind === "ask" || f.kind === "permission"))
      return {
        name: a.name,
        label: a.label,
        face: <Monogram name={a.label} hue={a.name} agent color={a.color} size={28} online={!!a.here} />,
        line: asking ? (
          <span className="font-medium text-decide">Needs you</span>
        ) : (
          <>
            <span className={cx("size-1.5 shrink-0 rounded-full", now.busy ? "bg-doing" : a.here ? "bg-live" : "bg-ink-3")} />
            <span className={cx("truncate", now.busy && "text-ink-2")}>{now.text}</span>
            {a.lead && <span>· lead</span>}
          </>
        ),
      }
    })
  const others: Lane[] = [...new Set(t.spans.map((s) => s.lane))]
    .filter((n) => n !== me && !agents.some((a) => a.name === n) && isPerson(state.members.get(n) ?? {}))
    .map((n) => ({ name: n, label: nameOf(n), face: <Monogram name={nameOf(n)} hue={n} color={colorOf(state, n)} size={28} />, line: "reviewing" }))
  const lanes = [...(meMember ? [myLane] : []), ...agentLanes, ...others]
  const tracks = useMemo(() => (mode === "tasks" ? byTask(t) : []), [mode, t])
  const layouts = new Map<string, Layout>()
  let height = AXIS
  for (const [key, spans] of mode === "tasks" ? tracks.map((tr) => [String(tr.task), tr.spans] as const) : lanes.map((l) => [l.name, t.spans.filter((s) => s.lane === l.name)] as const)) {
    const l = layout(spans, height)
    layouts.set(key, l)
    height += l.height
  }
  const roomOf = (key: string, s: Span, all: Span[]) => {
    const l = layouts.get(key)!
    const row = l.rowOf.get(s.key)
    const before = all.filter((o) => o !== s && l.rowOf.get(o.key) === row && o.to <= s.from + 1000).map((o) => x(o.to))
    return x(s.from) - Math.max(0, ...before) - 10
  }
  const spanTop = (key: string, s: Span) => {
    const l = layouts.get(key)!
    return l.first + (l.rowOf.get(s.key) ?? 0) * SUB
  }
  const yOf = (lane: string, task: number | undefined, at: number, edge: 1 | -1) => {
    const l = layouts.get(lane)
    if (!l) return undefined
    const s =
      t.spans.find((s) => s.lane === lane && s.task === task && s.from <= at + 60_000 && s.to >= at - 60_000 && s.kind !== "waiting") ??
      t.spans.find((s) => s.lane === lane && s.task === task && s.from <= at + 60_000 && s.to >= at - 60_000)
    return l.top + l.first + (s ? (l.rowOf.get(s.key) ?? 0) : 0) * SUB + 15 + edge * 15
  }

  const working = agents.filter((a) => agentNow(a).busy).length
  const waiting = t.spans.filter((s) => s.open && s.kind === "decide" && s.lane === me).length
  const red = t.flags.filter((f) => f.kind === "red").length
  const inReview = t.spans.filter((s) => s.open && s.kind === "waiting").length

  const faceOf = (lane: string, size: number) => {
    const a = agents.find((x) => x.name === lane)
    return a ? <Monogram name={a.label} hue={a.name} agent color={a.color} size={size} /> : <Monogram name={nameOf(lane)} hue={lane} color={colorOf(state, lane)} size={size} />
  }

  return (
    <section aria-label="Agent timeline" className="flex flex-col gap-3 pb-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-doing" />
            <span className="tabular-nums">{working}</span> working
          </span>
          {waiting > 0 && (
            <span className="flex items-center gap-1.5 font-medium text-decide">
              <span className="size-1.5 rounded-full bg-decide" />
              <span className="tabular-nums">{waiting}</span> need you
            </span>
          )}
          {inReview > 0 && (
            <span>
              <span className="tabular-nums">{inReview}</span> in review
            </span>
          )}
          {red > 0 && (
            <span className="font-medium text-alert">
              <span className="tabular-nums">{red}</span> CI red
            </span>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {aside}
          <Tabs label="Time window" value={windowName} options={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} onChange={setWindow} />
        </div>
      </header>

      <div className="flex">
        <div className={cx("shrink-0", compact ? "w-10" : "w-52")}>
          <div style={{ height: AXIS }} />
          {mode === "tasks"
            ? tracks.map((tr) => (
                <TrackLabel
                  key={tr.task}
                  tr={tr}
                  now={now}
                  compact={compact}
                  height={layouts.get(String(tr.task))!.height}
                  face={tr.holder ? faceOf(tr.holder, 20) : null}
                  nameOf={nameOf}
                  onOpen={onOpenTask}
                />
              ))
            : lanes.map((l) => <LaneLabel key={l.name} lane={l} compact={compact} height={layouts.get(l.name)!.height} />)}
        </div>
        <div ref={plotRef} className="relative min-w-0 flex-1" style={{ height }}>
          <Axis t={t} x={x} step={win.step} width={width} />
          {width > 0 &&
            (mode === "tasks"
              ? tracks.map((tr) => {
                  const l = layouts.get(String(tr.task))!
                  return (
                    <div key={tr.task} className="absolute inset-x-0 border-t border-line" style={{ top: l.top, height: l.height }}>
                      {tr.spans.map((s) => (
                        <Block
                          key={s.key}
                          s={s}
                          x={x}
                          top={spanTop(String(tr.task), s)}
                          room={roomOf(String(tr.task), s, tr.spans)}
                          flags={tr.flags.filter((f) => f.lane === s.lane && s.open && f.open)}
                          face={faceOf(s.lane, 16)}
                          nameOf={nameOf}
                          onOpen={onOpenTask}
                        />
                      ))}
                    </div>
                  )
                })
              : lanes.map((l) => {
                  const box = layouts.get(l.name)!
                  const spans = t.spans.filter((s) => s.lane === l.name)
                  const flags = t.flags.filter((f) => f.lane === l.name)
                  const onBlock = (s: Span) => flags.filter((f) => f.task === s.task && s.open && f.open)
                  const loose = flags.filter((f) => !spans.some((s) => s.open && f.task === s.task) && (f.kind === "merged" || f.open))
                  return (
                    <div key={l.name} className={cx("absolute inset-x-0 border-t border-line", l.name === me && "bg-decide-wash/40")} style={{ top: box.top, height: box.height }}>
                      {t.rails
                        .filter((r) => r.lane === l.name)
                        .map((r) => (
                          <RailLine key={r.key} r={r} x={x} />
                        ))}
                      {spans.map((s) => (
                        <Block key={s.key} s={s} x={x} top={spanTop(l.name, s)} room={roomOf(l.name, s, spans)} flags={onBlock(s)} nameOf={nameOf} onOpen={onOpenTask} />
                      ))}
                      {loose.map((f) => (
                        <Marker key={f.key} f={f} x={x} top={box.first} />
                      ))}
                    </div>
                  )
                }))}
          {mode === "lanes" && <Links handoffs={t.handoffs} y={yOf} x={x} width={width} height={height} />}
        </div>
      </div>
    </section>
  )
}

function TrackLabel({
  tr,
  now,
  compact,
  height,
  face,
  nameOf,
  onOpen,
}: {
  tr: TaskTrack
  now: number
  compact: boolean
  height: number
  face: ReactNode
  nameOf: (n: string) => string
  onOpen: (id: number) => void
}) {
  const open = tr.spans.find((s) => s.open && s.lane === tr.holder)
  return (
    <button type="button" onClick={() => onOpen(tr.task)} className="flex w-full items-center gap-2.5 pr-3 text-left" style={{ height }}>
      {compact ? (
        <span className="text-meta text-ink-3 tabular-nums">{taskId(tr.task)}</span>
      ) : (
        <span className="min-w-0">
          <span className="block truncate text-ui font-semibold">{tr.title}</span>
          <span className="flex items-center gap-1.5 truncate text-meta text-ink-3">
            <span className="tabular-nums">{taskId(tr.task)}</span>
            {tr.holder && (
              <>
                <span>·</span>
                {face}
                <span className={cx("truncate", open?.kind === "decide" && "font-medium text-decide")}>
                  {open?.kind === "decide" ? "with you" : `with ${nameOf(tr.holder)}`} · {formatAgo(tr.since, now).replace(" ago", "")}
                </span>
              </>
            )}
          </span>
        </span>
      )}
    </button>
  )
}

type AgentsMode = "lanes" | "tasks" | "columns"
const MODE_KEY = "kiwi:agents-view"
const MODES: { value: AgentsMode; label: string }[] = [
  { value: "lanes", label: "Timeline" },
  { value: "tasks", label: "By task" },
  { value: "columns", label: "Columns" },
]

function storedMode(): AgentsMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return v === "tasks" || v === "columns" ? v : "lanes"
  } catch {
    // Storage can be off (a private window): the timeline is the default.
    return "lanes"
  }
}

export function AgentsView(props: { agents: AgentNow[]; state: ChannelState; messages: Message[]; now: number; me: string; nameOf: (name: string) => string; onOpenTask: (id: number) => void }) {
  const [mode, setMode] = useState<AgentsMode>(storedMode)
  const pick = (m: AgentsMode) => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // Storage can be off: the choice lasts until the page reloads.
    }
  }
  const tabs = <Tabs label="Agents view" value={mode} options={MODES} onChange={pick} stretch />
  if (mode === "columns")
    return (
      <div className="flex flex-col gap-3">
        <div className="flex justify-end pt-1">{tabs}</div>
        <AgentLanes {...props} />
      </div>
    )
  return (
    <div className="pt-1">
      <AgentTimeline {...props} mode={mode} aside={tabs} />
    </div>
  )
}
