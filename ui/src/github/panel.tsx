import "~/styles/tasks.css"
import "~/styles/github.css"

import { IssueMark, issueWord, PrCard, TaskLink } from "~/github/parts"
import { Empty, Heading } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Channel } from "~/model"
import { PanelHead } from "~/panels/frame"

const same = (a: { repo: string; number: number }, repo: string, number: number): boolean => a.number === number && a.repo.toLowerCase() === repo.toLowerCase()

export function PrPanel({ channel, repo, number }: { channel: Channel; repo: string; number: number }) {
  const pr = channel.prs?.find((p) => same(p, repo, number))
  if (!pr)
    return (
      <>
        <PanelHead title={`PR #${number}`} />
        <Empty title="This pull request isn't here any more." />
      </>
    )
  return (
    <>
      <PanelHead title={`PR #${pr.number}`} sub={`· ${pr.state}`} />
      <div className="panel-body">
        <section className="panel-section">
          <PrCard channel={channel} pr={pr} />
        </section>
        {pr.task !== undefined && (
          <section className="panel-section">
            <Heading>Task</Heading>
            <TaskLink channel={channel} id={pr.task} />
          </section>
        )}
      </div>
    </>
  )
}

export function IssuePanel({ channel, repo, number }: { channel: Channel; repo: string; number: number }) {
  const issue = channel.issues?.find((i) => same(i, repo, number))
  if (!issue)
    return (
      <>
        <PanelHead title={`Issue #${number}`} />
        <Empty title="This issue isn't here any more." />
      </>
    )
  return (
    <>
      <PanelHead title={`Issue #${issue.number}`} sub={`· ${issueWord(issue)}`} />
      <div className="panel-body">
        <section className="panel-section">
          <div className="gh-card">
            <p className="gh-card-title">
              <IssueMark issue={issue} />
              <span>
                <span className="dim num">#{issue.number}</span> {issue.title}
              </span>
            </p>
            <p className="gh-card-meta num">
              <span>{issueWord(issue)}</span>
              {issue.by && <span>{issue.by}</span>}
              <span>{ago(issue.at)}</span>
            </p>
            <p className="gh-card-foot">
              <span className="dimmer">{issue.repo}</span>
              <span className="gh-card-links">
                <a href={issue.url} target="_blank" rel="noreferrer noopener">
                  Open on GitHub
                  <Icon name="external" size={12} />
                </a>
              </span>
            </p>
          </div>
        </section>
        <section className="panel-section">
          <Heading>Task</Heading>
          {issue.task !== undefined ? <TaskLink channel={channel} id={issue.task} /> : <p className="gh-none">No task holds this issue. Ask the lead in the conversation to pick it up.</p>}
        </section>
      </div>
    </>
  )
}
