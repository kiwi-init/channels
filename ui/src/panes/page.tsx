import "~/i18n/en/shell-later"
import "~/i18n/en/specs"
import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { Suspense, useMemo, type ReactNode } from "react"

import { Body } from "~/chat/body"
import { useNames, useTaskIds } from "~/chat/conversation"
import { STATUS_WORDS } from "~/kit/bits"
import { GlyphIcon } from "~/kit/icons"
import { later } from "~/kit/later"
import { openMessage } from "~/live/open-message"
import type { Actions, Ask, Channel, PullRequest, Spec, Task, TaskStatus } from "~/model"
import { useAct } from "~/nav"
import { lanesOf, nowOf } from "~/now"
import { inert, lookupOf, pieces, seal, type Seal } from "~/panes/engine"
import { usePane } from "~/panes/place"
import type { DetailView, View } from "~/panes/place"
import { statusOf } from "~/shell/sidebar"
import { openImage } from "~/specs/comment-item"
import { wordsPlain, wordsRaw, wrote } from "~/words"
import { t } from "~/i18n/i18n"

const Detail = later(() => import("~/panes/detail").then((m) => m.Detail))
const NeedsYou = later(() => import("~/needs/needs").then((m) => m.NeedsYou))
const SpecsView = later(() => import("~/specs/view").then((m) => m.SpecsView))

type BoardView = Extract<View, { kind: "now" } | { kind: "agents" } | { kind: "github" }>

const isDetail = (view: View): view is DetailView => view.kind === "task" || view.kind === "pr" || view.kind === "issue"

const viewKey = (view: View): string =>
  `${view.kind}:${view.kind === "task" ? view.task : view.kind === "spec" ? view.ask : view.kind === "pr" || view.kind === "issue" ? `${view.repo}/${view.number}` : ""}`

export interface Maker {
  seal: Seal
  act: (label: string, run: () => void, mark?: typeof OUT) => string
  field: (render: () => ReactNode) => string
  fields: ReadonlyMap<string, () => ReactNode>
}

export const OUT = "kiwi:out"

const pageMark = (name: string): ReactNode | undefined => (name === OUT ? <GlyphIcon glyph={LinkSquare02Icon} size={12} /> : undefined)

export function maker(): Maker {
  const s = seal()
  const tag = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")
  const fields = new Map<string, () => ReactNode>()
  return {
    seal: s,
    act: (label, run, mark) => `[${mark ? `\`${mark}\` ` : ""}${inert(label).replace(/[[\]\\]/g, "\\$&")}](${s.key(run)})`,
    field: (render) => {
      const name = `${tag}-${fields.size}`
      fields.set(name, render)
      return ["```kiwi-field", name, "```"].join("\n")
    },
    fields,
  }
}

const NO_FIELDS: ReadonlyMap<string, () => ReactNode> = new Map()

const ORDER: readonly TaskStatus[] = ["waiting", "doing", "review", "landing", "todo"]
const BAR: readonly TaskStatus[] = ["done", "landing", "review", "doing", "waiting", "todo"]
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
export const join = (parts: readonly string[]): string => parts.filter(Boolean).join("\n\n")
export const section = (title: string, lines: readonly string[], gap = "\n"): string => (lines.length ? `## ${title}\n\n${lines.join(gap)}` : "")
const live = (channel: Channel): Task[] => channel.tasks.filter((x) => !x.archived && !x.cancelled)
export const steps = (task: Task): string => {
  const all = task.steps?.filter((s) => s.state !== "skipped") ?? []
  return all.length ? ` · ${all.filter((s) => s.state === "done").length}/${all.length}` : ""
}
export const link = (label: string, url: string): string => `[${inert(label).replace(/[[\]\\]/g, "\\$&")}](<${url}>)`
export const main = (act: string): string => (act ? `**${act}**` : "")
export const card = (parts: readonly string[]): string =>
  join(parts)
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
export const taskRow = (channel: Channel, task: Task, more = ""): string => `- ${link(wordsPlain(task.title, channel.nicknames), `kiwi-task:${task.id}`)}${more}`
const specRow = (channel: Channel, spec: Spec, more: string): string => `- ${link(wordsPlain(spec.title, channel.nicknames), `kiwi-msg:${spec.ask}`)} · ${more}`
export const prRow = (pr: PullRequest): string =>
  `- ${link(`#${pr.number} ${pr.title}`, `kiwi-pr:${pr.repo}/${pr.number}`)}${pr.state === "draft" || pr.state === "closed" ? ` · ${pr.state}` : ""}${pr.checks === "none" || pr.state === "merged" ? "" : ` · ${pr.checks}`}`

function nowPage(channel: Channel): string {
  const now = nowOf(channel)
  const open = live(channel).filter((x) => x.status !== "done")
  const working = now.working.length + now.more
  const counts = [working ? t("tasks.now.in.progress.count", { count: working }) : "", now.doneCount ? t("tasks.now.done.today.count", { count: now.doneCount }) : ""].filter(Boolean).join(" · ")
  const count = (status: TaskStatus): number => (status === "done" ? now.doneCount : open.filter((x) => x.status === status).length)
  const bar = open.length + now.doneCount ? ["```kiwi-bar", ...BAR.filter((status) => count(status)).map((status) => `${status} ${count(status)}`), "```"].join("\n") : ""
  const groups = ORDER.map((status) =>
    section(
      cap(STATUS_WORDS[status]),
      open
        .filter((x) => x.status === status)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((x) => taskRow(channel, x, steps(x)))
    )
  )
  return join([`# ${t("panes.now")}`, counts, bar, now.next ?? "", ...groups, open.length ? "" : t("panes.page.empty")])
}

function agentsPage(channel: Channel): string {
  const lanes = lanesOf(channel).map((lane) =>
    join([
      `## @${lane.person.name} · ${statusOf(lane.person, channel)}`,
      [...lane.current.map((x) => taskRow(channel, x, steps(x))), ...lane.next.map((x) => taskRow(channel, x, ` · ${t("panes.page.next").toLowerCase()}`)), ...lane.watching.map(prRow)].join("\n"),
    ])
  )
  return join([`# ${t("shell.channel.agents")}`, ...lanes, lanes.length ? "" : t("panes.page.empty")])
}

function githubPage(channel: Channel): string {
  const prs = (channel.prs ?? []).filter((p) => p.state === "open" || p.state === "draft").map(prRow)
  const merged = (channel.prs ?? []).filter((p) => p.state === "merged").map(prRow)
  const issues = (channel.issues ?? []).filter((i) => i.state === "open").map((i) => `- ${link(`#${i.number} ${i.title}`, `kiwi-issue:${i.repo}/${i.number}`)}${i.task ? ` · T${i.task}` : ""}`)
  return join([
    `# ${t("shell.channel.github")}`,
    section(t("panes.page.prs"), prs),
    section(t("panes.page.issues"), issues),
    section(t("panes.page.done"), merged),
    prs.length + issues.length + merged.length ? "" : t("panes.page.empty"),
  ])
}

function held(channel: Channel, id: number): string {
  const task = channel.tasks.find((x) => x.id === id)
  return task ? taskRow(channel, task, steps(task)) : `T${id}`
}

export function askCard(channel: Channel, a: Ask, actions: Actions, m: Maker): string {
  const code = channel.code
  if (a.kind === "permission")
    return card([
      `### ${t("panes.page.runs", { name: `@${a.from}`, tool: a.tool })}`,
      `\`${a.title.replaceAll("`", "'")}\``,
      inert(a.summary ?? ""),
      [
        a.canAllow ? main(m.act(t("panes.page.allow"), () => actions.answerPermission(code, a.id, true))) : "",
        a.canDeny ? m.act(t("panes.page.deny"), () => actions.answerPermission(code, a.id, false)) : "",
      ]
        .filter(Boolean)
        .join(" "),
    ])
  if (a.kind === "question")
    return card([
      `### ${t("panes.page.asks", { name: `@${a.from}` })}`,
      inert(wordsRaw(a.text)),
      a.options.map((o) => `- ${m.act(wordsRaw(o), () => actions.answerQuestion(code, a.id, wordsRaw(o)))}`).join("\n"),
    ])
  if (a.kind === "join")
    return card([
      `### ${t("panes.page.joins", { name: a.name })}`,
      `${main(m.act(t("panes.page.let.in"), () => actions.answerJoin(code, a.id, true)))} ${m.act(t("panes.page.decline"), () => actions.answerJoin(code, a.id, false))}`,
    ])
  if (a.kind === "review") return card([`### ${t("panes.page.review", { name: `@${a.from}` })}`, held(channel, a.task)])
  if (a.kind === "spec") {
    const spec = channel.specs?.find((s) => s.ask === a.ask)
    return card([`### ${t("panes.page.spec")}`, spec ? specRow(channel, spec, spec.stage) : `#${a.ask}`])
  }
  return card([`### ${t("panes.page.quiet", { name: `@${a.from}` })}`, held(channel, a.task)])
}

function boardText(channel: Channel, view: BoardView): { md: string; seal: Seal } {
  const m = maker()
  const md = view.kind === "now" ? nowPage(channel) : view.kind === "agents" ? agentsPage(channel) : githubPage(channel)
  return { md, seal: m.seal }
}

export function PageText({ channel, md, seal, fields = NO_FIELDS }: { channel: Channel; md: string; seal: Seal; fields?: ReadonlyMap<string, () => ReactNode> }) {
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const { go } = useAct()
  const pane = usePane()
  const text = useMemo(() => wrote(md), [md])
  const draw = useMemo(() => pieces(lookupOf(channel), pageMark, seal.owns, (name) => fields.get(name)?.()), [channel, seal, fields])
  const code = channel.code
  const onPage = (url: string) => {
    if (url.startsWith("kiwi-do:")) return seal.run(url)
    const gh = /^kiwi-(pr|issue):(.+)\/(\d+)$/.exec(url)
    if (gh) return go({ to: "panel", panel: { kind: gh[1] === "pr" ? "pr" : "issue", repo: gh[2]!, number: Number(gh[3]) } })
    const to = url.slice("kiwi-page:".length)
    if (to === "now") return pane?.show({ kind: "now" })
    if (to === "specs") return go({ to: "spec", ask: null })
    if (to === "agents" || to === "github" || to === "needs") return go({ to: "tab", tab: to })
  }
  const onMessage = (seq: number) => (channel.specs?.some((s) => s.ask === seq) ? go({ to: "spec", ask: seq, part: "spec" }) : openMessage(code, seq))
  return <Body text={text} seq={Number.MAX_SAFE_INTEGER} names={names} tasks={tasks} onImage={openImage} onMessage={onMessage} onPage={onPage} draw={draw} />
}

export function PageFrame({ kind, children, more }: { kind: string; children: ReactNode; more?: ReactNode }) {
  return (
    <div className={`page is-${kind}`}>
      <article className="page-text">{children}</article>
      {more}
    </div>
  )
}

export function Page({ channel, view }: { channel: Channel; view: View }) {
  if (view.kind === "needs")
    return (
      <Suspense fallback={null}>
        <NeedsYou channel={channel} />
      </Suspense>
    )
  if (view.kind === "specs" || view.kind === "spec")
    return (
      <Suspense fallback={null}>
        <SpecsView channel={channel} />
      </Suspense>
    )
  if (!isDetail(view)) return <Board channel={channel} view={view} />
  return (
    <Suspense fallback={null}>
      <Detail key={viewKey(view)} channel={channel} view={view} />
    </Suspense>
  )
}

function Board({ channel, view }: { channel: Channel; view: BoardView }) {
  const built = useMemo(() => boardText(channel, view), [channel, view])
  return (
    <PageFrame kind={view.kind}>
      <PageText channel={channel} md={built.md} seal={built.seal} />
    </PageFrame>
  )
}
