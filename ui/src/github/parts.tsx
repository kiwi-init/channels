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

import { cx, Dot } from "~/kit/bits"
import { GlyphIcon, Icon, ISSUE, type Glyph } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Channel, Check, Issue, PullRequest } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"

const PR_GLYPHS: Record<PullRequest["state"], Glyph> = { open: GitPullRequestIcon, draft: GitPullRequestDraftIcon, merged: GitMergeIcon, closed: GitPullRequestClosedIcon }
const PR_TONES: Record<PullRequest["state"], string> = { open: "tone-live", draft: "tone-quiet", merged: "tone-review", closed: "tone-quiet" }

export function PrMark({ pr, size = 16 }: { pr: PullRequest; size?: number }) {
  return (
    <span className={cx("gh-mark", PR_TONES[pr.state])}>
      <GlyphIcon glyph={PR_GLYPHS[pr.state]} size={size} label={pr.state} />
    </span>
  )
}

const issueDone = (i: Issue): boolean => i.state === "closed" && i.reason !== "not_planned"

export const issueWord = (i: Issue): string => (i.state === "open" ? "open" : i.reason === "not_planned" ? "not planned" : "closed")

export function IssueMark({ issue, size = 16 }: { issue: Issue; size?: number }) {
  const glyph = issue.state === "open" ? ISSUE : issueDone(issue) ? CheckmarkCircle02Icon : UnavailableIcon
  return (
    <span className={cx("gh-mark", issue.state === "open" ? "tone-live" : issueDone(issue) ? "tone-review" : "tone-quiet")}>
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
    if (total) return { text: "checks passed", tone: "" }
  }
  if (pr.checks === "fail") return { text: "checks failed", tone: "tone-alert" }
  if (pr.checks === "running") return { text: "checks running", tone: "tone-doing" }
  if (pr.checks === "pass") return { text: "checks passed", tone: "" }
  return null
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

export function Checks({ list }: { list: readonly Check[] }) {
  const [open, setOpen] = useState(false)
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
      {quiet.length > 0 && (
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

export function TaskLink({ channel, id }: { channel: Channel; id: number }) {
  const { go } = useApp()
  const task = channel.tasks.find((t) => t.id === id)
  if (!task) return null
  return (
    <button type="button" className="gh-task" onClick={() => go({ to: "panel", panel: { kind: "task", task: id } })}>
      <Dot status={task.cancelled ? "todo" : task.status} />
      <span className="gh-task-id num">T{id}</span>
      <span className="gh-task-title">{task.title}</span>
      {task.owner && <span className="gh-task-who">{nickname(channel, task.owner)}</span>}
    </button>
  )
}

export function PrCard({ channel, pr, withTask }: { channel: Channel; pr: PullRequest; withTask?: boolean }) {
  const line = checksLine(pr)
  const sized = pr.additions !== undefined && pr.deletions !== undefined
  return (
    <div className="gh-card">
      <p className="gh-card-title">
        <PrMark pr={pr} />
        <span>
          <span className="dim num">#{pr.number}</span> {pr.title}
        </span>
      </p>
      <p className="gh-card-meta num">
        <span className={PR_TONES[pr.state]}>{pr.state}</span>
        {pr.by && <span>{pr.by}</span>}
        {pr.at !== undefined && <span>{ago(pr.at)}</span>}
        {line && !pr.list?.length && pr.state !== "merged" && pr.state !== "closed" && <span className={line.tone}>{line.text}</span>}
      </p>
      {(pr.branch || sized) && (
        <p className="gh-card-row num">
          {pr.branch && (
            <span className="gh-branch" title={pr.branch}>
              <GlyphIcon glyph={GitBranchIcon} size={13} />
              <span>{pr.branch}</span>
            </span>
          )}
          {sized && (
            <span className="gh-size">
              <DiffBar additions={pr.additions ?? 0} deletions={pr.deletions ?? 0} />
              <span className="tone-live">+{pr.additions}</span>
              <span className="tone-alert">−{pr.deletions}</span>
              {pr.files !== undefined && <span className="dim">{pr.files === 1 ? "1 file" : `${pr.files} files`}</span>}
            </span>
          )}
        </p>
      )}
      {pr.list && pr.list.length > 0 && <Checks list={pr.list} />}
      {withTask && pr.task !== undefined && <TaskLink channel={channel} id={pr.task} />}
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
