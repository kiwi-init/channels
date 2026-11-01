import "~/styles/tasks.css"
import "~/styles/github.css"

import type { ReactNode } from "react"

import { checksSummary } from "~/github/groups"
import { Branch, Checks, checksLine, IssueMark, issueTone, issueWord, PR_TONES, PR_WORDS, PrMark, Size, TaskLink, Ticks } from "~/github/parts"
import { cx, Empty, Heading } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Channel } from "~/model"
import { useApp } from "~/nav"
import { PanelHead } from "~/panels/frame"

const same = (a: { repo: string; number: number }, repo: string, number: number): boolean => a.number === number && a.repo.toLowerCase() === repo.toLowerCase()

const since = (at: number): string => {
  const a = ago(at)
  return a === "now" ? "just now" : /^\d+[mhd]$/.test(a) ? `${a} ago` : a
}

function Out({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <a className={cx("btn is-small", primary && "is-primary")} href={href} target="_blank" rel="noreferrer noopener">
      {children}
      {primary && <Icon name="external" size={12} />}
    </a>
  )
}

function Unknown({ title, what }: { title: string; what: string }) {
  return (
    <>
      <PanelHead title={title} />
      <Empty title={`This ${what} isn't here any more.`}>It may have been closed long ago, or its repo unlinked.</Empty>
    </>
  )
}

function TaskSection({ channel, id, what }: { channel: Channel; id: number | undefined; what: string }) {
  const { go } = useApp()
  return (
    <section className="panel-section">
      <Heading>Task</Heading>
      {id !== undefined ? (
        <TaskLink channel={channel} id={id} />
      ) : (
        <p className="gh-none">
          No task holds this {what} yet. Say what you want done with it{" "}
          <button type="button" className="gh-inline" onClick={() => go({ to: "tab", tab: "chat" })}>
            in the conversation
          </button>
          , and the lead turns it into a task.
        </p>
      )}
    </section>
  )
}

export function PrPanel({ channel, repo, number }: { channel: Channel; repo: string; number: number }) {
  const pr = channel.prs?.find((p) => same(p, repo, number))
  if (!pr) return <Unknown title={`PR #${number}`} what="pull request" />
  const line = checksLine(pr)
  const closed = pr.state === "merged" || pr.state === "closed"
  return (
    <>
      <PanelHead title={`PR #${pr.number}`} sub={`· ${PR_WORDS[pr.state].toLowerCase()}`} />
      <div className="panel-body">
        <section className="panel-section">
          <h3 className="task-title gh-panel-title">{pr.title}</h3>
          <p className="gh-state">
            <PrMark pr={pr} size={14} />
            <span className={PR_TONES[pr.state]}>{PR_WORDS[pr.state]}</span>
            {line && !closed && <span className={cx("gh-state-ci", line.tone)}>· {line.text}</span>}
            {pr.release && <span className="dim">· shipped in {pr.release}</span>}
          </p>
        </section>
        <section className="panel-section">
          <dl className="props task-props">
            <dt>Repo</dt>
            <dd className="gh-dd-mono">{pr.repo}</dd>
            {pr.branch && (
              <>
                <dt>Branch</dt>
                <dd>
                  <Branch name={pr.branch} copy />
                </dd>
              </>
            )}
            {pr.by && (
              <>
                <dt>Author</dt>
                <dd>{pr.by}</dd>
              </>
            )}
            {pr.additions !== undefined && (
              <>
                <dt>Size</dt>
                <dd>
                  <Size pr={pr} />
                </dd>
              </>
            )}
            {pr.at !== undefined && (
              <>
                <dt>{pr.state === "merged" ? "Merged" : pr.state === "closed" ? "Closed" : "Updated"}</dt>
                <dd>{since(pr.at)}</dd>
              </>
            )}
          </dl>
        </section>
        {pr.list && pr.list.length > 0 && (
          <section className="panel-section">
            <Heading
              action={
                <span className="gh-heading-side">
                  <Ticks list={pr.list} />
                  <span className="num">{checksSummary(pr.list)}</span>
                </span>
              }
            >
              Checks
            </Heading>
            <Checks list={pr.list} fold={pr.list.length > 8} />
          </section>
        )}
        <TaskSection channel={channel} id={pr.task} what="pull request" />
        <section className="panel-section gh-actions">
          <Out href={pr.url} primary>
            Open on GitHub
          </Out>
          <Out href={`${pr.url}/files`}>Files changed</Out>
          {!closed && <Out href={`${pr.url}/checks`}>Checks</Out>}
        </section>
      </div>
    </>
  )
}

export function IssuePanel({ channel, repo, number }: { channel: Channel; repo: string; number: number }) {
  const issue = channel.issues?.find((i) => same(i, repo, number))
  if (!issue) return <Unknown title={`Issue #${number}`} what="issue" />
  return (
    <>
      <PanelHead title={`Issue #${issue.number}`} sub={`· ${issueWord(issue)}`} />
      <div className="panel-body">
        <section className="panel-section">
          <h3 className="task-title gh-panel-title">{issue.title}</h3>
          <p className="gh-state">
            <IssueMark issue={issue} size={14} />
            <span className={issueTone(issue)}>{issueWord(issue).replace(/^./, (c) => c.toUpperCase())}</span>
          </p>
        </section>
        <section className="panel-section">
          <dl className="props task-props">
            <dt>Repo</dt>
            <dd className="gh-dd-mono">{issue.repo}</dd>
            {issue.by && (
              <>
                <dt>{issue.state === "open" ? "Opened by" : "Closed by"}</dt>
                <dd>{issue.by}</dd>
              </>
            )}
            <dt>{issue.state === "open" ? "Updated" : "Closed"}</dt>
            <dd>{since(issue.at)}</dd>
          </dl>
        </section>
        <TaskSection channel={channel} id={issue.task} what="issue" />
        <section className="panel-section gh-actions">
          <Out href={issue.url} primary>
            Open on GitHub
          </Out>
        </section>
      </div>
    </>
  )
}
