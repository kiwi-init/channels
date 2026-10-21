import { CancelCircleIcon, HelpCircleIcon, PauseIcon } from "@hugeicons/core-free-icons"
import type { ReactNode } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import { colorOf, taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { pickFor, taskCandidates } from "@kiwi/core/routing.ts"
import { taskPr } from "@kiwi/core/work.ts"
import { excerpt, formatTime, memberName } from "@/lib/format"
import { baton, rollWords, span, troubled, type Branch, type Chain, type Change, type Health, type Roll, type Root, type Stall } from "@/lib/tree"
import { cx } from "@/lib/utils"
import { Ticks } from "./agent-lanes"
import { Icon } from "./icon"
import { Button, Monogram } from "./kit"
import { isAgent } from "./message"
import { Row } from "./needs-you"
import { PrCell } from "./pr-cell"
import { ChecksCell } from "./tasks-view"

const TONE: Record<Health, string> = {
  red: "text-alert",
  waits: "text-decide",
  doing: "text-doing",
  review: "text-accent-text",
  todo: "text-ink-3",
  done: "text-live",
}

const FILL: Record<Health, string> = {
  red: "bg-alert",
  waits: "bg-decide",
  doing: "bg-doing",
  review: "bg-accent",
  todo: "bg-ink-3/40",
  done: "bg-live",
}

const WORD: Record<Health, string> = {
  red: "CI red",
  waits: "Needs you",
  doing: "In progress",
  review: "In review",
  todo: "Up next",
  done: "Done",
}

const HOT: Partial<Record<Health, string>> = { red: "var(--alert)", waits: "var(--decide)" }

const EDGE = "var(--edge-strong)"

const ORDER: Health[] = ["done", "review", "doing", "todo", "waits", "red"]

function Chip({ health }: { health: Health }) {
  return (
    <span
      className={cx("shrink-0 rounded-full px-1.5 text-meta font-semibold whitespace-nowrap", TONE[health], health === "todo" ? "bg-wash-2" : "bg-[color-mix(in_srgb,currentColor_12%,transparent)]")}
    >
      {WORD[health]}
    </span>
  )
}

function Bar({ roll, className }: { roll: Roll; className?: string }) {
  return (
    <span aria-hidden className={cx("flex h-1.5 overflow-hidden rounded-full bg-wash-2", className)}>
      {ORDER.map((h) => (roll[h] ? <span key={h} className={FILL[h]} style={{ width: `${(roll[h] / roll.tasks) * 100}%` }} /> : null))}
    </span>
  )
}

function RollLine({ roll, time = true }: { roll: Roll; time?: boolean }) {
  const words = rollWords(roll)
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta text-ink-3 tabular-nums">
      {words.map((w, i) => (
        <span key={w} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          <span className={cx(/ red$/.test(w) && "font-semibold text-alert", /on you$/.test(w) && "font-semibold text-decide")}>{w}</span>
        </span>
      ))}
      {time && (
        <>
          <span aria-hidden>·</span>
          <span>{span(roll.ms)} agent time</span>
        </>
      )}
    </span>
  )
}

function Face({ state, name, size }: { state: ChannelState; name: string; size: number }) {
  const m = state.members.get(name)
  return <Monogram name={memberName(m, name)} hue={name} agent={isAgent(m)} color={colorOf(state, name)} size={size} />
}

function rounds(t: Task, state: ChannelState): string | null {
  const last = t.rounds.at(-1)
  if (!last) return null
  const by =
    last.result.kind === "approved" || last.result.kind === "rejected"
      ? memberName(state.members.get(last.result.by), last.result.by)
      : t.review
        ? memberName(state.members.get(t.review), t.review)
        : null
  const word = last.result.kind === "approved" ? "approved" : last.result.kind === "rejected" ? "sent back" : "waiting on"
  return `round ${last.n} ${word}${by ? ` ${last.result.kind === "open" ? "" : "by "}${by}` : ""}`
}

function askOf(state: ChannelState, id: number): string {
  const ask = state.openAsks.find((m) => {
    const place = state.placeOf.get(m.seq)
    return m.esc && place?.kind === "task" && place.task === id
  })
  return ask ? excerpt(ask.body, 80) : "a decision in its thread"
}

function requestText(root: Root, state: ChannelState): string {
  if (root.kind === "issue") return `GitHub issue ${root.text}`
  if (root.kind === "made") return `Made by ${memberName(state.members.get(root.from), root.from)}`
  return root.text
}

function RootCard({ root, state, className }: { root: Root; state: ChannelState; className?: string }) {
  return (
    <div className={cx("flex w-[400px] max-w-full flex-col gap-2 rounded-card px-4 py-3 shadow-[inset_0_0_0_1px_var(--edge-strong)]", className)}>
      <span className="flex items-center gap-2.5">
        <Face state={state} name={root.from} size={24} />
        <span className="text-ui font-semibold">{memberName(state.members.get(root.from), root.from)}</span>
        <span className="text-meta text-ink-3 tabular-nums">
          {root.seq ? `#${root.seq} · ` : ""}
          {formatTime(root.at)}
        </span>
      </span>
      <p className="line-clamp-2 text-body text-ink">{requestText(root, state)}</p>
      <Bar roll={root.roll} />
      <RollLine roll={root.roll} />
    </div>
  )
}

function NodeCard({ b, state, small }: { b: Branch; state: ChannelState; small?: boolean }) {
  const t = b.task
  const owner = t.owner ? state.members.get(t.owner) : undefined
  const pr = taskPr(state, t.id)
  const r = rounds(t, state)
  const hot = HOT[b.health]
  const below = b.children.length ? b.roll.tasks - 1 : 0
  return (
    <div className={cx("flex flex-col gap-1.5 rounded-card bg-canvas px-3 py-2.5", small ? "w-[232px]" : "w-[252px]")} style={{ boxShadow: `inset 0 0 0 1px ${hot ?? EDGE}` }}>
      <span className="flex min-w-0 items-center gap-2">
        {t.owner ? <Face state={state} name={t.owner} size={20} /> : <span className="size-5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--edge-strong)]" />}
        <span className="min-w-0 flex-1 truncate text-ui font-semibold">{t.owner ? memberName(owner, t.owner) : "unassigned"}</span>
        <Chip health={b.health} />
      </span>
      <span className="truncate text-meta text-ink-3 tabular-nums">
        {taskId(t.id)}
        {t.owner && owner?.runs ? ` · ${owner.runs.model.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2")}` : ""}
      </span>
      <span className="line-clamp-2 text-ui text-ink">{t.title}</span>
      {b.why && b.health !== "waits" && <span className="text-meta font-medium text-alert">{b.why}</span>}
      <span className="flex min-w-0 items-center gap-2 text-meta text-ink-3 tabular-nums">
        {pr ? (
          <>
            <span className="shrink-0">PR #{pr.pr.number}</span>
            {pr.pr.state === "merged" ? <span>merged</span> : pr.checks ? <Ticks checks={pr.checks} /> : null}
          </>
        ) : (
          <span>{t.state === "todo" ? "not started" : "no PR yet"}</span>
        )}
        <span aria-hidden>·</span>
        <span className="shrink-0">{t.state === "todo" ? "queued" : span(b.ms)}</span>
        {below > 0 && <span className={cx("ml-auto shrink-0", troubled(b) && b.health !== "red" && b.health !== "waits" ? TONE[b.roll.worst] : "")}>{below} below</span>}
      </span>
      {r && <span className="truncate text-meta text-ink-3">{r}</span>}
      {b.health === "waits" && <span className="line-clamp-2 text-meta font-medium text-decide">Waits on you: {askOf(state, t.id)}</span>}
    </div>
  )
}

function Stack({ branches, state }: { branches: Branch[]; state: ChannelState }) {
  return (
    <ul className="flex flex-col">
      {branches.map((c, i) => {
        const later = branches.slice(i + 1).find(troubled)
        const top = troubled(c) ? HOT[c.roll.worst] : later ? HOT[later.roll.worst] : undefined
        return (
          <li key={c.task.id} className="relative pt-3 pl-6">
            <span aria-hidden className="absolute top-0 left-3 h-9 w-px" style={{ background: top ?? EDGE }} />
            {i < branches.length - 1 && <span aria-hidden className="absolute top-9 bottom-0 left-3 w-px" style={{ background: later ? HOT[later.roll.worst] : EDGE }} />}
            <span aria-hidden className="absolute top-9 left-3 h-px w-3" style={{ background: troubled(c) ? HOT[c.roll.worst] : EDGE }} />
            <NodeCard b={c} state={state} small />
            {c.children.length > 0 && <Stack branches={c.children} state={state} />}
          </li>
        )
      })}
    </ul>
  )
}

function SplitBy({ root, state }: { root: Root; state: ChannelState }) {
  if (!root.splitBy) return null
  return (
    <span className="flex items-center gap-2 rounded-full bg-canvas px-2.5 py-1 text-meta text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
      <Face state={state} name={root.splitBy} size={18} />
      <span>
        <span className="font-semibold text-ink">{memberName(state.members.get(root.splitBy), root.splitBy)}</span> split it in {root.branches.length}
      </span>
    </span>
  )
}

export function TreeCanvas({ roots, state }: { roots: Root[]; state: ChannelState }) {
  return (
    <div className="flex flex-col gap-12 overflow-x-auto px-3 pt-4 pb-10">
      {roots.map((root) => {
        const n = root.branches.length
        const hotCols = root.branches.flatMap((b, i) => (troubled(b) ? [{ i, color: HOT[b.roll.worst]! }] : []))
        const half = (i: number, side: "l" | "r") => {
          const a = side === "l" ? 2 * i : 2 * i + 1
          const hit = hotCols.find(({ i: c }) => {
            const lo = Math.min(2 * c + 1, n)
            const hi = Math.max(2 * c + 1, n)
            return a >= lo && a + 1 <= hi
          })
          return hit?.color
        }
        const rootHot = hotCols[0]?.color
        return (
          <section key={root.key} aria-label={requestText(root, state)} className="flex min-w-max flex-col items-center">
            <RootCard root={root} state={state} />
            <span aria-hidden className="h-4 w-px" style={{ background: rootHot ?? EDGE }} />
            <SplitBy root={root} state={state} />
            <span aria-hidden className="h-4 w-px" style={{ background: rootHot ?? EDGE }} />
            <div className="flex items-start">
              {root.branches.map((b, i) => (
                <div key={b.task.id} className="relative flex flex-col items-start px-2.5 pt-5">
                  {n > 1 && i > 0 && <span aria-hidden className="absolute top-0 left-0 h-px w-1/2" style={{ background: half(i, "l") ?? EDGE }} />}
                  {n > 1 && i < n - 1 && <span aria-hidden className="absolute top-0 right-0 h-px w-1/2" style={{ background: half(i, "r") ?? EDGE }} />}
                  <span aria-hidden className="absolute top-0 left-1/2 h-5 w-px" style={{ background: HOT[b.roll.worst] ?? EDGE }} />
                  <NodeCard b={b} state={state} />
                  {b.children.length > 0 && <Stack branches={b.children} state={state} />}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

type End = { top?: string; elbow?: string; bottom?: string }

function Guides({ path, hot, end }: { path: boolean[]; hot: (string | undefined)[]; end: End }) {
  return (
    <span aria-hidden className="flex self-stretch">
      {path.map((last, d) =>
        d < path.length - 1 ? (
          <span key={d} className="relative w-5 shrink-0">
            {!last && <span className="absolute inset-y-0 left-2.5 w-px" style={{ background: hot[d] ?? EDGE }} />}
          </span>
        ) : (
          <span key={d} className="relative w-5 shrink-0">
            <span className="absolute top-0 left-2.5 h-1/2 w-px" style={{ background: end.top ?? EDGE }} />
            {!last && <span className="absolute bottom-0 left-2.5 h-1/2 w-px" style={{ background: end.bottom ?? EDGE }} />}
            <span className="absolute top-1/2 left-2.5 h-px w-2.5" style={{ background: end.elbow ?? EDGE }} />
          </span>
        )
      )}
    </span>
  )
}

function Suggest({ state, id, name }: { state: ChannelState; id: number; name: (n: string) => string }) {
  const best = pickFor(taskCandidates(state, id))
  if (!best) return <span className="truncate">nobody has its context yet</span>
  return (
    <span className="truncate text-ink-2">
      best: <span className="font-semibold">{name(best.name)}</span>, {best.reasons[0]}
    </span>
  )
}

function OutlineRow({ b, state, now, name, path, hot, end }: { b: Branch; state: ChannelState; now: number; name: (n: string) => string; path: boolean[]; hot: (string | undefined)[]; end: End }) {
  const t = b.task
  const pr = taskPr(state, t.id)
  const below = b.children.length ? b.roll.tasks - 1 : 0
  const hand = baton(state, b, name)
  const open = !t.owner && t.state === "todo"
  const best = open ? pickFor(taskCandidates(state, t.id)) : null
  return (
    <div className="grid grid-cols-[auto_28px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-row pr-3 transition-colors hover:bg-wash md:grid-cols-[auto_28px_minmax(0,1fr)_168px_auto] lg:grid-cols-[auto_28px_minmax(0,1fr)_168px_128px_64px]">
      <Guides path={path} hot={hot} end={end} />
      <span className="py-2.5">{t.owner ? <Face state={state} name={t.owner} size={28} /> : <span className="block size-7 rounded-full border border-dashed border-edge-strong" />}</span>
      <span className="min-w-0 py-2.5">
        <span className={cx("block truncate text-body leading-snug", t.state === "done" ? "text-ink-2" : "text-ink")}>{t.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-meta text-ink-3">
          <span className="shrink-0 tabular-nums">{taskId(t.id)}</span>
          <span aria-hidden>·</span>
          {b.health === "red" && b.why && (
            <>
              <span className="shrink-0 font-semibold text-alert max-md:hidden">{b.why}</span>
              <span aria-hidden className="max-md:hidden">
                ·
              </span>
            </>
          )}
          {open ? (
            <Suggest state={state} id={t.id} name={name} />
          ) : (
            <span className={cx("flex min-w-0 shrink items-center gap-1.5 truncate", TONE[hand.tone], (hand.tone === "red" || hand.tone === "waits") && "font-semibold")}>
              {hand.tone === "doing" && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-doing" />}
              <span className="truncate">
                {hand.text}
                {hand.since !== undefined && hand.tone !== "done" ? ` · ${span(now - hand.since)}` : ""}
                {hand.tone === "done" && hand.since !== undefined ? ` ${span(now - hand.since)} ago` : ""}
              </span>
            </span>
          )}
          {below > 0 && troubled(b) && b.health !== "red" && b.health !== "waits" && (
            <>
              <span aria-hidden>·</span>
              <span className={cx("shrink-0", TONE[b.roll.worst])}>{b.roll.red ? `${b.roll.red} red below` : `${b.roll.waits} below waits on you`}</span>
            </>
          )}
        </span>
        {best && (
          <span className="mt-1.5 block md:hidden">
            <Button size="sm" variant="secondary">
              Give to {name(best.name)}
            </Button>
          </span>
        )}
      </span>
      <span className="hidden min-w-0 md:block">
        <PrCell pr={pr} done={t.state === "done"} />
      </span>
      <span className="hidden min-w-0 lg:block">
        <ChecksCell pr={pr} />
      </span>
      <span className="flex justify-end text-right text-meta text-ink-3 tabular-nums">
        {best ? (
          <Button size="sm" variant="secondary" className="max-md:hidden">
            Give to {name(best.name)}
          </Button>
        ) : t.state === "todo" ? (
          "queued"
        ) : (
          span(b.ms)
        )}
      </span>
    </div>
  )
}

const hotOf = (b: Branch | undefined) => (b ? HOT[b.roll.worst] : undefined)

function outlineRows(branches: Branch[], state: ChannelState, now: number, name: (n: string) => string, path: boolean[], hot: (string | undefined)[]): ReactNode[] {
  return branches.flatMap((b, i) => {
    const here = [...path, i === branches.length - 1]
    const later = branches.slice(i + 1).find(troubled)
    const end = { top: hotOf(troubled(b) ? b : later), elbow: troubled(b) ? hotOf(b) : undefined, bottom: hotOf(later) }
    return [
      <li key={b.task.id}>
        <OutlineRow b={b} state={state} now={now} name={name} path={here} hot={hot} end={end} />
      </li>,
      ...outlineRows(b.children, state, now, name, here, [...hot, hotOf(later)]),
    ]
  })
}

export function TreeOutline({ roots, state, now, name }: { roots: Root[]; state: ChannelState; now: number; name: (n: string) => string }) {
  return (
    <div className="flex flex-col gap-6 pt-3 pb-8">
      {roots.map((root) => (
        <section key={root.key} aria-label={requestText(root, state)}>
          <header className="flex flex-col gap-2 px-3 pb-1 md:flex-row md:items-start md:gap-4">
            <span className="flex min-w-0 flex-1 items-start gap-3">
              <Face state={state} name={root.from} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block border-l-2 border-edge-strong pl-2.5 text-body text-ink">{requestText(root, state)}</span>
                <span className="mt-1 block text-meta text-ink-3 tabular-nums">
                  {memberName(state.members.get(root.from), root.from)}
                  {root.seq ? ` · #${root.seq}` : ""} · {formatTime(root.at)}
                  {root.splitBy ? ` · split by ${memberName(state.members.get(root.splitBy), root.splitBy)}` : ""}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 flex-col gap-1.5 pl-10 md:w-80 md:items-end md:pl-0">
              <Bar roll={root.roll} className="w-full md:w-40" />
              <span className="md:text-right">
                <RollLine roll={root.roll} time={false} />
              </span>
            </span>
          </header>
          <ul className="pl-4">{outlineRows(root.branches, state, now, name, [], [])}</ul>
        </section>
      ))}
    </div>
  )
}

function ChainLine({ c, state }: { c: Chain; state: ChannelState }) {
  const steps = [c.branch.task, ...c.up]
  return (
    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-ink-3">
      {steps.map((t, i) => (
        <span key={t.id} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="whitespace-nowrap">
              holds up
            </span>
          )}
          {t.owner && <Face state={state} name={t.owner} size={16} />}
          <span className={cx("tabular-nums", i === 0 ? "font-semibold text-ink-2" : "text-ink-2")}>{taskId(t.id)}</span>
          <span className="max-w-[200px] truncate">{t.title}</span>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="whitespace-nowrap">
          holds up
        </span>
        <Face state={state} name={c.root.from} size={16} />
        <span className="whitespace-nowrap text-ink-2">{c.root.kind === "message" ? `your #${c.root.seq}` : requestText(c.root, state)}</span>
        {c.root.kind === "message" && <span className="max-w-[220px] truncate">“{c.root.text}”</span>}
      </span>
    </span>
  )
}

export function StuckChains({
  chains,
  state,
  asks,
  now,
  name,
  title = "Where it's stuck",
  stalled = [],
}: {
  chains: Chain[]
  state: ChannelState
  asks: Message[]
  now: number
  name: (n: string) => string
  title?: string
  stalled?: Stall[]
}) {
  if (!chains.length && !stalled.length) return null
  return (
    <section aria-label={title} className="pt-3 pb-2">
      <h2 className="flex items-baseline gap-2 text-ui font-semibold">
        {title} <span className="font-normal text-ink-3 tabular-nums">{chains.length + stalled.length}</span>
      </h2>
      <ul className="divide-y divide-line border-b border-line">
        {chains.map((c) => {
          const t = c.branch.task
          const ask = asks.find((m) => m.task === t.id)
          const pr = taskPr(state, t.id)
          const hand = baton(state, c.branch, name)
          const waited = hand.since === undefined ? c.branch.ms : now - hand.since
          return (
            <li key={t.id}>
              <Row
                icon={c.branch.health === "red" ? CancelCircleIcon : HelpCircleIcon}
                lead={
                  <span className={TONE[c.branch.health]}>
                    <Icon icon={c.branch.health === "red" ? CancelCircleIcon : HelpCircleIcon} size={17} />
                  </span>
                }
                title={c.branch.health === "waits" && ask ? ask.body : `${c.branch.why}${pr ? ` on PR #${pr.pr.number}` : ""}: ${t.title}`}
                detail={
                  <>
                    <ChainLine c={c} state={state} />
                    <span className="mt-1 block tabular-nums">
                      <span className={cx("font-semibold", TONE[c.branch.health])}>
                        {c.branch.health === "waits" ? "waiting on you" : "red"} for {span(waited)}
                      </span>
                      {" · "}
                      {c.root.roll.tasks - c.root.roll.done} of {c.root.roll.tasks} tasks for {c.root.kind === "message" ? `#${c.root.seq}` : "it"} still open
                    </span>
                  </>
                }
              >
                {c.branch.health === "waits" && ask?.choices ? (
                  ask.choices.map((o) => (
                    <Button key={o} size="sm" variant="secondary">
                      {o}
                    </Button>
                  ))
                ) : (
                  <>
                    <Button size="sm" variant="secondary">
                      Open the log
                    </Button>
                    <Button size="sm" variant="secondary">
                      Re-run
                    </Button>
                  </>
                )}
              </Row>
            </li>
          )
        })}
        {stalled.map((c) => (
          <li key={`s${c.branch.task.id}`}>
            <Row
              lead={
                <span className="text-ink-2">
                  <Icon icon={PauseIcon} size={17} />
                </span>
              }
              title={c.what}
              detail={
                <>
                  <ChainLine c={c} state={state} />
                  <span className="mt-1 block tabular-nums">
                    <span className="font-semibold text-ink-2">stalled for {span(now - c.since)}</span>
                    {" · "}
                    {c.root.roll.tasks - c.root.roll.done} of {c.root.roll.tasks} tasks for {c.root.kind === "message" ? `#${c.root.seq}` : "it"} still open
                  </span>
                </>
              }
            >
              <Button size="sm" variant="secondary">
                Hand it on
              </Button>
              <Button size="sm" variant="secondary">
                Ping {name(c.who)}
              </Button>
            </Row>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SinceYouLeft({ changes, since, now }: { changes: Change[]; since: number; now: number }) {
  if (!changes.length) return null
  return (
    <section aria-label="Since you left" className="pt-4 pb-1">
      <h2 className="flex items-baseline gap-2 text-ui font-semibold">
        Since you left <span className="font-normal text-ink-3 tabular-nums">{changes.length}</span>
      </h2>
      <ul className="pt-1.5">
        {changes.map((c) => (
          <li key={`${c.at}-${c.text}`} className="grid grid-cols-[52px_10px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-row py-1.5 text-ui hover:bg-wash">
            <time className="text-meta text-ink-3 tabular-nums">{span(now - c.at)}</time>
            <span aria-hidden className={cx("size-2 rounded-full", FILL[c.tone])} />
            <span className="truncate text-ink">{c.text}</span>
            {c.task !== undefined ? <span className="text-meta text-ink-3 tabular-nums">{taskId(c.task)}</span> : <span />}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3 text-meta text-ink-3">
        <span className="h-px flex-1 bg-line" />
        <span className="tabular-nums">you were here · {formatTime(since)}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </section>
  )
}
