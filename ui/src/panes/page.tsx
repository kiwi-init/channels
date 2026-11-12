import "~/i18n/en/specs"
import { useMemo } from "react"

import { Body } from "~/chat/body"
import { useNames, useTaskIds } from "~/chat/conversation"
import { STATUS_WORDS } from "~/kit/bits"
import { openMessage } from "~/live/open-message"
import type { Actions, Ask, Channel, Spec, Task, TaskStatus } from "~/model"
import { useAct, type Nav } from "~/nav"
import { openAsks } from "~/needs/open"
import { lanesOf, nowOf } from "~/now"
import { usePane } from "~/panes/scope"
import type { Doc } from "~/panes/store"
import { statusOf } from "~/shell/sidebar"
import { openImage } from "~/specs/comment-item"
import { wordsPlain, wordsRaw, wrote } from "~/words"
import { t } from "~/i18n/i18n"

export type View = Doc | { kind: "specs" } | { kind: "spec"; ask: number } | { kind: "agents" } | { kind: "github" } | { kind: "needs" }

export function viewOf(nav: Nav): View | null {
  if (nav.tab === "chat") return null
  if (nav.tab === "specs") return nav.spec == null ? { kind: "specs" } : { kind: "spec", ask: nav.spec }
  return { kind: nav.tab }
}

const viewKey = (view: View): string => `${view.kind}:${view.kind === "task" ? view.task : view.kind === "spec" ? view.ask : ""}`

interface Maker {
  acts: Map<string, () => void>
  act: (label: string, run: () => void) => string
}

function maker(): Maker {
  const acts = new Map<string, () => void>()
  return {
    acts,
    act(label, run) {
      const key = `a${acts.size}`
      acts.set(key, run)
      return `[${label}](kiwi-do:${key})`
    },
  }
}

const ORDER: readonly TaskStatus[] = ["waiting", "doing", "review", "landing", "todo"]
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const join = (parts: readonly string[]): string => parts.filter(Boolean).join("\n\n")
const section = (title: string, lines: readonly string[], gap = "\n"): string => (lines.length ? `## ${title}\n\n${lines.join(gap)}` : "")
const live = (channel: Channel): Task[] => channel.tasks.filter((x) => !x.archived && !x.cancelled)
const named = (task: Task): string => `T${task.id} ${wordsRaw(task.title)}`
const steps = (task: Task): string => {
  const all = task.steps?.filter((s) => s.state !== "skipped") ?? []
  return all.length ? ` · ${all.filter((s) => s.state === "done").length}/${all.length}` : ""
}
const boxed = (task: Task, more = ""): string => `- [${task.status === "done" ? "x" : " "}] ${named(task)}${more}`
const link = (label: string, url: string): string => `[${label.replace(/[[\]\\]/g, "\\$&")}](<${url}>)`

function nowPage(channel: Channel): string {
  const now = nowOf(channel)
  const open = live(channel).filter((x) => x.status !== "done")
  const working = now.working.length + now.more
  const counts = [working ? t("tasks.now.in.progress.count", { count: working }) : "", now.doneCount ? t("tasks.now.done.today.count", { count: now.doneCount }) : ""].filter(Boolean).join(" · ")
  const groups = ORDER.map((status) =>
    section(
      cap(STATUS_WORDS[status]),
      open
        .filter((x) => x.status === status)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((x) => boxed(x, steps(x)))
    )
  )
  return join([`# ${t("panes.now")}`, counts, now.next ?? "", ...groups, open.length ? "" : t("panes.page.empty")])
}

function taskPage(channel: Channel, id: number): string {
  const task = channel.tasks.find((x) => x.id === id)
  const crumb = `[${t("panes.now")}](kiwi-page:now)`
  if (!task) return join([crumb, `# T${id}`])
  const facts = [`T${task.id}`, STATUS_WORDS[task.status], task.owner ? `@${task.owner}` : "", task.pr ? link(`PR #${task.pr.number}`, task.pr.url) : ""].filter(Boolean)
  const done = (task.steps ?? []).map((s) => `- [${s.state === "done" ? "x" : " "}] ${wordsRaw(s.words)}`)
  const notes = task.notes.map((n) => `**@${n.by}** ${wordsRaw(n.text)}`)
  return join([crumb, `# ${wordsRaw(task.title)}`, facts.join(" · "), task.detail ? wordsRaw(task.detail) : "", section(t("panes.page.steps"), done), section(t("panes.page.notes"), notes, "\n\n")])
}

const tasksOf = (channel: Channel, spec: Spec): Task[] => live(channel).filter((x) => spec.tasks.includes(x.id))

function specPage(channel: Channel, ask: number, actions: Actions, m: Maker): string {
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
  const tasks = tasksOf(channel, spec).map((x) => boxed(x, ` · ${STATUS_WORDS[x.status]}`))
  const comments = spec.comments.flatMap((seq) => channel.messages.filter((x) => x.seq === seq)).map((x) => `**@${x.from}** ${wordsRaw(x.text)}`)
  return join([
    crumb,
    `# ${title}`,
    [`#${spec.ask}`, spec.stage, `v${spec.v}`, `@${spec.by}`].join(" · "),
    judge,
    text,
    section(t("panes.page.tasks"), tasks),
    section(t("panes.page.comments"), comments, "\n\n"),
  ])
}

function specsPage(channel: Channel): string {
  const specs = channel.specs ?? []
  const row = (spec: Spec): string => [`- #${spec.ask} ${wordsRaw(spec.title)} · ${spec.stage}`, ...tasksOf(channel, spec).map((x) => `  ${boxed(x, ` · ${STATUS_WORDS[x.status]}`)}`)].join("\n")
  const held = new Set(specs.flatMap((s) => s.tasks))
  const loose = live(channel)
    .filter((x) => !held.has(x.id) && x.status !== "done")
    .map((x) => boxed(x, ` · ${STATUS_WORDS[x.status]}`))
  const open = specs.filter((s) => !s.result).map(row)
  const done = specs.filter((s) => s.result).map((s) => `- #${s.ask} ${wordsRaw(s.title)}`)
  return join([
    `# ${t("shell.channel.specs")}`,
    section(t("panes.page.open"), open),
    section(t("panes.page.tasks"), loose),
    section(t("panes.page.done"), done),
    open.length + loose.length + done.length ? "" : t("panes.page.empty"),
  ])
}

function agentsPage(channel: Channel): string {
  const lanes = lanesOf(channel).map((lane) =>
    join([
      `## @${lane.person.name}`,
      statusOf(lane.person, channel),
      lane.current.map((x) => boxed(x, steps(x))).join("\n"),
      lane.next.length ? `${t("panes.page.next")}: ${lane.next.map(named).join(", ")}` : "",
      lane.watching.map((pr) => `- ${link(`PR #${pr.number} ${pr.title}`, pr.url)} · ${pr.checks}`).join("\n"),
    ])
  )
  return join([`# ${t("shell.channel.agents")}`, ...lanes, lanes.length ? "" : t("panes.page.empty")])
}

function githubPage(channel: Channel): string {
  const prs = (channel.prs ?? []).filter((p) => p.state === "open" || p.state === "draft").map((p) => `- ${link(`#${p.number} ${p.title}`, p.url)} · ${p.state} · ${p.checks}`)
  const merged = (channel.prs ?? []).filter((p) => p.state === "merged").map((p) => `- ${link(`#${p.number} ${p.title}`, p.url)}`)
  const issues = (channel.issues ?? []).filter((i) => i.state === "open").map((i) => `- ${link(`#${i.number} ${i.title}`, i.url)}${i.task ? ` · T${i.task}` : ""}`)
  return join([
    `# ${t("shell.channel.github")}`,
    section(t("panes.page.prs"), prs),
    section(t("panes.page.issues"), issues),
    section(t("panes.page.done"), merged),
    prs.length + issues.length + merged.length ? "" : t("panes.page.empty"),
  ])
}

function needsPage(channel: Channel, actions: Actions, m: Maker): string {
  const code = channel.code
  const titled = (id: number): string => {
    const task = channel.tasks.find((x) => x.id === id)
    return task ? named(task) : `T${id}`
  }
  const item = (a: Ask): string => {
    if (a.kind === "permission")
      return join([
        `### ${t("panes.page.runs", { name: `@${a.from}`, tool: a.tool })}`,
        `\`${a.title.replaceAll("`", "'")}\``,
        a.summary ?? "",
        [
          a.canAllow ? m.act(t("panes.page.allow"), () => actions.answerPermission(code, a.id, true)) : "",
          a.canDeny ? m.act(t("panes.page.deny"), () => actions.answerPermission(code, a.id, false)) : "",
        ]
          .filter(Boolean)
          .join(" "),
      ])
    if (a.kind === "question")
      return join([
        `### ${t("panes.page.asks", { name: `@${a.from}` })}`,
        wordsRaw(a.text),
        a.options.map((o, i) => `${i + 1}. ${wordsRaw(o)} ${m.act(t("panes.page.choose"), () => actions.answerQuestion(code, a.id, wordsRaw(o)))}`).join("\n"),
      ])
    if (a.kind === "join")
      return join([
        `### ${t("panes.page.joins", { name: a.name })}`,
        `${m.act(t("panes.page.let.in"), () => actions.answerJoin(code, a.id, true))} ${m.act(t("panes.page.decline"), () => actions.answerJoin(code, a.id, false))}`,
      ])
    if (a.kind === "review") return join([`### ${t("panes.page.review", { name: `@${a.from}` })}`, titled(a.task)])
    if (a.kind === "spec") return join([`### ${t("panes.page.spec")}`, `#${a.ask} ${wordsRaw(channel.specs?.find((s) => s.ask === a.ask)?.title ?? wrote(""))}`])
    return join([`### ${t("panes.page.quiet", { name: `@${a.from}` })}`, titled(a.task)])
  }
  const asks = openAsks(channel).map(item)
  return join([`# ${t("shell.channel.needs.you")}`, ...asks, asks.length ? "" : t("panes.page.empty")])
}

function build(channel: Channel, key: string, actions: Actions): { md: string; acts: Map<string, () => void> } {
  const m = maker()
  const [kind, id] = key.split(":")
  const md =
    kind === "now"
      ? nowPage(channel)
      : kind === "task"
        ? taskPage(channel, Number(id))
        : kind === "spec"
          ? specPage(channel, Number(id), actions, m)
          : kind === "specs"
            ? specsPage(channel)
            : kind === "agents"
              ? agentsPage(channel)
              : kind === "github"
                ? githubPage(channel)
                : needsPage(channel, actions, m)
  return { md, acts: m.acts }
}

export function docName(channel: Channel, doc: Doc): string {
  if (doc.kind === "now") return t("panes.now")
  const task = channel.tasks.find((x) => x.id === doc.task)
  return task ? `T${task.id} ${wordsPlain(task.title, channel.nicknames)}` : `T${doc.task}`
}

export function Page({ channel, view }: { channel: Channel; view: View }) {
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const { actions, go } = useAct()
  const pane = usePane()
  const key = viewKey(view)
  const built = useMemo(() => build(channel, key, actions), [channel, key, actions])
  const text = useMemo(() => wrote(built.md), [built.md])
  const code = channel.code
  const onPage = (url: string) => {
    if (url.startsWith("kiwi-do:")) return built.acts.get(url.slice("kiwi-do:".length))?.()
    const to = url.slice("kiwi-page:".length)
    if (to === "now") return pane?.show({ kind: "now" })
    if (to === "specs") return go({ to: "spec", ask: null })
    if (to === "agents" || to === "github" || to === "needs") return go({ to: "tab", tab: to })
  }
  const onMessage = (seq: number) => (channel.specs?.some((s) => s.ask === seq) ? go({ to: "spec", ask: seq, part: "spec" }) : openMessage(code, seq))
  return (
    <div className={`page is-${view.kind}`}>
      <article className="page-text">
        <Body text={text} seq={Number.MAX_SAFE_INTEGER} names={names} tasks={tasks} onImage={openImage} onMessage={onMessage} onPage={onPage} />
      </article>
    </div>
  )
}
