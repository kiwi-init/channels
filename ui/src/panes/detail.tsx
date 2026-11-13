import "~/i18n/en/shell-later"
import "~/i18n/en/github-later"
import "~/i18n/en/needs"
import { useMemo, useState, type Dispatch, type SetStateAction } from "react"

import { ANYONE } from "@kiwi/channel/task-actions.ts"
import { reasonText } from "@kiwi/core/routing-text.ts"
import { named } from "~/chat/linked"
import { preview } from "~/chat/preview"
import { checksLine, issueWord, PR_WORDS } from "~/github/parts"
import { t } from "~/i18n/i18n"
import { statusWord } from "~/kit/bits"
import { Confirm } from "~/kit/confirm"
import { Modal } from "~/kit/modal"
import { openOutside } from "~/kit/outside"
import { ageOf, ago } from "~/kit/time"
import { copyText } from "~/kit/toasts"
import { reasonWords } from "~/live/reason-words"
import { memberOf, type Actions, type Channel, type Check, type Issue, type Task, type TaskEvent } from "~/model"
import { nickname } from "~/names"
import { useAct, type Go } from "~/nav"
import { Assign, Cancel, EditTask, holds, PickReviewer, stepState } from "~/panels/task"
import { detailParts } from "~/panels/task-detail"
import { moveWords } from "~/panels/task-moves"
import { doUrl } from "~/panes/engine"
import { askCard, card, join, link, main, maker, PageFrame, PageText, prRow, section, steps, taskRow, type Maker } from "~/panes/page"
import type { DetailView } from "~/panes/view"
import { SENT } from "~/sent"
import { moverWords, quietWords, useTaskNow } from "~/tasks/mover"
import { SendBack } from "~/tasks/send-back"
import { wordsPlain, wordsRaw } from "~/words"

type Dialog = "assign" | "reviewer" | "edit" | "cancel" | "delete" | "send-back"

interface Ui {
  all: boolean
  full: ReadonlySet<string>
  checks: boolean
}

interface Ctx {
  actions: Actions
  go: (go: Go) => void
  toast: (text: string) => void
  now: number
  ui: Ui
  setUi: Dispatch<SetStateAction<Ui>>
  open: (dialog: Dialog) => void
}

const FRESH: Ui = { all: false, full: new Set(), checks: false }
const SHOWN = 6
const LONG = 280
const FOLD = 8

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const mention = (channel: Channel, name: string): string => link(nickname(channel, name), `kiwi-mention:${encodeURIComponent(name)}`)
const prop = (label: string, ...value: string[]): string => `- **${label}** · ${value.filter(Boolean).join(" · ")}`
const toned = (s: string, tone: string): string => (s && tone ? link(s, doUrl("", { tone: tone.replace(/^tone-/, "") })) : s)
const CHECK_TONES: Partial<Record<Check["state"], string>> = { fail: "alert", running: "doing" }
const mono = (s: string): string => `\`${s.replaceAll("`", "'")}\``
const loose = (s: string): string =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[#>+*-]|\d+[.)])/, "\\$&")
const same = (a: { repo: string; number: number }, repo: string, number: number): boolean => a.number === number && a.repo.toLowerCase() === repo.toLowerCase()
const flip = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
  const next = new Set(set)
  if (!next.delete(key)) next.add(key)
  return next
}

function since(at: number, now: string, recent: (time: string) => string): string {
  const age = ageOf(at)
  return age === "now" ? now : age === "recent" ? recent(ago(at)) : ago(at)
}

const taskSince = (at: number): string => since(at, t("panels.task.just.now"), (time) => t("panels.task.ago", { time }))
const ghSince = (at: number): string => since(at, t("github.panel.just.now"), (time) => t("github.panel.ago", { time }))

const issueRow = (issue: Issue): string => `- ${link(`#${issue.number} ${issue.title}`, `kiwi-issue:${issue.repo}/${issue.number}`)} · ${issueWord(issue)}`

function review(channel: Channel, task: Task, m: Maker, x: Ctx): string {
  const last = task.rounds.at(-1)
  const yours = task.youReview !== undefined
  const brief = last?.result === "open" ? last.summary : undefined
  if (!yours && !brief) return ""
  const owner = task.owner ? nickname(channel, task.owner) : null
  const ask =
    task.youReview === "send-back"
      ? task.reviewer && task.reviewer !== ANYONE
        ? t("panels.task.review.send.back.named", { name: nickname(channel, task.reviewer) })
        : t("panels.task.review.send.back")
      : task.reviewer === channel.you
        ? owner
          ? t("panels.task.review.asks", { owner })
          : t("panels.task.review.yours")
        : task.reviewer === ANYONE
          ? t("panels.task.review.unworked")
          : t("panels.task.review.waits")
  const approve = () => {
    x.actions.approveTask(channel.code, task.id, true)
    x.toast(t("panels.task.approved", { task: String(task.id) }))
  }
  return card([
    `### ${t("panels.task.review.label")}`,
    yours ? ask : "",
    brief && last ? `**${t("panels.task.round.short", { n: last.n })}** ${wordsPlain(brief, channel.nicknames)}` : "",
    yours ? [task.youReview === "verdict" ? main(m.act(t("panels.task.approve"), approve)) : "", m.act(t("panels.task.send.back"), () => x.open("send-back"))].filter(Boolean).join(" ") : "",
  ])
}

function activity(channel: Channel, history: readonly TaskEvent[], m: Maker, x: Ctx): string {
  if (!history.length) return ""
  const shown = x.ui.all ? history : history.slice(-SHOWN)
  const hidden = history.length - shown.length
  const line = (e: TaskEvent): string => {
    const key = `${e.seq}-${e.what}`
    const who = e.by === channel.you ? t("panels.task.move.you") : nickname(channel, e.by)
    const what = moveWords(channel, e)
    const root = e.what === "mention" ? e.root : undefined
    const said =
      root === undefined
        ? what
        : m.act(what, () => x.go((channel.specs ?? []).some((s) => s.ask === root) ? { to: "spec", ask: root, part: "spec" } : { to: "panel", panel: { kind: "thread", seq: root } }))
    const note = e.note ? loose(named(e.what === "mention" ? preview(wordsRaw(e.note)) : wordsRaw(e.note), channel.nicknames)) : ""
    const long = note.length > LONG
    const full = x.ui.full.has(key)
    const toggle = long ? ` ${m.act(full ? t("panels.task.show.less") : t("panels.task.show.all"), () => x.setUi((u) => ({ ...u, full: flip(u.full, key) })))}` : ""
    const quote = note ? `\n  > ${long && !full ? `${note.slice(0, LONG).trimEnd()}…` : note}${toggle}` : ""
    return `- ${t("panels.task.move.line", { who: `**${who}**`, what: said })} · ${ago(e.at)}${quote}`
  }
  return join([`## ${t("panels.task.activity")}`, hidden ? m.act(t("panels.task.show.earlier", { count: hidden }), () => x.setUi((u) => ({ ...u, all: true }))) : "", shown.map(line).join("\n")])
}

function taskPage(channel: Channel, id: number, m: Maker, x: Ctx): string {
  const crumb = `[${t("panes.now")}](kiwi-page:now)`
  const task = channel.tasks.find((k) => k.id === id)
  if (!task) return join([crumb, `# T${id}`, t("panels.task.gone")])
  const code = channel.code
  const { actions } = x
  const may = !memberOf(channel, channel.you)?.readOnly
  const open = may && task.status !== "done"
  const parts = detailParts(wordsRaw(task.title), task.detail ? wordsRaw(task.detail) : undefined)
  const facts = [`T${task.id}`, statusWord(task), task.archived ? t("panes.page.archived") : "", taskSince(task.updatedAt)]
  const status =
    task.status === "done" ? m.act(t("panels.task.reopen"), () => actions.setTaskStatus(code, id, "todo")) : m.act(t("panels.task.mark.done"), () => actions.setTaskStatus(code, id, "done"))
  const acts = [
    may ? main(status) : "",
    m.act(t("panels.task.conversation"), () => x.go({ to: "where", where: { kind: "task", task: id } })),
    may ? m.act(t("panels.task.menu.edit"), () => x.open("edit")) : "",
    open ? m.act(t("panels.task.menu.cancel"), () => x.open("cancel")) : "",
    may ? m.act(t("panels.task.menu.delete"), () => x.open("delete")) : "",
  ]
  const move = moverWords(channel, task, x.now)
  const reviewer = task.reviewer
  const props = [
    prop(
      t("panels.task.owner"),
      task.owner ? mention(channel, task.owner) : t("panels.task.nobody.yet"),
      open ? m.act(task.owner ? t("panels.task.reassign") : t("panels.task.assign"), () => x.open("assign")) : ""
    ),
    reviewer
      ? prop(t("panels.task.reviewer"), reviewer === ANYONE ? t("panels.task.anyone.unworked") : mention(channel, reviewer), open ? m.act(t("panels.task.change"), () => x.open("reviewer")) : "")
      : open
        ? prop(
            t("panels.task.reviewer"),
            m.act(t("panels.task.ask.review"), () => x.open("reviewer"))
          )
        : "",
    move ? prop(t("panels.task.move"), move, toned(quietWords(channel, task, x.now) ?? "", "alert")) : "",
    task.closedWith ? prop(t("panels.task.closed"), t("panels.task.closed.without", { why: wordsPlain(task.closedWith, channel.nicknames) })) : "",
    prop(t("panels.task.asked.by"), mention(channel, task.createdBy)),
  ]
  const suggested = may && !task.owner ? task.suggested : undefined
  const suggest = suggested
    ? card([
        `### ${t("panels.task.suggested")}`,
        `- ${mention(channel, suggested.name)} · ${reasonWords(suggested.reason)}`,
        m.act(t("panels.task.assign"), () => {
          actions.assignTask(code, id, suggested.name, suggested.reason ? reasonText(suggested.reason) : SENT.hasContext)
          x.toast(t("panels.task.yours.now", { task: String(id), name: nickname(channel, suggested.name) }))
        }),
      ])
    : ""
  const issue = channel.issues?.find((i) => i.task === id)
  const links = [task.pr ? prRow(task.pr) : "", issue ? issueRow(issue) : ""].filter(Boolean).join("\n")
  const landing = (task.steps ?? []).map((s) => {
    const meta = [s.by ? nickname(channel, s.by) : "", stepState(s, x.now) ?? ""].filter(Boolean).join(" · ")
    const wait = s.wait ? `: ${wordsPlain(s.wait.reason, channel.nicknames)}` : ""
    const end = s.yours ? ` · ${m.act(t("panels.task.step.end"), () => actions.endStep(code, id, s.id))}` : ""
    return `- [${s.state === "done" ? "x" : " "}] ${wordsRaw(s.words)}${meta ? ` · ${meta}${wait}` : ""}${end}`
  })
  const notes = task.notes.map((n) => `**@${n.by}** ${wordsRaw(n.text)}`)
  return join([
    crumb,
    `# ${parts.title}`,
    facts.filter(Boolean).join(" · "),
    acts.filter(Boolean).join(" "),
    parts.body,
    ...channel.asks.filter((a) => holds(a, id)).map((a) => askCard(channel, a, actions, m)),
    review(channel, task, m, x),
    props.filter(Boolean).join("\n"),
    suggest,
    links,
    section(t("panels.task.steps"), landing),
    section(t("panes.page.notes"), notes, "\n\n"),
    activity(channel, task.history, m, x),
  ])
}

function taskSection(channel: Channel, id: number | undefined, m: Maker, x: Ctx): string {
  const task = id === undefined ? undefined : channel.tasks.find((k) => k.id === id)
  const body = task
    ? taskRow(channel, task, steps(task))
    : id !== undefined
      ? `T${id}`
      : `${t("github.panel.none.yet")} ${m.act(t("github.panel.ask.for.one"), () => x.go({ to: "tab", tab: "chat" }))}`
  return join([`## ${t("github.panel.task")}`, body])
}

function checks(list: readonly Check[], m: Maker, x: Ctx): string {
  if (!list.length) return ""
  const fold = list.length > FOLD
  const quiet = list.filter((c) => c.state === "pass" || c.state === "skipped")
  const loud = list.filter((c) => c.state !== "pass" && c.state !== "skipped")
  const passed = quiet.filter((c) => c.state === "pass").length
  const skipped = quiet.length - passed
  const summary = [
    passed ? (loud.length ? t("github.parts.passed", { count: passed }) : t("github.parts.all.passed", { count: passed })) : "",
    skipped ? t("github.parts.skipped", { count: skipped }) : "",
  ]
    .filter(Boolean)
    .join(" · ")
  const row = (c: Check): string =>
    `- ${mono(`check:${c.state}`)} ${c.url ? link(c.name, c.url) : mono(c.name)} · ${toned(c.word, CHECK_TONES[c.state] ?? "")}${c.required ? ` · ${t("github.parts.required")}` : ""}`
  const toggle = fold && quiet.length ? m.act(`${summary} · ${t(x.ui.checks ? "github.parts.hide" : "github.parts.show")}`, () => x.setUi((u) => ({ ...u, checks: !u.checks }))) : ""
  return join([`## ${t("github.panel.checks")}`, [...loud, ...(!fold || x.ui.checks ? quiet : [])].map(row).join("\n"), toggle])
}

function prPage(channel: Channel, repo: string, number: number, m: Maker, x: Ctx): string {
  const crumb = `[${t("shell.channel.github")}](kiwi-page:github)`
  const pr = channel.prs?.find((p) => same(p, repo, number))
  if (!pr) return join([crumb, `# ${t("github.panel.pr.title", { number: String(number) })}`, t("github.panel.pr.gone")])
  const line = checksLine(pr)
  const closed = pr.state === "merged" || pr.state === "closed"
  const branch = pr.branch
  const facts = [link(`#${pr.number}`, pr.url), t(PR_WORDS[pr.state]), line && !closed ? toned(line.text, line.tone) : "", pr.release ? t("github.panel.shipped.in", { release: pr.release }) : ""]
  const acts = [
    main(m.act(t("github.panel.open.on.github"), () => openOutside(pr.url))),
    m.act(t("github.panel.files.changed"), () => openOutside(`${pr.url}/files`)),
    closed ? "" : m.act(t("github.panel.checks"), () => openOutside(`${pr.url}/checks`)),
  ]
  const props = [
    prop(t("github.panel.repo"), mono(pr.repo)),
    branch
      ? prop(
          t("github.panel.branch"),
          mono(branch),
          m.act(t("github.parts.copy.branch"), () => void copyText(branch, t("github.parts.branch.copied")))
        )
      : "",
    pr.by ? prop(t("github.panel.author"), pr.by) : "",
    pr.additions !== undefined && pr.deletions !== undefined
      ? prop(t("github.panel.size"), `+${pr.additions} −${pr.deletions}`, pr.files !== undefined ? t("github.parts.files", { count: String(pr.files) }) : "")
      : "",
    pr.at !== undefined ? prop(t(pr.state === "merged" ? "github.panel.merged" : pr.state === "closed" ? "github.panel.closed" : "github.panel.updated"), ghSince(pr.at)) : "",
  ]
  return join([
    crumb,
    `# ${pr.title}`,
    facts.filter(Boolean).join(" · "),
    acts.filter(Boolean).join(" "),
    props.filter(Boolean).join("\n"),
    checks(pr.list ?? [], m, x),
    taskSection(channel, pr.task, m, x),
  ])
}

function issuePage(channel: Channel, repo: string, number: number, m: Maker, x: Ctx): string {
  const crumb = `[${t("shell.channel.github")}](kiwi-page:github)`
  const issue = channel.issues?.find((i) => same(i, repo, number))
  if (!issue) return join([crumb, `# ${t("github.panel.issue.title", { number: String(number) })}`, t("github.panel.issue.gone")])
  const open = issue.state === "open"
  const props = [
    prop(t("github.panel.repo"), mono(issue.repo)),
    issue.by ? prop(t(open ? "github.panel.opened.by" : "github.panel.closed.by"), issue.by) : "",
    prop(t(open ? "github.panel.updated" : "github.panel.closed"), ghSince(issue.at)),
  ]
  return join([
    crumb,
    `# ${issue.title}`,
    [link(`#${issue.number}`, issue.url), cap(issueWord(issue))].join(" · "),
    main(m.act(t("github.panel.open.on.github"), () => openOutside(issue.url))),
    props.filter(Boolean).join("\n"),
    taskSection(channel, issue.task, m, x),
  ])
}

export function Detail({ channel, view }: { channel: Channel; view: DetailView }) {
  const { actions, go, toast } = useAct()
  const now = useTaskNow()
  const [ui, setUi] = useState<Ui>(FRESH)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const x = useMemo((): Ctx => ({ actions, go, toast, now, ui, setUi, open: setDialog }), [actions, go, toast, now, ui])
  const kind = view.kind
  const id = view.kind === "task" ? view.task : 0
  const repo = view.kind === "task" ? "" : view.repo
  const number = view.kind === "task" ? 0 : view.number
  const built = useMemo(() => {
    const m = maker()
    const md = kind === "task" ? taskPage(channel, id, m, x) : kind === "pr" ? prPage(channel, repo, number, m, x) : issuePage(channel, repo, number, m, x)
    return { md, acts: m.acts }
  }, [channel, kind, id, repo, number, x])
  const task = kind === "task" ? channel.tasks.find((k) => k.id === id) : undefined
  const close = () => setDialog(null)
  const sendBack = (why: string) => {
    if (!task) return
    actions.approveTask(channel.code, task.id, false, why)
    close()
    toast(task.owner ? t("panels.task.sent.back.to", { task: String(task.id), name: nickname(channel, task.owner) }) : t("panels.task.sent.back", { task: String(task.id) }))
  }
  const more = task && (
    <>
      <Assign channel={channel} task={task} open={dialog === "assign"} onClose={close} />
      <PickReviewer channel={channel} task={task} open={dialog === "reviewer"} onClose={close} />
      <EditTask channel={channel} task={task} open={dialog === "edit"} onClose={close} />
      <Cancel channel={channel} task={task} open={dialog === "cancel"} onClose={close} />
      <Confirm
        open={dialog === "delete"}
        title={t("panels.task.delete.title", { task: String(task.id) })}
        sub={t("panels.task.delete.sub")}
        action={t("panels.task.delete.yes")}
        onConfirm={() => {
          actions.deleteTask(channel.code, task.id)
          close()
        }}
        onClose={close}
      />
      <Modal open={dialog === "send-back"} onClose={close} label={t("panels.task.send.back")} title={t("panels.task.send.back")}>
        {dialog === "send-back" && <SendBack onSend={sendBack} onCancel={close} />}
      </Modal>
    </>
  )
  return (
    <PageFrame kind={kind} more={more}>
      <PageText channel={channel} md={built.md} acts={built.acts} />
    </PageFrame>
  )
}
