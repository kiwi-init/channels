import "~/i18n/en/github-later"
import "~/styles/tasks.css"
import "~/styles/github.css"

import { useState, type ReactNode } from "react"

import { githubTrouble, type GithubTrouble } from "@kiwi/core/github-health.ts"

import { choreNext, choreTitle, since } from "~/github/health"
import { Details } from "~/kit/failed"
import { ciOf, isOpen, issueGroups, matches, prGroups, type Group, type GroupKey, type Shown } from "~/github/groups"
import { checksLine, DiffBar, IssueMark, PrMark, Ticks } from "~/github/parts"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { Avatar, Count, cx, Dot } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Issue, type PullRequest } from "~/model"
import { type GithubView as Kind, useGo, useNav } from "~/nav"
import { wordsPlain } from "~/words"
import { OutsideLink } from "~/kit/outside"

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
  const nav = useNav()
  const go = useGo()
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
  const trouble = channel.github ? githubTrouble(channel.github, repo ? [repo] : channel.repos, kind) : null
  return (
    <div className="board">
      <div className="board-list gh-list">
        <div className="gh-top">
          <Track className="seg gh-kind" role="group" aria-label={t("github.view.kind.label")}>
            <button type="button" aria-pressed={kind === "prs"} onClick={() => go({ to: "github", view: "prs" })}>
              <Icon name="pr" size={14} />
              {t("github.view.prs")} <Count n={prs.filter(isOpen).length} />
            </button>
            <button type="button" aria-pressed={kind === "issues"} onClick={() => go({ to: "github", view: "issues" })}>
              <Icon name="issue" size={14} />
              {t("github.view.issues")} <Count n={issues.filter(isOpen).length} />
            </button>
          </Track>
          <Track className="seg" role="group" aria-label={t("github.view.shown.label")}>
            <button type="button" aria-pressed={shown === "open"} onClick={() => setShown("open")}>
              {t("github.view.open")} <span className="gh-n num">{open}</span>
            </button>
            <button type="button" aria-pressed={shown === "closed"} onClick={() => setShown("closed")}>
              {t("github.view.closed")} <span className="gh-n num">{items.length - open}</span>
            </button>
          </Track>
          <div className="gh-end">
            {many && (
              <Track className="seg gh-repos" role="group" aria-label={t("github.view.repo.label")}>
                <button type="button" aria-pressed={repo === null} onClick={() => setRepo(null)}>
                  {t("github.view.all.repos")}
                </button>
                {repos.map((r) => (
                  <button key={r} type="button" aria-pressed={repo?.toLowerCase() === r.toLowerCase()} title={r} onClick={() => setRepo(r)}>
                    {shortRepo(r, repos)}
                  </button>
                ))}
              </Track>
            )}
            <label className="gh-find">
              <Icon name="search" size={14} />
              <input
                value={query}
                aria-label={t(kind === "prs" ? "github.view.filter.prs" : "github.view.filter.issues")}
                placeholder={t("github.view.filter")}
                title={t(kind === "prs" ? "github.view.filter.prs.hint" : "github.view.filter.issues.hint")}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.stopPropagation()
                    setQuery("")
                  }
                }}
              />
              {query && (
                <button type="button" className="gh-find-clear" aria-label={t("github.view.clear.filter")} onClick={() => setQuery("")}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </label>
          </div>
        </div>
        {kind === "prs" ? (
          <Groups
            groups={prGroups(prs, shown)}
            empty={<Nothing query={query} clear={() => setQuery("")} shown={shown} icon="pr" trouble={trouble} />}
            row={(pr: PullRequest) => <PrRow key={`${pr.repo}#${pr.number}`} channel={channel} pr={pr} repos={many ? repos : null} />}
          />
        ) : (
          <Groups
            groups={issueGroups(issues, shown)}
            empty={<Nothing query={query} clear={() => setQuery("")} shown={shown} icon="issue" trouble={trouble} />}
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
    <div className="board-stack">
      {groups.map((g) => (
        <GroupCard key={g.key} group={g} row={row} />
      ))}
    </div>
  )
}

function GroupCard<T>({ group, row }: { group: Group<T>; row: (x: T) => ReactNode }) {
  const [all, setAll] = useState(false)
  const rows = all ? group.rows : group.rows.slice(0, SHOWN)
  return (
    <section className={cx("board-group gh-group", `is-${group.key}`)} aria-label={group.label}>
      <div className="board-head">
        <h2 className="board-h">
          <span className={cx("board-label", LOUD[group.key])}>{group.label}</span>
          <span className="board-n num">{group.rows.length}</span>
        </h2>
      </div>
      <ul className="gh-rows">{rows.map(row)}</ul>
      {group.rows.length > SHOWN && (
        <button type="button" className="board-more" onClick={() => setAll(!all)}>
          {all ? t("github.view.show.fewer") : t("github.view.show.more", { count: group.rows.length - SHOWN })}
        </button>
      )}
    </section>
  )
}

const EVENT_NAMES: Partial<Record<string, Key>> = { pull_request: "github.view.event.pull.request", check_run: "github.view.event.check.run", issues: "github.view.event.issues" }

const eventName = (e: string): string => {
  const key = EVENT_NAMES[e]
  return key ? t(key) : e
}

const listed = (xs: readonly string[]): string =>
  xs.length < 2 ? (xs[0] ?? "") : t("github.view.list.last", { first: xs.slice(1, -1).reduce((all, next) => t("github.view.list.next", { first: all, next }), xs[0] ?? ""), last: xs.at(-1) ?? "" })

const NO_MATCH: Record<"pr" | "issue", Record<Shown, Key>> = {
  pr: { open: "github.view.no.match.open.prs", closed: "github.view.no.match.closed.prs" },
  issue: { open: "github.view.no.match.open.issues", closed: "github.view.no.match.closed.issues" },
}

const NONE: Record<"pr" | "issue", Record<Shown, Key>> = {
  pr: { open: "github.view.none.open.prs", closed: "github.view.none.closed.prs" },
  issue: { open: "github.view.none.open.issues", closed: "github.view.none.closed.issues" },
}

function appDocs(): string {
  const lang = document.documentElement.lang.toLowerCase()
  return `https://channels.kiwiinit.com${lang && lang !== "en" ? `/${lang}` : ""}/docs/github-app`
}

function Nothing({ query, clear, shown, icon, trouble }: { query: string; clear: () => void; shown: Shown; icon: "pr" | "issue"; trouble: GithubTrouble | null }) {
  if (query.trim())
    return (
      <Empty title={t(NO_MATCH[icon][shown], { query: query.trim() })} icon="search">
        <button type="button" className="btn is-small" onClick={clear}>
          {t("github.view.clear.filter")}
        </button>
      </Empty>
    )
  if (trouble?.kind === "no-app")
    return (
      <Empty title={t("github.view.no.app")} icon="github">
        <p>{t("github.view.no.app.why")}</p>
        <OutsideLink className="btn is-small gh-empty-btn" href={appDocs()}>
          {t("github.view.no.app.how")}
        </OutsideLink>
      </Empty>
    )
  if (trouble?.kind === "not-installed")
    return (
      <Empty title={t("github.view.not.installed", { owner: trouble.owner })} icon="github">
        <p>{t("github.view.not.installed.why")}</p>
        {trouble.install && (
          <OutsideLink className="btn is-small gh-empty-btn" href={trouble.install}>
            {t("github.view.install", { owner: trouble.owner })}
          </OutsideLink>
        )}
      </Empty>
    )
  if (trouble?.kind === "events")
    return (
      <Empty title={t("github.view.no.events", { events: listed(trouble.missing.map(eventName)) })} icon="github">
        <p>{t("github.view.no.events.fix", { owner: trouble.owner })}</p>
      </Empty>
    )
  if (trouble?.kind === "syncing")
    return (
      <Empty title={t(icon === "pr" ? "github.view.fetching.prs" : "github.view.fetching.issues", { repo: trouble.repo })} icon={icon}>
        <p>{t("github.view.fetching.which")}</p>
      </Empty>
    )
  if (trouble?.kind === "failed")
    return (
      <Empty title={t("github.view.failed", { title: choreTitle(trouble.what, trouble.repo) })} icon="github">
        <p>{choreNext(trouble.message)}</p>
        <Details raw={trouble.message} />
      </Empty>
    )
  return (
    <Empty title={t(NONE[icon][shown])} icon={icon}>
      {trouble?.kind === "quiet" && (trouble.last === null ? t("github.view.quiet.never") : t("github.view.quiet.last", { when: since(trouble.last) }))}
    </Empty>
  )
}

function NoRepo() {
  const go = useGo()
  return (
    <div className="board">
      <div className="board-list gh-list">
        <Empty title={t("github.view.no.repo")} icon="github">
          <button type="button" className="btn is-small gh-empty-btn" onClick={() => go({ to: "modal", modal: { kind: "channel" } })}>
            {t("github.view.open.settings")}
          </button>
        </Empty>
      </div>
    </div>
  )
}

function Owner({ channel, id }: { channel: Channel; id: number | undefined }) {
  const task = id !== undefined ? channel.tasks.find((task) => task.id === id) : undefined
  if (!task) return <span className="gh-col-task" />
  return (
    <span className="gh-col-task num" title={`T${task.id} ${wordsPlain(task.title, channel.nicknames)}`}>
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
      <OutsideLink className="gh-out" href={url} aria-label={label} title={t("github.view.open.on.github")}>
        <Icon name="external" size={14} />
      </OutsideLink>
    </li>
  )
}

function ciWord(pr: PullRequest): string {
  const ticks = pr.ticks
  const ci = ciOf(pr)
  if (ticks && ci === "fail") return ticks.failed.length === 1 ? (ticks.failed[0] ?? t("github.view.ci.count.failed", { count: 1 })) : t("github.view.ci.count.failed", { count: ticks.failed.length })
  if (ticks && ci === "running") return t("github.view.ci.of", { passed: ticks.passed, total: ticks.passed + ticks.running + ticks.failed.length })
  return t(ci === "fail" ? "github.view.ci.failed" : "github.view.ci.running")
}

function PrRow({ channel, pr, repos }: { channel: Channel; pr: PullRequest; repos: string[] | null }) {
  const nav = useNav()
  const go = useGo()
  const on = nav.panel?.kind === "pr" && nav.panel.repo === pr.repo && nav.panel.number === pr.number
  const line = checksLine(pr)
  const ci = ciOf(pr)
  const closed = pr.state === "merged" || pr.state === "closed"
  return (
    <Item
      on={on}
      url={pr.url}
      label={t("github.view.pr.on.github", { number: String(pr.number) })}
      open={() => go({ to: "panel", panel: on ? null : { kind: "pr", repo: pr.repo, number: pr.number } })}
    >
      <PrMark pr={pr} />
      <span className="gh-title">{pr.title}</span>
      <span className="gh-meta">
        <span className="num">#{pr.number}</span>
        {repos && <span>{shortRepo(pr.repo, repos)}</span>}
        {pr.by && <span>{pr.by}</span>}
        {closed ? <span>{t(pr.state === "merged" ? "github.view.merged.ago" : "github.view.closed.ago", { time: ago(pr.at ?? 0) })}</span> : pr.at !== undefined && <span>{ago(pr.at)}</span>}
        {pr.release && <span>{t("github.view.shipped.in", { release: pr.release })}</span>}
        {line && (ci === "fail" || ci === "running") && <span className={cx("gh-meta-ci", line.tone)}>{line.text}</span>}
      </span>
      <span className={cx("gh-col-ci", closed && "is-quiet")}>
        {!closed && pr.list?.length ? <Ticks list={pr.list} /> : null}
        {!closed && (ci === "fail" || ci === "running") && (
          <span className={cx("gh-ci-word", line?.tone)} title={pr.ticks?.failed.length ? t("github.view.failed.checks", { names: pr.ticks.failed.join(", ") }) : undefined}>
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
  const nav = useNav()
  const go = useGo()
  const on = nav.panel?.kind === "issue" && nav.panel.repo === issue.repo && nav.panel.number === issue.number
  return (
    <Item
      issue
      on={on}
      url={issue.url}
      label={t("github.view.issue.on.github", { number: String(issue.number) })}
      open={() => go({ to: "panel", panel: on ? null : { kind: "issue", repo: issue.repo, number: issue.number } })}
    >
      <IssueMark issue={issue} />
      <span className="gh-title">{issue.title}</span>
      <span className="gh-meta">
        <span className="num">#{issue.number}</span>
        {repos && <span>{shortRepo(issue.repo, repos)}</span>}
        {issue.by && <span>{issue.by}</span>}
        <span>{issue.state === "open" ? ago(issue.at) : t(issue.reason === "not_planned" ? "github.view.issue.not.planned.ago" : "github.view.issue.closed.ago", { time: ago(issue.at) })}</span>
      </span>
      <Owner channel={channel} id={issue.task} />
    </Item>
  )
}
