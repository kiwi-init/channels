import "~/styles/needs.css"

import { useEffect, useId, useState, type ReactNode } from "react"

import { TOO_MANY_REQUESTS } from "@kiwi/core/sas.ts"

import { PrChip, QuestionCard, TaskChip } from "~/chat/cards"
import type { Jump } from "~/chat/search-box"
import { Avatar, Empty, Loading, Toggle } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago, clock } from "~/kit/time"
import { ALL_POWERS, NO_POWERS, trusted, type Ask, type Channel, type JoinAsk, type Message, type PermissionAsk, type Person, type Powers, type QuestionAsk, type ReviewAsk } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"
import { ShowAgent } from "~/kit/show-agent"
import { SendBack } from "~/tasks/send-back"
import { isIdle, isOpen, openAsks } from "~/needs/open"

export function NeedsYou({ channel, onJump }: { channel: Channel; onJump: (jump: Jump) => void }) {
  const open = openAsks(channel).sort((a, b) => a.at - b.at)
  const unchecked = open.some((a) => a.kind === "join" && a.check === "unchecked")
  const idle = channel.asks.filter(isIdle).sort((a, b) => a.at - b.at)
  const answered = channel.asks.filter((a) => !isOpen(a)).sort((a, b) => answeredAt(b) - answeredAt(a))
  return (
    <div className="needs">
      <div className="needs-list">
        {open.length > 0 ? (
          <>
            <p className="needs-sum">
              {open.length} {open.length === 1 ? "thing waits" : "things wait"} on you <span className="dimmer">· oldest first</span>
            </p>
            {unchecked && <p className="needs-warn">{TOO_MANY_REQUESTS}</p>}
            <ol className="needs-cards">
              {open.map((a) => (
                <li key={a.id}>
                  <Card channel={channel} ask={a} onJump={onJump} />
                </li>
              ))}
            </ol>
          </>
        ) : channel.loading ? (
          <Loading />
        ) : (
          <div className="needs-clear">
            <svg className="needs-tick" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="18" pathLength="1" />
              <path d="M12.5 20.5l5.5 5.5 10-11" pathLength="1" />
            </svg>
            <Empty title="Nothing needs you.">Asks from agents and people who want in show up here.</Empty>
          </div>
        )}
        {idle.length > 0 && (
          <section className="needs-idle" aria-label="Asked, holding nothing up">
            <p className="needs-sum">
              Also asked you <span className="dimmer">· holding nothing up</span>
            </p>
            <ol className="needs-cards">
              {idle.map((a) => (
                <li key={a.id}>
                  <Card channel={channel} ask={a} onJump={onJump} />
                </li>
              ))}
            </ol>
          </section>
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
  return by === channel.you ? "" : ` · by ${nickname(channel, by)}`
}

function doneLine(channel: Channel, a: Ask): string {
  switch (a.kind) {
    case "permission":
      return a.answer ? `${a.answer.allow ? "Allowed" : "Denied"} · ${nickname(channel, a.from)} · ${a.code} · ${ago(a.answer.at)}${byWhom(channel, a.answer.by)}` : ""
    case "question":
      return a.answer ? `Chose “${a.answer.text}” · ${nickname(channel, a.from)} · ${ago(a.answer.at)}${byWhom(channel, a.answer.by)}` : ""
    case "join":
      return a.answer ? `${a.answer.letIn ? "Let in" : "Turned away"} · ${a.name}${a.sponsor ? ` · brought by ${a.sponsor}` : ""} · ${ago(a.answer.at)}${byWhom(channel, a.answer.by)}` : ""
    case "review":
      return ""
  }
}

type Face = Pick<Person, "name" | "kind" | "harness" | "presence" | "color">

function Card({ channel, ask, onJump }: { channel: Channel; ask: Ask; onJump: (jump: Jump) => void }) {
  const { go } = useApp()
  const source = channel.messages.find((m) => m.ask === ask.id)
  const show = (m: Message) => {
    go({ to: "where", where: m.where })
    if (m.inThread !== undefined) go({ to: "panel", panel: { kind: "thread", seq: m.inThread } })
    else onJump({ m, terms: [] })
  }
  const link = (
    <>
      {source && (
        <button type="button" className="needs-link" onClick={() => show(source)}>
          Show in the conversation
        </button>
      )}
      <ShowAgent channel={channel} person={"from" in ask ? member(channel, ask.from) : undefined} className="needs-link" />
    </>
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
  tag,
  verb,
  at,
  children,
  actions,
  link,
}: {
  face: Face | undefined
  name: string
  member: boolean
  tag?: { text: string; tone: "decide" | "alert" | "quiet" }
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
        {tag && <span className={`needs-tag is-${tag.tone}`}>{tag.text}</span>}
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

function usePast(at: number | undefined): boolean {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === undefined || now > at) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(at - now + 50, 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [at, now])
  return at !== undefined && now > at
}

function PermissionAskCard({ channel, ask, link }: { channel: Channel; ask: PermissionAsk; link: ReactNode }) {
  const { app } = useApp()
  const who = member(channel, ask.from)
  const expired = usePast(ask.expiresAt)
  const open = !ask.answer && !expired
  return (
    <Shell
      face={who}
      name={nickname(channel, ask.from)}
      member={!!who}
      tag={{ text: "Permission", tone: "decide" }}
      verb={ask.title}
      at={ask.at}
      link={link}
      actions={
        open && (ask.canAllow || ask.canDeny || ask.allower) ? (
          <>
            {ask.canAllow && (
              <button type="button" className="btn is-primary" onClick={() => app.actions.answerPermission(channel.code, ask.id, true)}>
                Allow
              </button>
            )}
            {ask.canDeny && (
              <button type="button" className="btn" onClick={() => app.actions.answerPermission(channel.code, ask.id, false)}>
                Deny
              </button>
            )}
            {!ask.canAllow && ask.allower && <span className="dim">Only {nickname(channel, ask.allower)} can allow it: it runs on their computer.</span>}
          </>
        ) : undefined
      }
    >
      {ask.summary && <p className="needs-title">“{ask.summary}”</p>}
      <pre className="needs-code">{ask.code}</pre>
      {ask.replaced !== undefined && <Written label="Replaces" text={ask.replaced} gone />}
      {ask.content !== undefined && <Written label={ask.replaced !== undefined ? "With" : "Writes"} text={ask.content} />}
      {ask.notes.map((note) => (
        <p key={note} className="needs-alarm">
          {note}
        </p>
      ))}
      <p className="needs-line">{[ask.tool, ask.cwd && `in ${ask.cwd}`].filter(Boolean).join(" · ")}</p>
      {ask.expiresAt !== undefined && !ask.answer && (
        <p className="dim">
          {expired ? `It stopped waiting at ${clock(ask.expiresAt)}. If it still needs this, it asks again in its terminal.` : `It waits until ${clock(ask.expiresAt)}, and asks in its terminal too.`}
        </p>
      )}
      {ask.task !== undefined && <Holds channel={channel} ids={[ask.task]} />}
    </Shell>
  )
}

function Written({ label, text, gone }: { label: string; text: string; gone?: boolean }) {
  return (
    <div className="needs-written">
      <p className="needs-label">{label}</p>
      <pre className={gone ? "needs-code is-gone" : "needs-code"}>{text}</pre>
    </div>
  )
}

function QuestionAskCard({ channel, ask, link }: { channel: Channel; ask: QuestionAsk; link: ReactNode }) {
  const who = member(channel, ask.from)
  const holds = [...new Set([...(ask.task !== undefined ? [ask.task] : []), ...ask.holds])]
  const askedOf = ask.askedOf?.map((n) => nickname(channel, n)).join(" and ")
  return (
    <Shell
      face={who}
      name={nickname(channel, ask.from)}
      member={!!who}
      tag={{ text: ask.label, tone: ask.irreversible ? "alert" : ask.label.startsWith("Question") ? "quiet" : "decide" }}
      verb={ask.step ? "has a step for you" : ask.handoff ? "needs you in a browser" : askedOf ? `asks ${askedOf}` : "asks you"}
      at={ask.at}
      link={link}
    >
      <p className="needs-text">{ask.text}</p>
      {askedOf && <p className="needs-line">Put to {askedOf}. You can answer too, and the first answer counts.</p>}
      <QuestionCard channel={channel} ask={ask} />
      {holds.length > 0 && (
        <>
          <p className="needs-label">{holds.length === 1 ? `This task waits on ${askedOf ? "an" : "your"} answer` : `These tasks wait on ${askedOf ? "an" : "your"} answer`}</p>
          <Holds channel={channel} ids={holds} />
        </>
      )}
    </Shell>
  )
}

const POWER_WORDS: Record<keyof Powers, { label: string; on: string; off: string }> = {
  addsAgents: {
    label: "Can add agents",
    on: "Their agents join on their own from computers paired with their Kiwi app.",
    off: "Their agents wait for you to let them in.",
  },
  answersDecisions: {
    label: "Can answer decisions",
    on: "They answer agents' decisions in Needs you, as you do.",
    off: "Agents' decisions go to you and each agent's own person.",
  },
  managesAgents: {
    label: "Can manage agents",
    on: "They pick agents' personalities and roles, the lead included. Never people's, and never their own.",
    off: "Only you change agents' personalities and roles.",
  },
}

function Opt({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="needs-opt">
      <div className="needs-opt-text">
        <label className="needs-opt-label" htmlFor={id}>
          {label}
        </label>
        {hint && <p className="needs-opt-hint">{hint}</p>}
      </div>
      {children(id)}
    </div>
  )
}

function Said({ said }: { said: NonNullable<JoinAsk["said"]> }) {
  if (said === "nothing") return <p className="needs-said">Didn't say what it runs on (an older kiwi)</p>
  const machine = [said.machine, said.tools?.join(", ")].filter(Boolean).join(" · ")
  return (
    <>
      {said.repo && (
        <p className="needs-said">
          <span className="needs-repo">{said.repo}</span>
          {said.outside && <span className="needs-warn"> · not one of this channel's repos</span>}
        </p>
      )}
      {machine && (
        <p className="needs-said">
          {machine} <span className="dimmer">· its word</span>
        </p>
      )}
    </>
  )
}

function JoinAskCard({ channel, ask, link }: { channel: Channel; ask: JoinAsk; link: ReactNode }) {
  const { app } = useApp()
  const agent = ask.who === "agent"
  const [persona, setPersona] = useState<string | null | undefined>(undefined)
  const [readOnly, setReadOnly] = useState<boolean | undefined>(undefined)
  const [powers, setPowers] = useState<Powers | undefined>(undefined)
  const face: Face = { name: ask.name, kind: ask.who, harness: ask.harness, presence: "online" }
  const ready = (ask.check ?? "ready") === "ready" && ask.code !== ""
  const unchecked = ask.check === "unchecked"
  const line = [agent ? "Agent" : "Person", ask.key && `key ${ask.key}`, ask.runs, ask.machine && `on ${ask.machine}`, ask.sponsor && `brought by ${ask.sponsor}`].filter(Boolean).join(" · ")
  const chosen = agent ? (persona === undefined ? (ask.pin?.persona ?? null) : persona) : null
  const pinWaits = agent && persona === undefined && !!ask.pin && ask.pin.persona === undefined
  const pinGone = agent && persona === undefined && !!ask.pin && ask.pin.persona === null
  const label = app.personas.find((p) => p.id === chosen)?.label
  const only = readOnly ?? channel.newMembers === "read"
  const can = powers ?? channel.newPowers ?? NO_POWERS
  const blocked = pinWaits || pinGone
  const letIn = () =>
    app.actions.answerJoin(channel.code, ask.id, true, {
      ...(ask.freeName ? { as: ask.freeName } : {}),
      ...(agent ? { persona: chosen } : { powers: can }),
      ...(chosen ? {} : { readOnly: only }),
    })
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
          {unchecked ? (
            <button type="button" className="btn is-primary" onClick={() => app.actions.answerJoin(channel.code, ask.id, true)}>
              Show {agent ? "its" : "their"} code
            </button>
          ) : (
            <button type="button" className="btn is-primary" disabled={!ready || blocked} onClick={letIn}>
              {!ready ? `Waiting for ${ask.name}'s code…` : pinGone ? "Pick a personality first" : label ? `It matches: let in as ${label}` : `It matches: let ${ask.freeName ?? ask.name} in`}
            </button>
          )}
          <button type="button" className="btn is-danger" onClick={() => app.actions.answerJoin(channel.code, ask.id, false)}>
            Turn away
          </button>
        </>
      }
    >
      <p className="needs-line">{line}</p>
      {ask.freeName && (
        <p className="needs-line">
          Someone here is already called {ask.name}, so {agent ? "it" : "they"} join{agent ? "s" : ""} as <span className="needs-strong">{ask.freeName}</span>.
        </p>
      )}
      {ask.forgotten && <p className="needs-warn">It runs on {ask.machine}, a computer you forgot, so it didn't join on its own. Let it in only if you meant to bring that computer back.</p>}
      {ask.said && <Said said={ask.said} />}
      {ask.pin && (
        <p className="needs-line">
          Invited as <span className="needs-strong">{ask.pin.name}</span>
          {ask.pin.persona === null && <span className="needs-warn">, which isn't on this computer anymore</span>}
        </p>
      )}
      <div className="needs-check">
        {ready ? (
          <>
            <p className="needs-check-q">Does {agent ? "its terminal" : "their screen"} show this code?</p>
            <p className="needs-pin">
              <span className="sr">{ask.code}</span>
              {ask.code.split("").map((d, i) =>
                d === "-" ? (
                  <span key={i} className="needs-dash" aria-hidden="true">
                    –
                  </span>
                ) : (
                  <span key={i} className="needs-digit" aria-hidden="true">
                    {d}
                  </span>
                )
              )}
            </p>
            <p className="needs-check-hint">If it doesn't match, someone else has the link. Turn them away.</p>
          </>
        ) : unchecked ? (
          <p className="needs-check-q">
            Show {agent ? "its" : "their"} code to start the check. It appears here and on {agent ? "its terminal" : "their screen"}, then you compare.
          </p>
        ) : (
          <p className="needs-check-q">Their code shows up here as soon as {ask.name} has it on screen. Then you compare.</p>
        )}
      </div>
      {ready && (
        <div className="needs-opts">
          {agent && (
            <Opt label="Personality" hint={app.personas.find((p) => p.id === chosen)?.about ?? "Works the way its harness does by default."}>
              {(id) => (
                <span className="needs-select">
                  <select id={id} className="input is-mono" value={pinGone ? "" : (chosen ?? "none")} onChange={(e) => setPersona(e.target.value === "none" ? null : e.target.value)}>
                    {pinGone && (
                      <option value="" disabled>
                        Pick one
                      </option>
                    )}
                    <option value="none">None</option>
                    {app.personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <Icon name="down" size={14} />
                </span>
              )}
            </Opt>
          )}
          {!agent && (
            <Opt
              label="Full trust"
              hint={
                !only && trusted(can)
                  ? "They write and work, add agents, answer decisions and manage agents. The channel stays yours."
                  : "Every power at once, for someone you'd trust with your life. The channel stays yours."
              }
            >
              {(id) => (
                <Toggle
                  id={id}
                  on={!only && trusted(can)}
                  onChange={(on) => {
                    if (on) setReadOnly(false)
                    setPowers(on ? ALL_POWERS : NO_POWERS)
                  }}
                />
              )}
            </Opt>
          )}
          {!chosen && (
            <Opt
              label="Can only read"
              hint={
                only ? `${agent ? "It reads" : "They read"} the channel and can't post.` : agent ? "It writes, asks, works on tasks and sets notes." : "They write, ask, work on tasks and set notes."
              }
            >
              {(id) => <Toggle id={id} on={only} onChange={setReadOnly} />}
            </Opt>
          )}
          {!agent &&
            (["addsAgents", "answersDecisions", "managesAgents"] as const).map((power) => (
              <Opt key={power} label={POWER_WORDS[power].label} hint={can[power] ? POWER_WORDS[power].on : POWER_WORDS[power].off}>
                {(id) => <Toggle id={id} on={can[power]} onChange={(on) => setPowers({ ...can, [power]: on })} />}
              </Opt>
            ))}
        </div>
      )}
    </Shell>
  )
}

function ReviewAskCard({ channel, ask, link }: { channel: Channel; ask: ReviewAsk; link: ReactNode }) {
  const { app, go, toast } = useApp()
  const who = member(channel, ask.from)
  const task = channel.tasks.find((t) => t.id === ask.task)
  const note = task?.notes.at(-1)
  const [sending, setSending] = useState(false)
  const decide = (approve: boolean, why?: string) => {
    app.actions.approveTask(channel.code, ask.task, approve, why)
    setSending(false)
    toast(approve ? `Approved T${ask.task}` : `Sent T${ask.task} back to ${nickname(channel, task?.owner ?? ask.from)}`)
  }
  return (
    <Shell
      face={who}
      name={nickname(channel, ask.from)}
      member={!!who}
      verb={`asks you to review T${ask.task}`}
      at={ask.at}
      link={link}
      actions={
        sending ? (
          <SendBack onSend={(why) => decide(false, why)} onCancel={() => setSending(false)} />
        ) : (
          <>
            <button type="button" className="btn is-primary" onClick={() => decide(true)}>
              Approve
            </button>
            <button type="button" className="btn" onClick={() => setSending(true)}>
              Send back
            </button>
            <button type="button" className="btn is-quiet" onClick={() => go({ to: "panel", panel: { kind: "task", task: ask.task } })}>
              Open the task
            </button>
          </>
        )
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
                {note.by === channel.you ? "you" : nickname(channel, note.by)} · {ago(note.at)}
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
