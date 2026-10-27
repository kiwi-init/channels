import "~/styles/needs.css"

import type { ReactNode } from "react"

import { PrChip, QuestionCard, TaskChip } from "~/chat/cards"
import { Avatar, Empty } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Ask, Channel, JoinAsk, Message, PermissionAsk, Person, QuestionAsk, ReviewAsk } from "~/model"
import { useApp } from "~/nav"

const isOpen = (a: Ask): boolean => a.kind === "review" || !a.answer

export const openAsks = (channel: Channel): Ask[] => channel.asks.filter(isOpen)

export function NeedsYou({ channel }: { channel: Channel }) {
  const open = openAsks(channel).sort((a, b) => a.at - b.at)
  const answered = channel.asks.filter((a) => !isOpen(a)).sort((a, b) => answeredAt(b) - answeredAt(a))
  return (
    <div className="needs">
      <div className="needs-list">
        {open.length > 0 ? (
          <>
            <p className="needs-sum">
              {open.length} {open.length === 1 ? "thing waits" : "things wait"} on you <span className="dimmer">· oldest first</span>
            </p>
            <ol className="needs-cards">
              {open.map((a) => (
                <li key={a.id}>
                  <Card channel={channel} ask={a} />
                </li>
              ))}
            </ol>
          </>
        ) : (
          <Empty title="Nothing needs you.">Asks from agents and people who want in show up here.</Empty>
        )}
        {answered.length > 0 && (
          <details className="needs-done">
            <summary>
              <Icon name="chevron" size={12} />
              Answered <span className="num">{answered.length}</span>
            </summary>
            <ul>
              {answered.map((a) => (
                <li key={a.id}>{doneLine(channel, a)}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

function answeredAt(a: Ask): number {
  if (a.kind === "review") return a.at
  return a.answer?.at ?? a.at
}

function byWhom(channel: Channel, by: string): string {
  return by === channel.you ? "" : ` · by ${by}`
}

function doneLine(channel: Channel, a: Ask): string {
  switch (a.kind) {
    case "permission":
      return a.answer ? `${a.answer.allow ? "Allowed" : "Denied"} · ${a.from} · ${a.code} · ${ago(a.answer.at)}${byWhom(channel, a.answer.by)}` : ""
    case "question":
      return a.answer ? `Chose “${a.answer.text}” · ${a.from} · ${ago(a.answer.at)}${byWhom(channel, a.answer.by)}` : ""
    case "join":
      return a.answer ? `${a.answer.letIn ? "Let in" : "Turned away"} · ${a.name}${a.sponsor ? ` · brought by ${a.sponsor}` : ""} · ${ago(a.answer.at)}${byWhom(channel, a.answer.by)}` : ""
    case "review":
      return ""
  }
}

type Face = Pick<Person, "name" | "kind" | "harness" | "presence" | "color">

function Card({ channel, ask }: { channel: Channel; ask: Ask }) {
  const { go } = useApp()
  const source = channel.messages.find((m) => m.ask === ask.id)
  const show = (m: Message) => {
    go({ to: "where", where: m.where })
    if (m.inThread !== undefined) go({ to: "panel", panel: { kind: "thread", seq: m.inThread } })
  }
  const link = source && (
    <button type="button" className="needs-link" onClick={() => show(source)}>
      Show in the conversation
    </button>
  )
  switch (ask.kind) {
    case "permission":
      return <PermissionAskCard channel={channel} ask={ask} link={link} />
    case "question":
      return <QuestionAskCard channel={channel} ask={ask} link={link} />
    case "join":
      return <JoinAskCard channel={channel} ask={ask} link={link} />
    case "review":
      return <ReviewAskCard channel={channel} ask={ask} link={link} />
  }
}

function Shell({
  face,
  name,
  member,
  verb,
  at,
  children,
  actions,
  link,
}: {
  face: Face | undefined
  name: string
  member: boolean
  verb: string
  at: number
  children: ReactNode
  actions?: ReactNode
  link: ReactNode
}) {
  const { go } = useApp()
  return (
    <article className="needs-card is-open" aria-label={`${name} ${verb}`}>
      <header className="needs-head">
        <Avatar person={face} size="sm" />
        {member ? (
          <button type="button" className="needs-name" onClick={() => go({ to: "panel", panel: { kind: "person", name } })}>
            {name}
          </button>
        ) : (
          <span className="needs-name">{name}</span>
        )}
        <span className="needs-verb">{verb}</span>
        <span className="needs-meta">
          {link}
          <time className="needs-time" dateTime={new Date(at).toISOString()}>
            {ago(at)}
          </time>
        </span>
      </header>
      <div className="needs-body">{children}</div>
      {actions && <footer className="needs-foot">{actions}</footer>}
    </article>
  )
}

function Holds({ channel, ids }: { channel: Channel; ids: number[] }) {
  const known = ids.filter((id) => channel.tasks.some((t) => t.id === id))
  if (!known.length) return null
  return (
    <div className="needs-holds">
      {known.map((id) => (
        <TaskChip key={id} channel={channel} id={id} />
      ))}
    </div>
  )
}

const member = (channel: Channel, name: string): Person | undefined => channel.people.find((p) => p.name === name)

function PermissionAskCard({ channel, ask, link }: { channel: Channel; ask: PermissionAsk; link: ReactNode }) {
  const { app } = useApp()
  const who = member(channel, ask.from)
  return (
    <Shell
      face={who}
      name={ask.from}
      member={!!who}
      verb={`asks to use ${ask.tool}`}
      at={ask.at}
      link={link}
      actions={
        <>
          <button type="button" className="btn is-primary" onClick={() => app.actions.answerPermission(channel.code, ask.id, true)}>
            Allow
          </button>
          <button type="button" className="btn" onClick={() => app.actions.answerPermission(channel.code, ask.id, false)}>
            Deny
          </button>
        </>
      }
    >
      <p className="needs-title">{ask.summary}</p>
      <pre className="needs-code">{ask.code}</pre>
      {ask.task !== undefined && <Holds channel={channel} ids={[ask.task]} />}
    </Shell>
  )
}

function QuestionAskCard({ channel, ask, link }: { channel: Channel; ask: QuestionAsk; link: ReactNode }) {
  const who = member(channel, ask.from)
  const holds = [...new Set([...(ask.task !== undefined ? [ask.task] : []), ...ask.holds])]
  return (
    <Shell face={who} name={ask.from} member={!!who} verb="asks you" at={ask.at} link={link}>
      <p className="needs-text">{ask.text}</p>
      <QuestionCard channel={channel} ask={ask} />
      {holds.length > 0 && (
        <>
          <p className="needs-label">{holds.length === 1 ? "This task waits on your answer" : "These tasks wait on your answer"}</p>
          <Holds channel={channel} ids={holds} />
        </>
      )}
    </Shell>
  )
}

function JoinAskCard({ channel, ask, link }: { channel: Channel; ask: JoinAsk; link: ReactNode }) {
  const { app } = useApp()
  const face: Face = { name: ask.name, kind: ask.who, harness: ask.harness, presence: "online" }
  const line = [ask.who === "agent" ? "Agent" : "Person", ask.runs, ask.machine && `on ${ask.machine}`, ask.sponsor && `brought by ${ask.sponsor}`].filter(Boolean).join(" · ")
  return (
    <Shell
      face={face}
      name={ask.name}
      member={false}
      verb="wants in"
      at={ask.at}
      link={link}
      actions={
        <>
          <button type="button" className="btn is-primary" onClick={() => app.actions.answerJoin(channel.code, ask.id, true)}>
            It matches: let {ask.name} in
          </button>
          <button type="button" className="btn is-danger" onClick={() => app.actions.answerJoin(channel.code, ask.id, false)}>
            Turn away
          </button>
        </>
      }
    >
      <p className="needs-line">{line}</p>
      <div className="needs-check">
        <p className="needs-check-q">Does their screen show this code?</p>
        <p className="needs-pin">
          <span className="sr">{ask.code}</span>
          {ask.code.split("").map((d, i) => (
            <span key={i} className="needs-digit" aria-hidden="true">
              {d}
            </span>
          ))}
        </p>
        <p className="needs-check-hint">If it doesn't match, someone else has the link. Turn them away.</p>
      </div>
    </Shell>
  )
}

function ReviewAskCard({ channel, ask, link }: { channel: Channel; ask: ReviewAsk; link: ReactNode }) {
  const { app, go, toast } = useApp()
  const who = member(channel, ask.from)
  const task = channel.tasks.find((t) => t.id === ask.task)
  const note = task?.notes.at(-1)
  const decide = (approve: boolean) => {
    app.actions.approveTask(channel.code, ask.task, approve)
    toast(approve ? `Approved T${ask.task}` : `Sent T${ask.task} back to ${task?.owner ?? ask.from}`)
  }
  return (
    <Shell
      face={who}
      name={ask.from}
      member={!!who}
      verb={`asks you to review T${ask.task}`}
      at={ask.at}
      link={link}
      actions={
        <>
          <button type="button" className="btn is-primary" onClick={() => decide(true)}>
            Approve
          </button>
          <button type="button" className="btn" onClick={() => decide(false)}>
            Send back
          </button>
          <button type="button" className="btn is-quiet" onClick={() => go({ to: "panel", panel: { kind: "task", task: ask.task } })}>
            Open the task
          </button>
        </>
      }
    >
      {task ? (
        <>
          <p className="needs-text">
            <span className="needs-id">T{task.id}</span> {task.title}
          </p>
          {note && (
            <blockquote className="needs-note">
              {note.text}{" "}
              <span className="needs-note-by">
                {note.by === channel.you ? "you" : note.by} · {ago(note.at)}
              </span>
            </blockquote>
          )}
          {task.pr && <PrChip pr={task.pr} />}
        </>
      ) : (
        <p className="needs-text dim">This task is gone.</p>
      )}
    </Shell>
  )
}
