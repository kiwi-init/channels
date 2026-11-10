import "~/i18n/en/specs"
import "~/styles/tasks.css"
import "~/styles/github.css"
import "~/styles/specs.css"

import { useState } from "react"

import { t } from "~/i18n/i18n"
import { Avatar, cx, Loading } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import type { Channel, Spec, Task } from "~/model"
import { useGo, useNav } from "~/nav"
import { Shown } from "~/names"
import { SpecMark } from "~/specs/card"
import { faceOf, needsYou, tasksOf, workersOf } from "~/specs/read"
import { NowCard } from "~/tasks/now"
import { TaskRow } from "~/tasks/row"
import { wordsPlain } from "~/words"

const LOOSE_SHOWN = 3
const DONE_PAGE = 20

const SpecPage = later(() => import("~/specs/page").then((m) => m.SpecPage))
const NewSpec = later(() => import("~/specs/new").then((m) => m.NewSpec))

type Shown = "open" | "done"

interface Group {
  key: string
  label: string
  tone?: string
  rows: Spec[]
}

function groupsOf(channel: Channel, shown: Shown): Group[] {
  const specs = channel.specs ?? []
  if (shown === "done")
    return [
      { key: "accepted", label: t("specs.view.accepted"), rows: specs.filter((s) => s.stage === "accepted") },
      { key: "dropped", label: t("specs.view.dropped"), rows: specs.filter((s) => s.stage === "dropped") },
    ].filter((g) => g.rows.length)
  const open = specs.filter((s) => !s.result)
  const yours = open.filter(needsYou)
  const rest = open.filter((s) => !needsYou(s))
  return [
    { key: "yours", label: t("specs.view.needs.you"), tone: "tone-decide", rows: yours },
    { key: "working", label: t("specs.view.working"), tone: "tone-doing", rows: rest.filter((s) => s.stage === "working" || (s.stage === "queued" && !!s.planner)) },
    {
      key: "queued",
      label: t("specs.view.waiting"),
      rows: rest.filter((s) => s.stage === "queued" && !s.planner).sort((a, b) => (a.queue ?? 99) - (b.queue ?? 99)),
    },
    { key: "drafts", label: t("specs.view.drafts"), rows: rest.filter((s) => s.stage === "draft") },
    { key: "delivered", label: t("specs.view.delivered"), rows: rest.filter((s) => s.stage === "delivered") },
  ].filter((g) => g.rows.length)
}

export function SpecsView({ channel }: { channel: Channel }) {
  const nav = useNav()
  const spec = nav.spec !== undefined ? channel.specs?.find((s) => s.ask === nav.spec) : undefined
  if (spec) return <SpecPage key={`${channel.code}:${spec.ask}`} channel={channel} spec={spec} />
  return <SpecList channel={channel} />
}

function SpecList({ channel }: { channel: Channel }) {
  const [shown, setShown] = useState<Shown>("open")
  const [making, setMaking] = useState(false)
  const specs = channel.specs ?? []
  const open = specs.filter((s) => !s.result).length
  const groups = groupsOf(channel, shown)
  const inSpecs = new Set(specs.flatMap((s) => s.tasks))
  const loose = channel.tasks.filter((task) => !inSpecs.has(task.id) && !task.archived && task.status !== "done")
  const finished = channel.tasks.filter((task) => !inSpecs.has(task.id) && !task.cancelled && task.status === "done").sort((a, b) => b.updatedAt - a.updatedAt)
  const live = channel.tasks.some((task) => !task.archived)
  const tasks = shown === "open" ? loose : finished
  const label = specs.length ? t("specs.view.not.in.spec") : t("specs.view.tasks")
  return (
    <div className="board">
      <div className="board-list gh-list specs-list">
        {live && <NowCard channel={channel} />}
        <div className="gh-top">
          {(specs.length > 0 || finished.length > 0) && (
            <Track className="seg" role="group" aria-label={t("specs.view.open.or.done")}>
              <button type="button" aria-pressed={shown === "open"} onClick={() => setShown("open")}>
                {t("specs.view.open")} <span className="gh-n num">{open + loose.length}</span>
              </button>
              <button type="button" aria-pressed={shown === "done"} onClick={() => setShown("done")}>
                {t("specs.view.done")} <span className="gh-n num">{specs.length - open + finished.length}</span>
              </button>
            </Track>
          )}
          <button type="button" className="btn is-primary" onClick={() => setMaking(true)}>
            <Icon name="plus" size={14} />
            {t("specs.view.new")}
          </button>
        </div>
        {channel.behind && <p className="specs-behind">{t("specs.view.reading")}</p>}
        {groups.length || tasks.length ? (
          <div className="board-stack">
            {groups.map((g) => (
              <GroupCard key={g.key} channel={channel} group={g} />
            ))}
            {tasks.length > 0 && <Loose key={shown} channel={channel} tasks={tasks} label={label} page={shown === "open" ? LOOSE_SHOWN : DONE_PAGE} more={shown === "done"} />}
          </div>
        ) : channel.loading ? (
          <Loading />
        ) : channel.behind ? null : (
          <Empty title={!specs.length ? t("specs.view.empty") : shown === "open" ? t("specs.view.empty.open") : t("specs.view.empty.done")} icon="spec" />
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
          <span className={cx("board-label", group.tone)}>{group.label}</span>
          <span className="board-n num">{group.rows.length}</span>
        </h2>
      </div>
      <ul className="gh-rows">
        {group.rows.map((s) => (
          <SpecRow key={s.ask} channel={channel} spec={s} />
        ))}
      </ul>
    </section>
  )
}

function Loose({ channel, tasks, label, page, more }: { channel: Channel; tasks: Task[]; label: string; page: number; more: boolean }) {
  const nav = useNav()
  const [pages, setPages] = useState(1)
  const on = nav.panel?.kind === "task" ? nav.panel.task : null
  const rows = tasks.slice(0, page * pages)
  const left = tasks.length - rows.length
  return (
    <section className="board-group gh-group is-loose" aria-label={label}>
      <div className="board-head">
        <h2 className="board-h">
          <span className="board-label">{label}</span>
          <span className="board-n num">{tasks.length}</span>
        </h2>
      </div>
      <ul className="board-rows">
        {rows.map((task) => (
          <li key={task.id}>
            <TaskRow channel={channel} t={task} on={task.id === on} />
          </li>
        ))}
      </ul>
      {tasks.length > page && (
        <button type="button" className="board-more" onClick={() => setPages(left > 0 ? (more ? pages + 1 : Math.ceil(tasks.length / page)) : 1)}>
          {left > 0 ? t("specs.view.show.more", { count: more ? Math.min(page, left) : left }) : t("specs.view.show.fewer")}
        </button>
      )}
    </section>
  )
}

function SpecRow({ channel, spec }: { channel: Channel; spec: Spec }) {
  const nav = useNav()
  const go = useGo()
  const who = workersOf(channel, spec)
  const part = spec.stage === "delivered" ? "result" : spec.stage === "working" ? "inside" : "spec"
  const on = nav.panel?.kind === "task" ? nav.panel.task : null
  const tasks = spec.result ? [] : tasksOf(channel, spec).filter((task) => !task.archived && !task.cancelled)
  const open = tasks.filter((task) => task.status !== "done")
  const [unfolded, setUnfolded] = useState(() => open.some((task) => task.status === "waiting" || task.id === on))
  const shown = unfolded && open.length > 0
  return (
    <li className={cx("gh-item", shown && "is-unfolded")}>
      <button type="button" className="gh-row spec-row" onClick={() => go({ to: "spec", ask: spec.ask, part })}>
        <SpecMark spec={spec} />
        <span className="gh-title">
          <Shown value={spec.title} />
        </span>
        {who.length > 0 && (
          <span className="spec-card-faces spec-row-faces" aria-hidden="true">
            {who.slice(0, 3).map((n) => (
              <Avatar key={n} person={faceOf(channel, n)} size="sm" />
            ))}
          </span>
        )}
      </button>
      {open.length > 0 ? (
        <button
          type="button"
          className="spec-fold num"
          aria-expanded={shown}
          aria-label={t(shown ? "specs.view.hide.tasks" : "specs.view.show.tasks", { count: open.length, title: wordsPlain(spec.title, channel.nicknames) })}
          onClick={() => setUnfolded(!unfolded)}
        >
          {tasks.length - open.length}/{tasks.length}
          <span>{t("specs.view.task.word", { count: tasks.length })}</span>
          <Icon name="down" size={12} />
        </button>
      ) : tasks.length > 0 ? (
        <span className="spec-fold is-done num">
          {tasks.length}/{tasks.length}
          <span>{t("specs.view.task.word", { count: tasks.length })}</span>
        </span>
      ) : (
        <span className="spec-fold is-empty" aria-hidden="true" />
      )}
      {shown && (
        <ul className="board-rows spec-steps">
          {open.map((task) => (
            <li key={task.id}>
              <TaskRow channel={channel} t={task} on={task.id === on} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
