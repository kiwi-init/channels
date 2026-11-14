import "~/i18n/en/specs"
import "~/styles/tasks.css"
import "~/styles/github.css"
import "~/styles/specs.css"

import { useMemo, useState } from "react"

import { t } from "~/i18n/i18n"
import { Avatar, Loading } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import type { Channel, Spec } from "~/model"
import { useNav } from "~/nav"
import { nickname } from "~/names"
import { toned, type Lookup } from "~/panes/engine"
import { join, link, maker, newTag, PageFrame, PageText, type Maker } from "~/panes/page"
import { dragOut } from "~/panes/place"
import { SpecMark } from "~/specs/card"
import { faceOf, needsYou, tasksOf, workersOf } from "~/specs/read"
import { useTaskNow } from "~/tasks/mover"
import { NowCard } from "~/tasks/now"
import { taskLine } from "~/tasks/row"
import { wordsPlain } from "~/words"

const LOOSE_SHOWN = 3
const DONE_PAGE = 20

const SpecPage = later(() => import("~/specs/page").then((m) => m.SpecPage))
const NewSpec = later(() => import("~/specs/new").then((m) => m.NewSpec))

type Showing = "open" | "done"

interface Group {
  key: string
  label: string
  tone?: string
  rows: Spec[]
}

function groupsOf(channel: Channel, shown: Showing): Group[] {
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

interface ListState {
  shown: Showing
  pages: number
  on: number | null
  now: number
}

interface ListActs {
  show: (shown: Showing) => void
  page: (pages: number) => void
  make: () => void
}

const SPEC_URL = /^kiwi-page:spec:(\d+)/

const specAt = (channel: Channel, url: string): Spec | undefined => {
  const ask = SPEC_URL.exec(url)?.[1]
  return ask === undefined ? undefined : channel.specs?.find((s) => s.ask === Number(ask))
}

const partOf = (spec: Spec): string => (spec.stage === "delivered" ? "result" : spec.stage === "working" ? "inside" : "spec")

const nest = (md: string): string => md.replace(/^/gm, "  ")

function specLine(channel: Channel, spec: Spec, state: ListState): string {
  const row = `- ${link(wordsPlain(spec.title, channel.nicknames), `kiwi-page:spec:${spec.ask}:${partOf(spec)}`)}`
  const tasks = spec.result ? [] : tasksOf(channel, spec).filter((task) => !task.archived && !task.cancelled)
  if (!tasks.length) return row
  const open = tasks.filter((task) => task.status !== "done")
  const count = `${tasks.length - open.length}/${tasks.length} ${t("specs.view.task.word", { count: tasks.length })}`
  if (!open.length) return `${row} · ${count}`
  const first = open.some((task) => task.status === "waiting" || task.id === state.on)
  return [`${row} · ${count} \`${first ? "kiwi:open" : "kiwi:fold"}\``, ...open.map((task) => nest(taskLine(channel, task, state.now)))].join("\n")
}

export function specsText(channel: Channel, state: ListState, acts: ListActs, m: Maker): string {
  const specs = channel.specs ?? []
  const open = specs.filter((s) => !s.result).length
  const groups = groupsOf(channel, state.shown)
  const inSpecs = new Set(specs.flatMap((s) => s.tasks))
  const loose = channel.tasks.filter((task) => !inSpecs.has(task.id) && !task.archived && task.status !== "done")
  const finished = channel.tasks.filter((task) => !inSpecs.has(task.id) && !task.cancelled && task.status === "done").sort((a, b) => b.updatedAt - a.updatedAt)
  const live = channel.tasks.some((task) => !task.archived)
  const tasks = state.shown === "open" ? loose : finished
  const page = state.shown === "open" ? LOOSE_SHOWN : DONE_PAGE
  const rows = tasks.slice(0, page * state.pages)
  const left = tasks.length - rows.length
  const more = state.shown === "done"
  const counts = { open: open + loose.length, done: specs.length - open + finished.length }
  const top = m.field("top", () => <ListTop shown={state.shown} counts={counts} seg={specs.length > 0 || finished.length > 0} acts={acts} />)
  const empty = !specs.length ? t("specs.view.empty") : state.shown === "open" ? t("specs.view.empty.open") : t("specs.view.empty.done")
  const label = specs.length ? t("specs.view.not.in.spec") : t("specs.view.tasks")
  const paging =
    tasks.length > page
      ? m.act(left > 0 ? t("specs.view.show.more", { count: more ? Math.min(page, left) : left }) : t("specs.view.show.fewer"), () =>
          acts.page(left > 0 ? (more ? state.pages + 1 : Math.ceil(tasks.length / page)) : 1)
        )
      : ""
  return join([
    `# ${t("shell.channel.specs")}`,
    live ? m.field("now", () => <NowCard channel={channel} />) : "",
    top,
    channel.behind ? toned(t("specs.view.reading"), "tone-quiet") : "",
    ...groups.map((g) => join([`## ${toned(g.label, g.tone)} · ${g.rows.length}`, g.rows.map((s) => specLine(channel, s, state)).join("\n")])),
    tasks.length ? join([`## ${toned(label)} · ${tasks.length}`, rows.map((task) => taskLine(channel, task, state.now)).join("\n"), paging]) : "",
    groups.length || tasks.length ? "" : channel.loading ? m.field("loading", () => <Loading />) : channel.behind ? "" : m.field("empty", () => <Empty title={empty} icon="spec" />),
  ])
}

function ListTop({ shown, counts, seg, acts }: { shown: Showing; counts: { open: number; done: number }; seg: boolean; acts: ListActs }) {
  return (
    <div className="gh-top">
      {seg && (
        <Track className="seg" role="group" aria-label={t("specs.view.open.or.done")}>
          <button type="button" aria-pressed={shown === "open"} onClick={() => acts.show("open")}>
            {t("specs.view.open")} <span className="gh-n num">{counts.open}</span>
          </button>
          <button type="button" aria-pressed={shown === "done"} onClick={() => acts.show("done")}>
            {t("specs.view.done")} <span className="gh-n num">{counts.done}</span>
          </button>
        </Track>
      )}
      <button type="button" className="btn is-primary" onClick={acts.make}>
        <Icon name="plus" size={14} />
        {t("specs.view.new")}
      </button>
    </div>
  )
}

export function SpecFaces({ channel, spec }: { channel: Channel; spec: Spec }) {
  const who = workersOf(channel, spec)
  if (!who.length) return null
  return (
    <span className="spec-card-faces spec-row-faces">
      {who.slice(0, 3).map((n) => (
        <span key={n} className="spec-face">
          <Avatar person={faceOf(channel, n)} size="sm" />
          <span className="spec-face-name">{nickname(channel, n)}</span>
        </span>
      ))}
      <span className="spec-faces-all" aria-hidden="true">
        {who
          .slice(0, 3)
          .map((n) => nickname(channel, n))
          .join(", ")}
      </span>
    </span>
  )
}

export const specsLook = (channel: Channel, on: number | null): Partial<Lookup> => ({
  on: (url) => on !== null && url === `kiwi-task:${on}`,
  lead: (url) => {
    const spec = specAt(channel, url)
    return spec ? <SpecMark spec={spec} /> : undefined
  },
  trail: (url) => {
    const spec = specAt(channel, url)
    return spec ? <SpecFaces channel={channel} spec={spec} /> : undefined
  },
  drag: (url) => {
    const spec = specAt(channel, url)
    return spec ? dragOut({ page: { at: "spec", ask: spec.ask } }, wordsPlain(spec.title, channel.nicknames)) : undefined
  },
  fold: (url, open) => {
    const spec = specAt(channel, url)
    if (!spec) return undefined
    const count = tasksOf(channel, spec).filter((task) => !task.archived && !task.cancelled && task.status !== "done").length
    return t(open ? "specs.view.hide.tasks" : "specs.view.show.tasks", { count, title: wordsPlain(spec.title, channel.nicknames) })
  },
})

function SpecList({ channel }: { channel: Channel }) {
  const nav = useNav()
  const now = useTaskNow()
  const [tag] = useState(newTag)
  const [shown, setShown] = useState<Showing>("open")
  const [pages, setPages] = useState(1)
  const [making, setMaking] = useState(false)
  const on = nav.panel?.kind === "task" ? nav.panel.task : null
  const built = useMemo(() => {
    const m = maker(tag)
    const acts: ListActs = {
      show: (next) => {
        setShown(next)
        setPages(1)
      },
      page: setPages,
      make: () => setMaking(true),
    }
    return { md: specsText(channel, { shown, pages, on, now }, acts, m), m }
  }, [channel, shown, pages, on, now, tag])
  const look = useMemo(() => specsLook(channel, on), [channel, on])
  return (
    <PageFrame kind="specs" more={making && <NewSpec channel={channel} onClose={() => setMaking(false)} />}>
      <PageText channel={channel} md={built.md} seal={built.m.seal} fields={built.m.fields} look={look} />
    </PageFrame>
  )
}
