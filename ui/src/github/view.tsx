import "~/styles/tasks.css"
import "~/styles/github.css"

import { useState, type ReactNode } from "react"

import { ciOf, isOpen, issueGroups, matches, prGroups, type Group, type GroupKey, type Shown } from "~/github/groups"
import { checksLine, DiffBar, IssueMark, issueWord, PrMark, Ticks } from "~/github/parts"
import { Avatar, Count, cx, Dot, Empty } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Issue, type PullRequest } from "~/model"
import { useApp, type GithubView as Kind } from "~/nav"

const SHOWN = 8

const LOUD: Partial<Record<GroupKey, string>> = { fail: "tone-alert", running: "tone-doing" }

const shortRepo = (repo: string, repos: readonly string[]): string => {
  const name = repo.split("/")[1] ?? repo
  return repos.filter((r) => (r.split("/")[1] ?? r).toLowerCase() === name.toLowerCase()).length > 1 ? repo : name
}

function reposOf(channel: Channel): string[] {
  const seen = new Map<string, string>()
  for (const r of [...channel.repos, ...(channel.prs ?? []).map((p) => p.repo), ...(channel.issues ?? []).map((i) => i.repo)]) if (!seen.has(r.toLowerCase())) seen.set(r.toLowerCase(), r)
  return [...seen.values()]
}

export function GithubView({ channel }: { channel: Channel }) {
  const { nav, go } = useApp()
  const kind: Kind = nav.github ?? "prs"
  const [shown, setShown] = useState<Shown>("open")
  const [repo, setRepo] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const repos = reposOf(channel)
  if (!repos.length) return <NoRepo />
  const inRepo = <T extends { repo: string }>(xs: readonly T[]) => (repo ? xs.filter((x) => x.repo.toLowerCase() === repo.toLowerCase()) : xs)
  const prs = inRepo(channel.prs ?? []).filter((p) => matches(p, query))
  const issues = inRepo(channel.issues ?? []).filter((i) => matches(i, query))
  const items: readonly { state: string }[] = kind === "prs" ? prs : issues
  const open = items.filter(isOpen).length
  const many = repos.length > 1
  return (
    <div className="board">
      <div className="board-list gh-list">
        <div className="gh-top">
          <Track className="seg gh-kind" role="group" aria-label="Pull requests or issues">
            <button type="button" aria-pressed={kind === "prs"} onClick={() => go({ to: "github", view: "prs" })}>
              <Icon name="pr" size={14} />
              Pull requests <Count n={prs.filter(isOpen).length} />
            </button>
            <button type="button" aria-pressed={kind === "issues"} onClick={() => go({ to: "github", view: "issues" })}>
              <Icon name="issue" size={14} />
              Issues <Count n={issues.filter(isOpen).length} />
            </button>
          </Track>
          <label className="gh-find">
            <Icon name="search" size={14} />
            <input
              value={query}
              aria-label={kind === "prs" ? "Filter pull requests" : "Filter issues"}
              placeholder={kind === "prs" ? "Title, #number, author or branch" : "Title, #number or author"}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation()
                  setQuery("")
                }
              }}
            />
            {query && (
              <button type="button" className="gh-find-clear" aria-label="Clear the filter" onClick={() => setQuery("")}>
                <Icon name="close" size={12} />
              </button>
            )}
          </label>
        </div>
        <div className="gh-bar">
          <Track className="seg" role="group" aria-label="Open or closed">
            <button type="button" aria-pressed={shown === "open"} onClick={() => setShown("open")}>
              Open <span className="gh-n num">{open}</span>
            </button>
            <button type="button" aria-pressed={shown === "closed"} onClick={() => setShown("closed")}>
              Closed <span className="gh-n num">{items.length - open}</span>
            </button>
          </Track>
          {many && (
            <Track className="seg gh-repos" role="group" aria-label="Repo">
              <button type="button" aria-pressed={repo === null} onClick={() => setRepo(null)}>
                All repos
              </button>
              {repos.map((r) => (
                <button key={r} type="button" aria-pressed={repo?.toLowerCase() === r.toLowerCase()} title={r} onClick={() => setRepo(r)}>
                  {shortRepo(r, repos)}
                </button>
              ))}
            </Track>
          )}
        </div>
        {kind === "prs" ? (
          <Groups
            groups={prGroups(prs, shown)}
            empty={
              <Nothing
                query={query}
                clear={() => setQuery("")}
                what={shown === "open" ? "open pull requests" : "closed pull requests"}
                hint={shown === "open" ? "A pull request opened in a linked repo shows up here with its checks." : "Merged and closed pull requests stay here for a while."}
                icon="pr"
              />
            }
            row={(pr: PullRequest) => <PrRow key={`${pr.repo}#${pr.number}`} channel={channel} pr={pr} repos={many ? repos : null} />}
          />
        ) : (
          <Groups
            groups={issueGroups(issues, shown)}
            empty={
              <Nothing
                query={query}
                clear={() => setQuery("")}
                what={shown === "open" ? "open issues" : "closed issues"}
                hint={shown === "open" ? "An issue opened in a linked repo shows up here, with the task it became." : "Closed issues stay here for a while."}
                icon="issue"
              />
            }
            row={(i: Issue) => <IssueRow key={`${i.repo}#${i.number}`} channel={channel} issue={i} repos={many ? repos : null} />}
          />
        )}
      </div>
    </div>
  )
}

function Groups<T>({ groups, empty, row }: { groups: Group<T>[]; empty: ReactNode; row: (x: T) => ReactNode }) {
  if (!groups.length) return <>{empty}</>
  return (
    <>
      {groups.map((g) => (
        <GroupCard key={g.key} group={g} row={row} />
      ))}
    </>
  )
}

function GroupCard<T>({ group, row }: { group: Group<T>; row: (x: T) => ReactNode }) {
  const [all, setAll] = useState(false)
  const rows = all ? group.rows : group.rows.slice(0, SHOWN)
  return (
    <section className={cx("board-group gh-group", `is-${group.key}`)} aria-label={group.label}>
      <div className="board-head">
        <h2 className="board-h">
          {LOUD[group.key] && <span className={cx("gh-group-dot", `is-${group.key}`)} aria-hidden="true" />}
          <span className={cx("board-label", LOUD[group.key])}>{group.label}</span>
          <span className="board-n num">{group.rows.length}</span>
        </h2>
        <p className="board-sub">
          <span>{group.sub}</span>
        </p>
      </div>
      <ul className="gh-rows">{rows.map(row)}</ul>
      {group.rows.length > SHOWN && (
        <button type="button" className="board-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${group.rows.length}`}
        </button>
      )}
    </section>
  )
}

function Nothing({ query, clear, what, hint, icon }: { query: string; clear: () => void; what: string; hint: string; icon: "pr" | "issue" }) {
  if (query.trim())
    return (
      <Empty title={`No ${what} match “${query.trim()}”.`} icon="search">
        <button type="button" className="btn is-small" onClick={clear}>
          Clear the filter
        </button>
      </Empty>
    )
  return (
    <Empty title={`No ${what}.`} icon={icon}>
      {hint}
    </Empty>
  )
}

function NoRepo() {
  const { go } = useApp()
  return (
    <div className="board">
      <div className="board-list gh-list">
        <Empty title="No GitHub repo linked yet." icon="github">
          <p>Link a repo in the channel's settings. Its pull requests, their checks and its issues show up here as GitHub reports them, each beside the task it belongs to.</p>
          <button type="button" className="btn is-small gh-empty-btn" onClick={() => go({ to: "panel", panel: { kind: "channel" } })}>
            Open channel settings
          </button>
        </Empty>
      </div>
    </div>
  )
}

function Owner({ channel, id }: { channel: Channel; id: number | undefined }) {
  const task = id !== undefined ? channel.tasks.find((t) => t.id === id) : undefined
  if (!task) return <span className="gh-col-task" />
  return (
    <span className="gh-col-task num" title={`T${task.id} ${task.title}`}>
      <Dot status={task.cancelled ? "todo" : task.status} />T{task.id}
      {task.owner && <Avatar person={memberOf(channel, task.owner)} size="sm" />}
    </span>
  )
}

function Item({ on, url, label, open, issue, children }: { on: boolean; url: string; label: string; open: () => void; issue?: boolean; children: ReactNode }) {
  return (
    <li className={cx("gh-item", on && "is-on")}>
      <button type="button" className={cx("gh-row", issue && "is-issue")} aria-current={on || undefined} onClick={open}>
        {children}
      </button>
      <a className="gh-out" href={url} target="_blank" rel="noreferrer noopener" aria-label={`${label} on GitHub`} title="Open on GitHub">
        <Icon name="external" size={14} />
      </a>
    </li>
  )
}

function ciWord(pr: PullRequest): string {
  const t = pr.ticks
  const ci = ciOf(pr)
  if (ci === "none") return "no checks yet"
  if (t && ci === "fail") return t.failed.length === 1 ? (t.failed[0] ?? "1 failed") : `${t.failed.length} failed`
  if (t && ci === "running") return `${t.passed} of ${t.passed + t.running + t.failed.length}`
  if (t && ci === "ready") return `${t.passed} passed`
  return ci === "fail" ? "failed" : ci === "running" ? "running" : "passed"
}

function PrRow({ channel, pr, repos }: { channel: Channel; pr: PullRequest; repos: string[] | null }) {
  const { nav, go } = useApp()
  const on = nav.panel?.kind === "pr" && nav.panel.repo === pr.repo && nav.panel.number === pr.number
  const line = checksLine(pr)
  const ci = ciOf(pr)
  const closed = pr.state === "merged" || pr.state === "closed"
  return (
    <Item on={on} url={pr.url} label={`PR #${pr.number}`} open={() => go({ to: "panel", panel: on ? null : { kind: "pr", repo: pr.repo, number: pr.number } })}>
      <PrMark pr={pr} />
      <span className="gh-title">{pr.title}</span>
      <span className="gh-meta">
        <span className="num">#{pr.number}</span>
        {repos && <span>{shortRepo(pr.repo, repos)}</span>}
        {pr.by && <span>{pr.by}</span>}
        {closed ? <span>{`${pr.state} ${ago(pr.at ?? 0)}`}</span> : pr.at !== undefined && <span>{ago(pr.at)}</span>}
        {pr.release && <span>shipped in {pr.release}</span>}
        {line && !closed && <span className={cx("gh-meta-ci", line.tone)}>{line.text}</span>}
      </span>
      <span className={cx("gh-col-ci", closed && "is-quiet")}>
        {!closed && pr.list?.length ? <Ticks list={pr.list} /> : null}
        {!closed && (
          <span className={cx("gh-ci-word", line?.tone, ci === "none" && "is-none")} title={pr.ticks?.failed.length ? `Failed: ${pr.ticks.failed.join(", ")}` : undefined}>
            {ciWord(pr)}
          </span>
        )}
      </span>
      <span className="gh-col-size num">
        {pr.additions !== undefined && pr.deletions !== undefined && (
          <>
            <DiffBar additions={pr.additions} deletions={pr.deletions} />
            <span className="tone-live">+{pr.additions}</span>
            <span className="tone-alert">−{pr.deletions}</span>
          </>
        )}
      </span>
      <Owner channel={channel} id={pr.task} />
    </Item>
  )
}

function IssueRow({ channel, issue, repos }: { channel: Channel; issue: Issue; repos: string[] | null }) {
  const { nav, go } = useApp()
  const on = nav.panel?.kind === "issue" && nav.panel.repo === issue.repo && nav.panel.number === issue.number
  return (
    <Item issue on={on} url={issue.url} label={`Issue #${issue.number}`} open={() => go({ to: "panel", panel: on ? null : { kind: "issue", repo: issue.repo, number: issue.number } })}>
      <IssueMark issue={issue} />
      <span className="gh-title">{issue.title}</span>
      <span className="gh-meta">
        <span className="num">#{issue.number}</span>
        {repos && <span>{shortRepo(issue.repo, repos)}</span>}
        {issue.by && <span>{issue.by}</span>}
        <span>{issue.state === "open" ? ago(issue.at) : `${issueWord(issue)} ${ago(issue.at)}`}</span>
      </span>
      <Owner channel={channel} id={issue.task} />
    </Item>
  )
}
