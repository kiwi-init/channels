import { useLayoutEffect, useMemo, useRef, useState } from "react"

import { CHECKS } from "~/chat/cards"
import { Composer } from "~/chat/composer"
import { compactAt, useNames, useTaskIds } from "~/chat/conversation"
import { MessageRow } from "~/chat/message"
import { Avatar, Dot, Empty, Heading, STATUS_WORDS } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Ask, Channel, PermissionAsk, PullRequest, QuestionAsk, ReviewRound, Task } from "~/model"
import { useApp } from "~/nav"
import { PanelHead } from "~/panels/frame"
import { TONES } from "~/tasks/board"

const ROUND_WORDS: Record<ReviewRound["result"], string> = { open: "reviewing", approved: "approved", rejected: "sent back", withdrawn: "withdrawn" }
const ROUND_TONES: Record<ReviewRound["result"], string> = { open: "tone-review", approved: "tone-live", rejected: "", withdrawn: "" }
const CHECK_TONES: Record<PullRequest["checks"], string> = { pass: "tone-live", fail: "tone-alert", running: "tone-decide", none: "" }
const STATE_TONES: Record<PullRequest["state"], string> = { open: "", draft: "dim", merged: "tone-review", closed: "tone-alert" }

function since(at: number): string {
  const a = ago(at)
  if (a === "now") return "just now"
  return /^\d+[mhd]$/.test(a) ? `${a} ago` : a
}

const holds = (a: Ask, id: number): a is PermissionAsk | QuestionAsk =>
  a.kind === "permission" ? a.task === id && !a.answer : a.kind === "question" ? (a.task === id || a.holds.includes(id)) && !a.answer : false

export function TaskPanel({ channel, id }: { channel: Channel; id: number }) {
  const task = channel.tasks.find((t) => t.id === id)
  const talk = useMemo(() => channel.messages.filter((m) => m.where.kind === "task" && m.where.task === id && m.inThread === undefined), [channel.messages, id])
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const body = useRef<HTMLDivElement>(null)
  const last = talk.at(-1)?.seq
  const seen = useRef({ id, last })
  useLayoutEffect(() => {
    const was = seen.current
    seen.current = { id, last }
    if (was.id === id && was.last !== last) body.current?.scrollTo({ top: body.current.scrollHeight })
  }, [id, last])
  if (!task)
    return (
      <>
        <PanelHead title={`T${id}`} />
        <Empty title="This task is gone." />
      </>
    )
  const waits = channel.asks.filter((a) => holds(a, id))
  return (
    <>
      <PanelHead title={`T${task.id}`} sub={`· ${task.archived ? "archived" : STATUS_WORDS[task.status]}`} />
      <div key={task.id} ref={body} className="panel-body task-body">
        <section className="panel-section">
          <h3 className="task-title">{task.title}</h3>
          {task.detail && <p className="task-detail">{task.detail}</p>}
        </section>
        <section className="panel-section">
          <Props channel={channel} task={task} />
        </section>
        {waits.length > 0 && <Waits waits={waits} />}
        {task.pr && <Pr pr={task.pr} />}
        <Review key={`review-${task.id}`} channel={channel} task={task} />
        {task.notes.length > 0 && (
          <section className="panel-section">
            <Heading>Notes</Heading>
            <ol className="task-notes">
              {task.notes.map((n, i) => (
                <li key={`${n.at}-${i}`}>
                  <p className="task-note-meta">
                    {n.by} · {ago(n.at)}
                  </p>
                  <p className="task-note-text">{n.text}</p>
                </li>
              ))}
            </ol>
          </section>
        )}
        <Footer channel={channel} task={task} />
        <section className="panel-section task-talk">
          <Heading>Conversation</Heading>
          {talk.length === 0 ? (
            <p className="task-quiet">No messages about this task yet.</p>
          ) : (
            talk.map((m, i) => <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(talk, i)} names={names} tasks={tasks} inThread />)
          )}
        </section>
      </div>
      <Composer key={`compose-${task.id}`} channel={channel} where={{ kind: "task", task: task.id }} placeholder={`Message in T${task.id}`} />
    </>
  )
}

function Who({ channel, name }: { channel: Channel; name: string }) {
  const { go } = useApp()
  const person = channel.people.find((p) => p.name === name)
  return (
    <button type="button" className="task-who" onClick={() => go({ to: "panel", panel: { kind: "person", name } })}>
      <Avatar person={person} size="sm" />
      <span className="task-who-name">{name}</span>
      {name === channel.you && <span className="dimmer">you</span>}
    </button>
  )
}

function Props({ channel, task }: { channel: Channel; task: Task }) {
  return (
    <dl className="props task-props">
      <dt>Status</dt>
      <dd>
        <Dot status={task.status} />
        <span className={TONES[task.status]}>{STATUS_WORDS[task.status]}</span>
        {task.archived && <span className="dimmer">· archived</span>}
      </dd>
      <dt>Owner</dt>
      <dd>{task.owner ? <Who channel={channel} name={task.owner} /> : <span className="dimmer">nobody yet</span>}</dd>
      {task.reviewer && (
        <>
          <dt>Reviewer</dt>
          <dd>
            <Who channel={channel} name={task.reviewer} />
          </dd>
        </>
      )}
      <dt>Asked by</dt>
      <dd>
        <Who channel={channel} name={task.createdBy} />
      </dd>
      <dt>Created</dt>
      <dd>{since(task.createdAt)}</dd>
      <dt>Updated</dt>
      <dd>{since(task.updatedAt)}</dd>
    </dl>
  )
}

function Waits({ waits }: { waits: (PermissionAsk | QuestionAsk)[] }) {
  const { go } = useApp()
  return (
    <section className="panel-section">
      <Heading>Waiting on an answer</Heading>
      <div className="task-box is-waiting">
        <ul className="task-waits">
          {waits.map((a) => (
            <li key={a.id}>
              <p className="task-wait-text">{a.kind === "permission" ? a.summary : a.text}</p>
              <p className="task-wait-meta">
                {a.from} · {ago(a.at)}
              </p>
            </li>
          ))}
        </ul>
        <button type="button" className="btn is-small" onClick={() => go({ to: "tab", tab: "needs" })}>
          Answer in Needs you
        </button>
      </div>
    </section>
  )
}

function Pr({ pr }: { pr: PullRequest }) {
  return (
    <section className="panel-section">
      <Heading>Pull request</Heading>
      <div className="task-box task-pr">
        <p className="task-pr-title">
          <Icon name="pr" size={14} />
          <span>
            <span className="dim">#{pr.number}</span> {pr.title}
          </span>
        </p>
        <p className="task-pr-meta">
          {pr.additions !== undefined && (
            <>
              <span className="tone-live num">+{pr.additions}</span> <span className="tone-alert num">−{pr.deletions ?? 0}</span>
              {" · "}
            </>
          )}
          <span className={CHECK_TONES[pr.checks]}>{CHECKS[pr.checks]}</span>
          {" · "}
          <span className={STATE_TONES[pr.state]}>{pr.state}</span>
        </p>
        <p className="task-pr-foot">
          <span className="dimmer">{pr.repo}</span>
          <a href={pr.url} target="_blank" rel="noreferrer noopener" className="task-pr-link">
            Open on GitHub
            <Icon name="external" size={12} />
          </a>
        </p>
      </div>
    </section>
  )
}

function Review({ channel, task }: { channel: Channel; task: Task }) {
  const { app, toast } = useApp()
  const [reason, setReason] = useState<string | null>(null)
  const last = task.rounds.at(-1)
  const yours = task.reviewer === channel.you && last?.result === "open"
  const past = yours ? task.rounds.slice(0, -1) : task.rounds
  if (!yours && past.length === 0) return null
  const sendBack = () => {
    const text = reason?.trim()
    if (!text) return
    app.actions.send(channel.code, { kind: "task", task: task.id }, text)
    app.actions.approveTask(channel.code, task.id, false)
    setReason(null)
    toast(`Sent T${task.id} back${task.owner ? ` to ${task.owner}` : ""}`)
  }
  return (
    <section className="panel-section">
      <Heading>Review</Heading>
      {yours && (
        <div className="task-box is-waiting task-review">
          <p className="task-review-ask">{task.owner ? `${task.owner} asks for your review.` : "This waits for your review."}</p>
          {reason === null ? (
            <div className="actions">
              <button
                type="button"
                className="btn is-primary"
                onClick={() => {
                  app.actions.approveTask(channel.code, task.id, true)
                  toast(`Approved T${task.id}`)
                }}
              >
                Approve
              </button>
              <button type="button" className="btn" onClick={() => setReason("")}>
                Send back
              </button>
            </div>
          ) : (
            <form
              className="task-sendback"
              onSubmit={(e) => {
                e.preventDefault()
                sendBack()
              }}
            >
              <input
                autoFocus
                className="input"
                value={reason}
                aria-label="What needs to change"
                placeholder="What needs to change?"
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => !reason.trim() && setReason(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation()
                    setReason(null)
                  }
                }}
              />
              <button type="submit" className="btn is-primary" disabled={!reason.trim()}>
                Send
              </button>
            </form>
          )}
        </div>
      )}
      {past.length > 0 && (
        <ol className="task-rounds">
          {past.map((r) => (
            <li key={r.n}>
              Round {r.n} · {r.by === channel.you ? "you" : r.by} · <span className={ROUND_TONES[r.result]}>{ROUND_WORDS[r.result]}</span> · {ago(r.at)}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Footer({ channel, task }: { channel: Channel; task: Task }) {
  const { app, go, toast } = useApp()
  return (
    <section className="panel-section task-foot actions">
      {task.status === "done" ? (
        <button type="button" className="btn is-small" onClick={() => app.actions.setTaskStatus(channel.code, task.id, "todo")}>
          Reopen
        </button>
      ) : (
        <button type="button" className="btn is-small" onClick={() => app.actions.setTaskStatus(channel.code, task.id, "done")}>
          Mark done
        </button>
      )}
      {!task.archived && (
        <button
          type="button"
          className="btn is-quiet is-small"
          onClick={() => {
            app.actions.archiveTask(channel.code, task.id)
            go({ to: "panel", panel: null })
            toast(`Archived T${task.id}`)
          }}
        >
          Archive
        </button>
      )}
    </section>
  )
}
