import "~/styles/tasks.css"
import "~/styles/github.css"

import { useState, type ReactNode } from "react"

import { checksLine, DiffBar, IssueMark, issueWord, PrMark } from "~/github/parts"
import { cx, Dot, Empty } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { ago } from "~/kit/time"
import type { Channel, Issue, PullRequest } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"

const SHOWN = 20

type Shown = "open" | "closed"

const shortRepo = (repo: string, repos: readonly string[]): string => {
  const name = repo.split("/")[1] ?? repo
  return repos.filter((r) => (r.split("/")[1] ?? r).toLowerCase() === name.toLowerCase()).length > 1 ? repo : name
}

function reposOf(channel: Channel, items: readonly { repo: string }[]): string[] {
  const seen = new Map<string, string>()
  for (const r of [...channel.repos, ...items.map((i) => i.repo)]) if (!seen.has(r.toLowerCase())) seen.set(r.toLowerCase(), r)
  return [...seen.values()]
}

function Bar({
  shown,
  setShown,
  open,
  closed,
  repos,
  repo,
  setRepo,
}: {
  shown: Shown
  setShown: (s: Shown) => void
  open: number
  closed: number
  repos: string[]
  repo: string | null
  setRepo: (r: string | null) => void
}) {
  return (
    <div className="gh-bar">
      <Track className="seg" role="group" aria-label="Open or closed">
        <button type="button" aria-pressed={shown === "open"} onClick={() => setShown("open")}>
          Open <span className="num">{open}</span>
        </button>
        <button type="button" aria-pressed={shown === "closed"} onClick={() => setShown("closed")}>
          Closed <span className="num">{closed}</span>
        </button>
      </Track>
      {repos.length > 1 && (
        <Track className="seg gh-repos" role="group" aria-label="Repo">
          <button type="button" aria-pressed={repo === null} onClick={() => setRepo(null)}>
            All repos
          </button>
          {repos.map((r) => (
            <button key={r} type="button" aria-pressed={repo === r} title={r} onClick={() => setRepo(r)}>
              {shortRepo(r, repos)}
            </button>
          ))}
        </Track>
      )}
    </div>
  )
}

function useFilter<T extends { repo: string; state: string }>(channel: Channel, items: readonly T[]) {
  const [shown, setShown] = useState<Shown>("open")
  const [repo, setRepo] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const repos = reposOf(channel, items)
  const inRepo = repo ? items.filter((i) => i.repo.toLowerCase() === repo.toLowerCase()) : items
  const isOpen = (i: T) => i.state === "open" || i.state === "draft"
  const open = inRepo.filter(isOpen)
  const closed = inRepo.filter((i) => !isOpen(i))
  const list = shown === "open" ? open : closed
  const pick = (s: Shown) => {
    setShown(s)
    setAll(false)
  }
  return {
    bar: <Bar shown={shown} setShown={pick} open={open.length} closed={closed.length} repos={repos} repo={repo} setRepo={setRepo} />,
    rows: all ? list : list.slice(0, SHOWN),
    more:
      list.length > SHOWN ? (
        <button type="button" className="board-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      ) : null,
    shown,
    repos,
  }
}

function Frame({ bar, children, more }: { bar: ReactNode; children: ReactNode; more: ReactNode }) {
  return (
    <div className="board">
      <div className="board-list gh-list">
        {bar}
        {children}
        {more}
      </div>
    </div>
  )
}

function NoRepo({ what }: { what: string }) {
  const { go } = useApp()
  return (
    <Empty title="No GitHub repo linked." icon="pr">
      <p>Link a repo in the channel's settings, and its {what} show up here as GitHub reports them.</p>
      <button type="button" className="btn is-small" onClick={() => go({ to: "panel", panel: { kind: "channel" } })}>
        Channel settings
      </button>
    </Empty>
  )
}

export function PullRequests({ channel }: { channel: Channel }) {
  const prs = channel.prs ?? []
  const { bar, rows, more, shown, repos } = useFilter(channel, prs)
  const { nav } = useApp()
  if (!channel.repos.length && !prs.length) return <NoRepo what="pull requests" />
  const on = nav.panel?.kind === "pr" ? nav.panel : null
  return (
    <Frame bar={bar} more={more}>
      {rows.length === 0 ? (
        <Empty title={shown === "open" ? "No open pull requests." : "No closed pull requests yet."} icon="pr">
          {shown === "open" ? "A pull request opened in a linked repo shows up here with its checks." : "Merged and closed pull requests stay here for a while."}
        </Empty>
      ) : (
        <ul className="gh-rows" aria-label="Pull requests">
          {rows.map((pr) => (
            <li key={`${pr.repo}#${pr.number}`}>
              <PrRow channel={channel} pr={pr} repos={repos} on={!!on && on.repo === pr.repo && on.number === pr.number} />
            </li>
          ))}
        </ul>
      )}
    </Frame>
  )
}

function PrRow({ channel, pr, repos, on }: { channel: Channel; pr: PullRequest; repos: string[]; on: boolean }) {
  const { go } = useApp()
  const line = checksLine(pr)
  const task = pr.task !== undefined ? channel.tasks.find((t) => t.id === pr.task) : undefined
  return (
    <button
      type="button"
      className={cx("gh-row", on && "is-on", `is-${pr.state}`)}
      aria-current={on || undefined}
      onClick={() => go({ to: "panel", panel: on ? null : { kind: "pr", repo: pr.repo, number: pr.number } })}
    >
      <PrMark pr={pr} />
      <span className="gh-title">{pr.title}</span>
      <span className="gh-meta num">
        #{pr.number}
        {repos.length > 1 && ` · ${shortRepo(pr.repo, repos)}`}
        {pr.by && ` · ${pr.by}`}
        {pr.at !== undefined && ` · ${ago(pr.at)}`}
        {line && <span className={cx("gh-meta-checks", line.tone)}> · {line.text}</span>}
      </span>
      <span className="gh-side num">
        {pr.additions !== undefined && pr.deletions !== undefined && (pr.additions > 0 || pr.deletions > 0) && (
          <span className="gh-size">
            <DiffBar additions={pr.additions} deletions={pr.deletions} />
            <span className="tone-live">+{pr.additions}</span>
          </span>
        )}
        <span className={cx("gh-checks-word", line?.tone)}>{line?.text}</span>
      </span>
      <span className="gh-task-chip num">
        {task && (
          <>
            <Dot status={task.cancelled ? "todo" : task.status} />T{task.id}
          </>
        )}
      </span>
    </button>
  )
}

export function Issues({ channel }: { channel: Channel }) {
  const issues = channel.issues ?? []
  const { bar, rows, more, shown, repos } = useFilter(channel, issues)
  const { nav } = useApp()
  if (!channel.repos.length && !issues.length) return <NoRepo what="issues" />
  const on = nav.panel?.kind === "issue" ? nav.panel : null
  return (
    <Frame bar={bar} more={more}>
      {rows.length === 0 ? (
        <Empty title={shown === "open" ? "No open issues." : "No closed issues yet."} icon="issue">
          {shown === "open" ? "An issue opened in a linked repo shows up here, with the task it became." : "Closed issues stay here for a while."}
        </Empty>
      ) : (
        <ul className="gh-rows" aria-label="Issues">
          {rows.map((i) => (
            <li key={`${i.repo}#${i.number}`}>
              <IssueRow channel={channel} issue={i} repos={repos} on={!!on && on.repo === i.repo && on.number === i.number} />
            </li>
          ))}
        </ul>
      )}
    </Frame>
  )
}

function IssueRow({ channel, issue, repos, on }: { channel: Channel; issue: Issue; repos: string[]; on: boolean }) {
  const { go } = useApp()
  const task = issue.task !== undefined ? channel.tasks.find((t) => t.id === issue.task) : undefined
  return (
    <button
      type="button"
      className={cx("gh-row", on && "is-on", `is-${issue.state}`)}
      aria-current={on || undefined}
      onClick={() => go({ to: "panel", panel: on ? null : { kind: "issue", repo: issue.repo, number: issue.number } })}
    >
      <IssueMark issue={issue} />
      <span className="gh-title">{issue.title}</span>
      <span className="gh-meta num">
        #{issue.number}
        {repos.length > 1 && ` · ${shortRepo(issue.repo, repos)}`}
        {issue.by && ` · ${issue.by}`}
        {issue.state === "open" ? ` · ${ago(issue.at)}` : ` · ${issueWord(issue)} ${ago(issue.at)}`}
      </span>
      <span className="gh-side" />
      <span className="gh-task-chip num">
        {task && (
          <>
            <Dot status={task.cancelled ? "todo" : task.status} />T{task.id}
            {task.owner && <span className="gh-task-who"> · {nickname(channel, task.owner)}</span>}
          </>
        )}
      </span>
    </button>
  )
}
