import "~/i18n/en/specs"
import { Suspense, useMemo, useState, type ReactNode } from "react"

import { Body } from "~/chat/body"
import { useNames, useTaskIds } from "~/chat/conversation"
import { STATUS_WORDS } from "~/kit/bits"
import { later } from "~/kit/later"
import { openMessage } from "~/live/open-message"
import type { Actions, Ask, Channel, PullRequest, Spec, Task, TaskStatus } from "~/model"
import { useAct } from "~/nav"
import { openAsks } from "~/needs/open"
import { lanesOf, nowOf } from "~/now"
import { lookupOf, pieces } from "~/panes/engine"
import { usePane } from "~/panes/scope"
import type { DetailView, View } from "~/panes/view"
import { statusOf } from "~/shell/sidebar"
import { openImage } from "~/specs/comment-item"
import { wordsPlain, wordsRaw, wrote } from "~/words"
import { t } from "~/i18n/i18n"

const NewSpec = later(() => import("~/specs/new").then((m) => m.NewSpec))
const Detail = later(() => import("~/panes/detail").then((m) => m.Detail))

interface Hooks {
  newSpec: () => void
  edit: (text: string) => void
}

type BoardView = Exclude<View, DetailView>

const isDetail = (view: View): view is DetailView => view.kind === "task" || view.kind === "pr" || view.kind === "issue"

const viewKey = (view: View): string =>
  `${view.kind}:${view.kind === "task" ? view.task : view.kind === "spec" ? view.ask : view.kind === "pr" || view.kind === "issue" ? `${view.repo}/${view.number}` : ""}`

export interface Maker {
  acts: Map<string, () => void>
  act: (label: string, run: () => void) => string
}

export function maker(): Maker {
  const acts = new Map<string, () => void>()
  return {
    acts,
    act(label, run) {
      const key = `a${acts.size}`
      acts.set(key, run)
      return `[${label.replace(/[[\]\\]/g, "\\$&")}](kiwi-do:${key})`
    },
  }
}

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
export const link = (label: string, url: string): string => `[${label.replace(/[[\]\\]/g, "\\$&")}](<${url}>)`
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

const tasksOf = (channel: Channel, spec: Spec): Task[] => live(channel).filter((x) => spec.tasks.includes(x.id))

function specPage(channel: Channel, ask: number, actions: Actions, m: Maker, hooks: Hooks): string {
  const spec = channel.specs?.find((s) => s.ask === ask)
  const crumb = `[${t("shell.channel.specs")}](kiwi-page:specs)`
  if (!spec) return join([crumb, `# #${ask}`])
  const title = wordsRaw(spec.title)
  const lines = wordsRaw(spec.text).split("\n")
  const first = lines.findIndex((l) => l.trim() !== "")
  const headed = first >= 0 && /^#\s+/.test(lines[first]!) && lines[first]!.replace(/^#\s+/, "").trim() === title
  const text = (headed ? lines.slice(first + 1) : lines).join("\n").trim()
  const judge = !spec.canJudge
    ? ""
    : spec.stage === "delivered"
      ? m.act(t("panes.page.accept"), () => actions.judgeSpec(channel.code, spec.ask, "accepted"))
      : spec.stage === "draft" || spec.changed
        ? m.act(t("panes.page.approve"), () => actions.approveSpec(channel.code, spec.ask, spec.v))
        : ""
  const tasks = tasksOf(channel, spec).map((x) => taskRow(channel, x, steps(x)))
  const edit = spec.result ? "" : m.act(t("panes.page.edit"), () => hooks.edit(wordsRaw(spec.text)))
  const comments = spec.comments.flatMap((seq) => channel.messages.filter((x) => x.seq === seq)).map((x) => `**@${x.from}** ${wordsRaw(x.text)}`)
  return join([
    crumb,
    `# ${title}`,
    [`#${spec.ask}`, spec.stage, `@${spec.by}`].join(" · "),
    [main(judge), edit].filter(Boolean).join(" "),
    text,
    section(t("panes.page.tasks"), tasks),
    section(t("panes.page.comments"), comments, "\n\n"),
  ])
}

function specsPage(channel: Channel, m: Maker, hooks: Hooks): string {
  const specs = channel.specs ?? []
  const row = (spec: Spec): string => [specRow(channel, spec, spec.stage), ...tasksOf(channel, spec).map((x) => `  ${taskRow(channel, x, steps(x))}`)].join("\n")
  const held = new Set(specs.flatMap((s) => s.tasks))
  const loose = live(channel)
    .filter((x) => !held.has(x.id) && x.status !== "done")
    .map((x) => taskRow(channel, x, steps(x)))
  const open = specs.filter((s) => !s.result).map(row)
  const done = specs.filter((s) => s.result).map((s) => specRow(channel, s, s.result?.verdict ?? s.stage))
  return join([
    `# ${t("shell.channel.specs")}`,
    m.act(t("specs.view.new"), hooks.newSpec),
    section(t("panes.page.open"), open),
    section(t("panes.page.tasks"), loose),
    section(t("panes.page.done"), done),
    open.length + loose.length + done.length ? "" : t("panes.page.empty"),
  ])
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
      a.summary ?? "",
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
      wordsRaw(a.text),
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

function needsPage(channel: Channel, actions: Actions, m: Maker): string {
  const asks = openAsks(channel).map((a) => askCard(channel, a, actions, m))
  return join([`# ${t("shell.channel.needs.you")}`, ...asks, asks.length ? "" : t("panes.page.empty")])
}

function build(channel: Channel, key: string, actions: Actions, hooks: Hooks): { md: string; acts: Map<string, () => void> } {
  const m = maker()
  const [kind, id] = key.split(":")
  const md =
    kind === "now"
      ? nowPage(channel)
      : kind === "spec"
        ? specPage(channel, Number(id), actions, m, hooks)
        : kind === "specs"
          ? specsPage(channel, m, hooks)
          : kind === "agents"
            ? agentsPage(channel)
            : kind === "github"
              ? githubPage(channel)
              : needsPage(channel, actions, m)
  return { md, acts: m.acts }
}

export function PageText({ channel, md, acts }: { channel: Channel; md: string; acts: ReadonlyMap<string, () => void> }) {
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const { go } = useAct()
  const pane = usePane()
  const text = useMemo(() => wrote(md), [md])
  const draw = useMemo(() => pieces(lookupOf(channel)), [channel])
  const code = channel.code
  const onPage = (url: string) => {
    if (url.startsWith("kiwi-do:")) return acts.get(url.slice("kiwi-do:".length))?.()
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
  if (!isDetail(view)) return <Board channel={channel} view={view} />
  return (
    <Suspense fallback={null}>
      <Detail key={viewKey(view)} channel={channel} view={view} />
    </Suspense>
  )
}

function Board({ channel, view }: { channel: Channel; view: BoardView }) {
  const { actions } = useAct()
  const key = viewKey(view)
  const [making, setMaking] = useState(false)
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null)
  const hooks = useMemo(
    (): Hooks => ({
      newSpec: () => setMaking(true),
      edit: (text) => setDraft({ key, text }),
    }),
    [key]
  )
  const built = useMemo(() => build(channel, key, actions, hooks), [channel, key, actions, hooks])
  const editing = draft?.key === key ? draft : null
  const save = () => {
    if (view.kind === "spec" && editing?.text.trim()) actions.writeSpec(channel.code, view.ask, editing.text)
    setDraft(null)
  }
  return (
    <PageFrame
      kind={view.kind}
      more={
        making && (
          <Suspense fallback={null}>
            <NewSpec channel={channel} onClose={() => setMaking(false)} />
          </Suspense>
        )
      }
    >
      {editing ? (
        <>
          <textarea className="page-edit" value={editing.text} onChange={(e) => setDraft({ key, text: e.target.value })} autoFocus spellCheck={false} />
          <div className="page-edit-acts">
            <button type="button" className="btn is-primary" onClick={save}>
              {t("panes.page.save")}
            </button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              {t("panes.page.cancel")}
            </button>
          </div>
        </>
      ) : (
        <PageText channel={channel} md={built.md} acts={built.acts} />
      )}
    </PageFrame>
  )
}
