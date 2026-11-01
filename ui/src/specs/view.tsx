import "~/styles/tasks.css"
import "~/styles/github.css"
import "~/styles/specs.css"

import { useState, type ReactNode } from "react"

import { Avatar, cx, Empty, Loading } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import { ago } from "~/kit/time"
import type { Channel, Spec, Task } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"
import { SpecMark } from "~/specs/card"
import { openAsks } from "~/needs/open"
import { boxesOf, faceOf, freeCount, lastMove, needsYou, stageLine, tasksOf, workersOf } from "~/specs/read"
import { NowCard } from "~/tasks/now"
import { TaskRow } from "~/tasks/row"

const LOOSE_SHOWN = 5

const SpecPage = later(() => import("~/specs/page").then((m) => m.SpecPage))
const NewSpec = later(() => import("~/specs/new").then((m) => m.NewSpec))

type Shown = "open" | "done"

interface Group {
  key: string
  label: string
  sub: string
  tone?: string
  rows: Spec[]
}

function groupsOf(channel: Channel, shown: Shown): Group[] {
  const specs = channel.specs ?? []
  if (shown === "done")
    return [
      { key: "accepted", label: "Accepted", sub: "What people said yes to.", rows: specs.filter((s) => s.stage === "accepted") },
      { key: "dropped", label: "Dropped", sub: "Stopped on purpose, with what was tried.", rows: specs.filter((s) => s.stage === "dropped") },
    ].filter((g) => g.rows.length)
  const free = freeCount(channel)
  const open = specs.filter((s) => !s.result)
  const yours = open.filter(needsYou)
  const rest = open.filter((s) => !needsYou(s))
  return [
    { key: "yours", label: "Needs you", sub: "A spec to approve, a change to look at, or a result to judge.", tone: "tone-decide", rows: yours },
    {
      key: "working",
      label: "Working",
      sub: "Agents are on it. Open one to look inside.",
      tone: "tone-doing",
      rows: rest.filter((s) => s.stage === "working" || (s.stage === "queued" && !!s.planner)),
    },
    {
      key: "queued",
      label: "Waiting for an agent",
      sub: `Approved. Each starts by itself when an agent is free: ${free === 0 ? "none is right now" : free === 1 ? "1 is now" : `${free} are now`}.`,
      rows: rest.filter((s) => s.stage === "queued" && !s.planner).sort((a, b) => (a.queue ?? 99) - (b.queue ?? 99)),
    },
    { key: "drafts", label: "Drafts", sub: "Still being written. Comment on any line.", rows: rest.filter((s) => s.stage === "draft") },
    { key: "delivered", label: "Delivered", sub: "Waiting on who asked.", rows: rest.filter((s) => s.stage === "delivered") },
  ].filter((g) => g.rows.length)
}

export function SpecsView({ channel, tall }: { channel: Channel; tall?: boolean }) {
  const { nav } = useApp()
  const spec = nav.spec !== undefined ? channel.specs?.find((s) => s.ask === nav.spec) : undefined
  if (spec) return <SpecPage channel={channel} spec={spec} />
  return <SpecList channel={channel} tall={!!tall} />
}

function SpecList({ channel, tall }: { channel: Channel; tall: boolean }) {
  const [shown, setShown] = useState<Shown>("open")
  const [making, setMaking] = useState(false)
  const specs = channel.specs ?? []
  const open = specs.filter((s) => !s.result).length
  const groups = groupsOf(channel, shown)
  const inSpecs = new Set(specs.flatMap((s) => s.tasks))
  const loose = channel.tasks.filter((t) => !inSpecs.has(t.id) && !t.archived && t.status !== "done")
  const live = channel.tasks.some((t) => !t.archived)
  return (
    <div className="board">
      <div className="board-list gh-list specs-list">
        {live && !tall && <NowCard channel={channel} needs={openAsks(channel).length} />}
        <div className="gh-top">
          <Track className="seg" role="group" aria-label="Open or done">
            <button type="button" aria-pressed={shown === "open"} onClick={() => setShown("open")}>
              Open <span className="gh-n num">{open}</span>
            </button>
            <button type="button" aria-pressed={shown === "done"} onClick={() => setShown("done")}>
              Done <span className="gh-n num">{specs.length - open}</span>
            </button>
          </Track>
          <p className="specs-how">Write it together, approve it, and agents start by themselves when one is free.</p>
          <button type="button" className="btn is-primary" onClick={() => setMaking(true)}>
            <Icon name="plus" size={14} />
            New spec
          </button>
        </div>
        {groups.map((g) => (
          <GroupCard key={g.key} channel={channel} group={g} />
        ))}
        {shown === "open" && loose.length > 0 && <Loose channel={channel} tasks={loose} specsOnly={!!channel.specsOnly} />}
        {groups.length || (shown === "open" && loose.length) ? null : channel.loading ? (
          <Loading />
        ) : (
          <Empty title={shown === "open" ? "No open specs." : "Nothing finished yet."} icon="spec">
            {shown === "open"
              ? "Ask for something in your own words. The lead drafts a spec, you all comment on it, and once someone approves it agents take it from there."
              : "Accepted and dropped specs stay here."}
          </Empty>
        )}
      </div>
      {making && <NewSpec channel={channel} onClose={() => setMaking(false)} />}
    </div>
  )
}

function GroupCard({ channel, group }: { channel: Channel; group: Group }) {
  return (
    <section className={cx("board-group gh-group", `is-${group.key}`)} aria-label={group.label}>
      <div className="board-head">
        <h2 className="board-h">
          {group.tone && <span className={cx("specs-group-dot", group.tone)} aria-hidden="true" />}
          <span className={cx("board-label", group.tone)}>{group.label}</span>
          <span className="board-n num">{group.rows.length}</span>
        </h2>
        <p className="board-sub">
          <span>{group.sub}</span>
        </p>
      </div>
      <ul className="gh-rows">
        {group.rows.map((s) => (
          <SpecRow key={s.ask} channel={channel} spec={s} />
        ))}
      </ul>
    </section>
  )
}

function Loose({ channel, tasks, specsOnly }: { channel: Channel; tasks: Task[]; specsOnly: boolean }) {
  const { nav } = useApp()
  const [all, setAll] = useState(false)
  const on = nav.panel?.kind === "task" ? nav.panel.task : null
  const rows = all ? tasks : tasks.slice(0, LOOSE_SHOWN)
  return (
    <section className="board-group gh-group is-loose" aria-label="Not in a spec">
      <div className="board-head">
        <h2 className="board-h">
          <span className="board-label">Not in a spec</span>
          <span className="board-n num">{tasks.length}</span>
        </h2>
        <p className="board-sub">
          <span>
            {specsOnly
              ? "From before specs. Every new task is a step of an approved spec."
              : "Tasks filed before this channel worked from specs. Turn on Tasks only from approved specs in the channel's settings."}
          </span>
        </p>
      </div>
      <ul className="board-rows">
        {rows.map((t) => (
          <li key={t.id}>
            <TaskRow channel={channel} t={t} on={t.id === on} />
          </li>
        ))}
      </ul>
      {tasks.length > LOOSE_SHOWN && (
        <button type="button" className="board-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${tasks.length}`}
        </button>
      )}
    </section>
  )
}

function SpecTasks({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { nav } = useApp()
  const on = nav.panel?.kind === "task" ? nav.panel.task : null
  const tasks = tasksOf(channel, spec).filter((t) => !t.archived && !t.cancelled)
  const open = tasks.filter((t) => t.status !== "done")
  const done = tasks.length - open.length
  if (!tasks.length || spec.result) return null
  return (
    <div className="spec-steps">
      {open.length > 0 && (
        <ul className="board-rows">
          {open.map((t) => (
            <li key={t.id}>
              <TaskRow channel={channel} t={t} on={t.id === on} />
            </li>
          ))}
        </ul>
      )}
      {done > 0 && (
        <p className="spec-steps-done num">
          {done} of {tasks.length} {tasks.length === 1 ? "task" : "tasks"} done
        </p>
      )}
    </div>
  )
}

function SpecRow({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { go } = useApp()
  const line = stageLine(channel, spec)
  const boxes = boxesOf(spec)
  const done = boxes.filter((b) => b.done).length
  const who = workersOf(channel, spec)
  const part = spec.stage === "delivered" ? "result" : spec.stage === "working" ? "inside" : "spec"
  return (
    <li className="gh-item">
      <button type="button" className="gh-row spec-row" onClick={() => go({ to: "spec", ask: spec.ask, part })}>
        <SpecMark spec={spec} />
        <span className="gh-title">{spec.title}</span>
        <span className="gh-meta">
          <span className="num">#{spec.ask}</span>
          <span>{nickname(channel, spec.by)}</span>
          <span>{ago(lastMove(channel, spec))}</span>
          {boxes.length > 0 && (
            <span className="num">
              {done}/{boxes.length} done when
            </span>
          )}
          <span>{line.line}</span>
        </span>
        <span className="spec-row-end">
          {who.length > 0 && (
            <span className="spec-card-faces" aria-hidden="true">
              {who.slice(0, 3).map((n) => (
                <Avatar key={n} person={faceOf(channel, n)} size="sm" />
              ))}
            </span>
          )}
          <span className={cx("spec-word", line.tone)}>{line.word}</span>
        </span>
      </button>
      <SpecTasks channel={channel} spec={spec} />
    </li>
  )
}

export function SpecSide({ channel }: { channel: Channel }): ReactNode {
  const { nav, go } = useApp()
  const open = (channel.specs ?? []).filter((s) => !s.result)
  if (!open.length) return null
  return (
    <ul>
      {open.map((s) => {
        const on = nav.tab === "specs" && nav.spec === s.ask
        const line = stageLine(channel, s)
        return (
          <li key={s.ask}>
            <button type="button" className={cx("side-row spec-side", on && "is-on", needsYou(s) && "is-news")} aria-current={on ? "page" : undefined} onClick={() => go({ to: "spec", ask: s.ask })}>
              <span className="side-hash">
                <SpecMark spec={s} />
              </span>
              <span className="side-label">{s.title}</span>
              <span className={cx("spec-side-word", line.tone)}>{line.word}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
