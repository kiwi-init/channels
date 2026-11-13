import "~/i18n/en/github-later"
import "~/styles/tasks.css"
import "~/styles/github.css"

import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import type { ReactNode } from "react"

import { checksSummary } from "~/github/groups"
import { t } from "~/i18n/i18n"
import { Branch, Checks, checksLine, IssueMark, issueTone, issueWord, PR_TONES, PR_WORDS, PrMark, Size, TaskLink, Ticks } from "~/github/parts"
import { cx, Heading } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { GlyphIcon } from "~/kit/icons"
import { ageOf, ago } from "~/kit/time"
import type { Channel } from "~/model"
import { useGo } from "~/nav"
import { PanelHead } from "~/panels/frame"
import { OutsideLink } from "~/kit/outside"

const same = (a: { repo: string; number: number }, repo: string, number: number): boolean => a.number === number && a.repo.toLowerCase() === repo.toLowerCase()

const since = (at: number): string => {
  const age = ageOf(at)
  return age === "now" ? t("github.panel.just.now") : age === "recent" ? t("github.panel.ago", { time: ago(at) }) : ago(at)
}

function Out({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <OutsideLink className={cx("btn is-small", primary && "is-primary")} href={href}>
      {children}
      {primary && <GlyphIcon glyph={LinkSquare02Icon} size={12} />}
    </OutsideLink>
  )
}

function Unknown({ title, gone }: { title: string; gone: string }) {
  return (
    <>
      <PanelHead title={title} />
      <Empty title={gone} />
    </>
  )
}

function TaskSection({ channel, id }: { channel: Channel; id: number | undefined }) {
  const go = useGo()
  return (
    <section className="panel-section">
      <Heading>{t("github.panel.task")}</Heading>
      {id !== undefined ? (
        <TaskLink channel={channel} id={id} />
      ) : (
        <p className="gh-none">
          {t("github.panel.none.yet")}{" "}
          <button type="button" className="gh-inline" onClick={() => go({ to: "tab", tab: "chat" })}>
            {t("github.panel.ask.for.one")}
          </button>
        </p>
      )}
    </section>
  )
}

export function PrPanel({ channel, repo, number }: { channel: Channel; repo: string; number: number }) {
  const pr = channel.prs?.find((p) => same(p, repo, number))
  if (!pr) return <Unknown title={t("github.panel.pr.title", { number: String(number) })} gone={t("github.panel.pr.gone")} />
  const line = checksLine(pr)
  const closed = pr.state === "merged" || pr.state === "closed"
  return (
    <>
      <PanelHead title={t("github.panel.pr.title", { number: String(pr.number) })} />
      <div className="panel-body">
        <section className="panel-section">
          <h3 className="task-title gh-panel-title">{pr.title}</h3>
          <p className="gh-state">
            <PrMark pr={pr} size={14} />
            <span className={PR_TONES[pr.state]}>{t(PR_WORDS[pr.state])}</span>
            {line && !closed && <span className={cx("gh-state-ci", line.tone)}>· {line.text}</span>}
            {pr.release && <span className="dim">· {t("github.panel.shipped.in", { release: pr.release })}</span>}
          </p>
        </section>
        <section className="panel-section">
          <dl className="props task-props">
            <dt>{t("github.panel.repo")}</dt>
            <dd className="gh-dd-mono">{pr.repo}</dd>
            {pr.branch && (
              <>
                <dt>{t("github.panel.branch")}</dt>
                <dd>
                  <Branch name={pr.branch} copy />
                </dd>
              </>
            )}
            {pr.by && (
              <>
                <dt>{t("github.panel.author")}</dt>
                <dd>{pr.by}</dd>
              </>
            )}
            {pr.additions !== undefined && (
              <>
                <dt>{t("github.panel.size")}</dt>
                <dd>
                  <Size pr={pr} />
                </dd>
              </>
            )}
            {pr.at !== undefined && (
              <>
                <dt>{t(pr.state === "merged" ? "github.panel.merged" : pr.state === "closed" ? "github.panel.closed" : "github.panel.updated")}</dt>
                <dd>{since(pr.at)}</dd>
              </>
            )}
          </dl>
        </section>
        {pr.list && pr.list.length > 0 && (
          <section className="panel-section">
            <Heading
              action={
                pr.list.length > 8 ? (
                  <span className="gh-heading-side">
                    <Ticks list={pr.list} />
                    <span className="num">{checksSummary(pr.list)}</span>
                  </span>
                ) : undefined
              }
            >
              {t("github.panel.checks")}
            </Heading>
            <Checks list={pr.list} fold={pr.list.length > 8} />
          </section>
        )}
        <TaskSection channel={channel} id={pr.task} />
        <section className="panel-section gh-actions">
          <Out href={pr.url} primary>
            {t("github.panel.open.on.github")}
          </Out>
          <Out href={`${pr.url}/files`}>{t("github.panel.files.changed")}</Out>
          {!closed && <Out href={`${pr.url}/checks`}>{t("github.panel.checks")}</Out>}
        </section>
      </div>
    </>
  )
}

export function IssuePanel({ channel, repo, number }: { channel: Channel; repo: string; number: number }) {
  const issue = channel.issues?.find((i) => same(i, repo, number))
  if (!issue) return <Unknown title={t("github.panel.issue.title", { number: String(number) })} gone={t("github.panel.issue.gone")} />
  return (
    <>
      <PanelHead title={t("github.panel.issue.title", { number: String(issue.number) })} />
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
            <dt>{t("github.panel.repo")}</dt>
            <dd className="gh-dd-mono">{issue.repo}</dd>
            {issue.by && (
              <>
                <dt>{t(issue.state === "open" ? "github.panel.opened.by" : "github.panel.closed.by")}</dt>
                <dd>{issue.by}</dd>
              </>
            )}
            <dt>{t(issue.state === "open" ? "github.panel.updated" : "github.panel.closed")}</dt>
            <dd>{since(issue.at)}</dd>
          </dl>
        </section>
        <TaskSection channel={channel} id={issue.task} />
        <section className="panel-section gh-actions">
          <Out href={issue.url} primary>
            {t("github.panel.open.on.github")}
          </Out>
        </section>
      </div>
    </>
  )
}
