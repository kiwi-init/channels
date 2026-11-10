import "~/i18n/en/github-later"
import "~/styles/github.css"

import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  CircleDashedIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  Loading03Icon,
  MinusSignCircleIcon,
  UnavailableIcon,
} from "@hugeicons/core-free-icons"

import { useState } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { Avatar, cx, Dot } from "~/kit/bits"
import { GlyphIcon, Icon, ISSUE, type Glyph } from "~/kit/icons"
import { copyText } from "~/kit/toasts"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Check, type Issue, type PullRequest } from "~/model"
import { useGo } from "~/nav"
import { nickname, Shown } from "~/names"
import { OutsideLink } from "~/kit/outside"

const PR_GLYPHS: Record<PullRequest["state"], Glyph> = { open: GitPullRequestIcon, draft: GitPullRequestDraftIcon, merged: GitMergeIcon, closed: GitPullRequestClosedIcon }
export const PR_TONES: Record<PullRequest["state"], string> = { open: "tone-live", draft: "tone-quiet", merged: "tone-review", closed: "tone-quiet" }
export const PR_WORDS: Record<PullRequest["state"], Key> = { open: "github.parts.pr.open", draft: "github.parts.pr.draft", merged: "github.parts.pr.merged", closed: "github.parts.pr.closed" }

export function PrMark({ pr, size = 16 }: { pr: PullRequest; size?: number }) {
  return (
    <span className={cx("gh-mark", PR_TONES[pr.state])}>
      <GlyphIcon glyph={PR_GLYPHS[pr.state]} size={size} label={t(PR_WORDS[pr.state])} />
    </span>
  )
}

const issueDone = (i: Issue): boolean => i.state === "closed" && i.reason !== "not_planned"

export const issueWord = (i: Issue): string => t(i.state === "open" ? "github.parts.issue.open" : i.reason === "not_planned" ? "github.parts.issue.not.planned" : "github.parts.issue.closed")

export const issueTone = (i: Issue): string => (i.state === "open" ? "tone-live" : issueDone(i) ? "tone-review" : "tone-quiet")

export function IssueMark({ issue, size = 16 }: { issue: Issue; size?: number }) {
  const glyph = issue.state === "open" ? ISSUE : issueDone(issue) ? CheckmarkCircle02Icon : UnavailableIcon
  return (
    <span className={cx("gh-mark", issueTone(issue))}>
      <GlyphIcon glyph={glyph} size={size} label={issueWord(issue)} />
    </span>
  )
}

const CHECK_GLYPHS: Record<Check["state"], Glyph> = { pass: CheckmarkCircle02Icon, fail: CancelCircleIcon, running: Loading03Icon, waiting: CircleDashedIcon, skipped: MinusSignCircleIcon }
const CHECK_TONES: Record<Check["state"], string> = { pass: "tone-live", fail: "tone-alert", running: "tone-doing", waiting: "tone-quiet", skipped: "tone-quiet" }

export function checksLine(pr: PullRequest): { text: string; tone: string } | null {
  if (pr.state === "merged") return { text: t("github.parts.line.merged"), tone: "" }
  if (pr.state === "closed") return { text: t("github.parts.line.closed"), tone: "" }
  const ticks = pr.ticks
  if (ticks) {
    const total = ticks.passed + ticks.running + ticks.failed.length
    if (ticks.failed.length)
      return {
        text: ticks.failed.length === 1 ? t("github.parts.line.one.failed", { name: ticks.failed[0] ?? "" }) : t("github.parts.line.many.failed", { count: ticks.failed.length }),
        tone: "tone-alert",
      }
    if (ticks.running) return { text: t("github.parts.line.of", { passed: ticks.passed, total }), tone: "tone-doing" }
    if (total) return { text: t("github.parts.line.passed", { count: total }), tone: "" }
  }
  if (pr.checks === "fail") return { text: t("github.parts.line.checks.failed"), tone: "tone-alert" }
  if (pr.checks === "running") return { text: t("github.parts.line.checks.running"), tone: "tone-doing" }
  if (pr.checks === "pass") return { text: t("github.parts.line.checks.passed"), tone: "" }
  return null
}

const MAX_TICKS = 12

export function Ticks({ list }: { list: readonly Check[] }) {
  const shown = list.slice(0, MAX_TICKS)
  return (
    <span className="gh-ticks" aria-hidden="true">
      {shown.map((c) => (
        <span key={c.name} className={cx("gh-tick", `is-${c.state}`)} />
      ))}
    </span>
  )
}

function CheckRow({ c }: { c: Check }) {
  return (
    <li className={cx("gh-check", `is-${c.state}`)}>
      <span className={cx("gh-check-mark", CHECK_TONES[c.state])}>
        <GlyphIcon glyph={CHECK_GLYPHS[c.state]} size={14} />
      </span>
      {c.url ? (
        <OutsideLink className="gh-check-name" href={c.url} title={t("github.parts.check.on.github", { name: c.name })}>
          {c.name}
        </OutsideLink>
      ) : (
        <span className="gh-check-name">{c.name}</span>
      )}
      {c.required && <span className="gh-check-req">{t("github.parts.required")}</span>}
      <span className={cx("gh-check-word", c.state === "fail" && "tone-alert", c.state === "running" && "tone-doing")}>{c.word}</span>
    </li>
  )
}

export function Checks({ list, fold = true }: { list: readonly Check[]; fold?: boolean }) {
  const [open, setOpen] = useState(!fold)
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
  return (
    <ul className="gh-checks" aria-label={t("github.parts.checks")}>
      {loud.map((c) => (
        <CheckRow key={c.name} c={c} />
      ))}
      {fold && quiet.length > 0 && (
        <li>
          <button type="button" className="gh-check is-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className={cx("gh-check-mark", passed ? "tone-live" : "tone-quiet")}>
              <GlyphIcon glyph={passed ? CheckmarkCircle02Icon : MinusSignCircleIcon} size={14} />
            </span>
            <span className="gh-check-name">{summary}</span>
            <span className="gh-check-word">{t(open ? "github.parts.hide" : "github.parts.show")}</span>
          </button>
        </li>
      )}
      {open && quiet.map((c) => <CheckRow key={c.name} c={c} />)}
    </ul>
  )
}

const DIFF_W = 48

export function DiffBar({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null
  const plus = Math.round((DIFF_W * additions) / (additions + deletions))
  return (
    <span className="gh-diff" role="img" aria-label={t("github.parts.diff", { added: String(additions), removed: String(deletions) })}>
      <span className="is-add" style={{ width: plus }} />
      <span className="is-del" style={{ width: DIFF_W - plus }} />
    </span>
  )
}

export function Size({ pr }: { pr: PullRequest }) {
  if (pr.additions === undefined || pr.deletions === undefined) return null
  return (
    <span className="gh-size num">
      <DiffBar additions={pr.additions} deletions={pr.deletions} />
      <span className="tone-live">+{pr.additions}</span>
      <span className="tone-alert">−{pr.deletions}</span>
      {pr.files !== undefined && <span className="dim">{t("github.parts.files", { count: String(pr.files) })}</span>}
    </span>
  )
}

export function Branch({ name, copy }: { name: string; copy?: boolean }) {
  return (
    <span className="gh-branch" title={name}>
      <GlyphIcon glyph={GitBranchIcon} size={13} />
      <span className="gh-branch-name">{name}</span>
      {copy && (
        <button
          type="button"
          className="gh-copy"
          aria-label={t("github.parts.copy.name", { name })}
          title={t("github.parts.copy.branch")}
          onClick={() => copyText(name, t("github.parts.branch.copied"))}
        >
          <Icon name="copy" size={13} />
        </button>
      )}
    </span>
  )
}

export function TaskLink({ channel, id }: { channel: Channel; id: number }) {
  const go = useGo()
  const task = channel.tasks.find((task) => task.id === id)
  if (!task) return null
  return (
    <button type="button" className="gh-task" onClick={() => go({ to: "panel", panel: { kind: "task", task: id } })}>
      <Dot status={task.cancelled ? "todo" : task.status} />
      <span className="gh-task-id num">T{id}</span>
      <span className="gh-task-title">
        <Shown value={task.title} />
      </span>
      {task.owner && (
        <span className="gh-task-who">
          <Avatar person={memberOf(channel, task.owner)} size="sm" />
          {nickname(channel, task.owner)}
        </span>
      )}
    </button>
  )
}

export function PrCard({ pr }: { pr: PullRequest }) {
  const go = useGo()
  const line = checksLine(pr)
  return (
    <div className="gh-card">
      <button type="button" className="gh-card-title" onClick={() => go({ to: "panel", panel: { kind: "pr", repo: pr.repo, number: pr.number } })}>
        <PrMark pr={pr} />
        <span>
          <span className="dim num">#{pr.number}</span> {pr.title}
        </span>
      </button>
      <p className="gh-card-meta num">
        <span className={PR_TONES[pr.state]}>{t(PR_WORDS[pr.state]).toLowerCase()}</span>
        {pr.release && <span>{t("github.parts.shipped.in", { release: pr.release })}</span>}
        {pr.by && <span>{pr.by}</span>}
        {pr.at !== undefined && <span>{ago(pr.at)}</span>}
        {line && !pr.list?.length && pr.state !== "merged" && pr.state !== "closed" && <span className={line.tone}>{line.text}</span>}
      </p>
      {(pr.branch || pr.additions !== undefined) && (
        <p className="gh-card-row">
          {pr.branch && <Branch name={pr.branch} />}
          <Size pr={pr} />
        </p>
      )}
      {pr.list && pr.list.length > 0 && <Checks list={pr.list} />}
      <p className="gh-card-foot">
        <span className="dimmer">{pr.repo}</span>
        <span className="gh-card-links">
          <OutsideLink href={`${pr.url}/files`}>{t("github.parts.files.link")}</OutsideLink>
          <OutsideLink href={pr.url}>
            {t("github.parts.open.on.github")}
            <Icon name="external" size={12} />
          </OutsideLink>
        </span>
      </p>
    </div>
  )
}
