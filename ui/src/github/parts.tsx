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

import { Avatar, cx, Dot } from "~/kit/bits"
import { GlyphIcon, Icon, ISSUE, type Glyph } from "~/kit/icons"
import { announce } from "~/kit/toasts"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Check, type Issue, type PullRequest } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"

const PR_GLYPHS: Record<PullRequest["state"], Glyph> = { open: GitPullRequestIcon, draft: GitPullRequestDraftIcon, merged: GitMergeIcon, closed: GitPullRequestClosedIcon }
export const PR_TONES: Record<PullRequest["state"], string> = { open: "tone-live", draft: "tone-quiet", merged: "tone-review", closed: "tone-quiet" }
export const PR_WORDS: Record<PullRequest["state"], string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" }

export function PrMark({ pr, size = 16 }: { pr: PullRequest; size?: number }) {
  return (
    <span className={cx("gh-mark", PR_TONES[pr.state])}>
      <GlyphIcon glyph={PR_GLYPHS[pr.state]} size={size} label={PR_WORDS[pr.state]} />
    </span>
  )
}

const issueDone = (i: Issue): boolean => i.state === "closed" && i.reason !== "not_planned"

export const issueWord = (i: Issue): string => (i.state === "open" ? "open" : i.reason === "not_planned" ? "not planned" : "closed")

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
  if (pr.state === "merged") return { text: "merged", tone: "" }
  if (pr.state === "closed") return { text: "closed", tone: "" }
  const t = pr.ticks
  if (t) {
    const total = t.passed + t.running + t.failed.length
    if (t.failed.length) return { text: t.failed.length === 1 ? `${t.failed[0]} failed` : `${t.failed.length} checks failed`, tone: "tone-alert" }
    if (t.running) return { text: `${t.passed} of ${total} checks`, tone: "tone-doing" }
    if (total) return { text: total === 1 ? "1 check passed" : `${total} checks passed`, tone: "" }
  }
  if (pr.checks === "fail") return { text: "checks failed", tone: "tone-alert" }
  if (pr.checks === "running") return { text: "checks running", tone: "tone-doing" }
  if (pr.checks === "pass") return { text: "checks passed", tone: "" }
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
        <a className="gh-check-name" href={c.url} target="_blank" rel="noreferrer noopener" title={`${c.name} on GitHub`}>
          {c.name}
        </a>
      ) : (
        <span className="gh-check-name">{c.name}</span>
      )}
      {c.required && <span className="gh-check-req">required</span>}
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
  const summary = [passed ? (loud.length ? `${passed} passed` : `All ${passed} checks passed`) : "", skipped ? `${skipped} skipped` : ""].filter(Boolean).join(" · ")
  return (
    <ul className="gh-checks" aria-label="Checks">
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
            <span className="gh-check-word">{open ? "Hide" : "Show"}</span>
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
    <span className="gh-diff" role="img" aria-label={`${additions} added, ${deletions} removed`}>
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
      {pr.files !== undefined && <span className="dim">{pr.files === 1 ? "1 file" : `${pr.files} files`}</span>}
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
          aria-label={`Copy ${name}`}
          title="Copy the branch name"
          onClick={() =>
            void navigator.clipboard?.writeText(name).then(
              () => announce("Branch name copied"),
              () => announce("Couldn't copy. Select it and copy by hand.")
            )
          }
        >
          <Icon name="copy" size={13} />
        </button>
      )}
    </span>
  )
}

export function TaskLink({ channel, id }: { channel: Channel; id: number }) {
  const { go } = useApp()
  const task = channel.tasks.find((t) => t.id === id)
  if (!task) return null
  return (
    <button type="button" className="gh-task" onClick={() => go({ to: "panel", panel: { kind: "task", task: id } })}>
      <Dot status={task.cancelled ? "todo" : task.status} />
      <span className="gh-task-id num">T{id}</span>
      <span className="gh-task-title">{task.title}</span>
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
  const { go } = useApp()
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
        <span className={PR_TONES[pr.state]}>{PR_WORDS[pr.state].toLowerCase()}</span>
        {pr.release && <span>shipped in {pr.release}</span>}
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
          <a href={`${pr.url}/files`} target="_blank" rel="noreferrer noopener">
            Files
          </a>
          <a href={pr.url} target="_blank" rel="noreferrer noopener">
            Open on GitHub
            <Icon name="external" size={12} />
          </a>
        </span>
      </p>
    </div>
  )
}
