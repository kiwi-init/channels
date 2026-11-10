import "~/i18n/en/needs"
import "~/styles/needs.css"

import { useEffect, useId, useState, type ReactNode } from "react"
import type { Color } from "@kiwi/core/protocol.ts"
import { Swatches } from "~/kit/swatches"

import { PrChip, TaskChip } from "~/chat/cards"
import { wordsPlain, wordsRaw } from "~/words"
import { InlineText } from "~/chat/inline-text"
import QuestionCard from "~/chat/question-card"
import type { Jump } from "~/chat/search-box"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { Avatar, Loading } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Toggle } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { ago, clock } from "~/kit/time"
import { ALL_POWERS, NO_POWERS, trusted, type Ask, type Channel, type JoinAsk, type Message, type PermissionAsk, type Person, type Powers, type QuestionAsk, type ReviewAsk } from "~/model"
import { useApp, useGo, useChannelHere } from "~/nav"
import { nickname, Shown } from "~/names"
import { SendBack } from "~/tasks/send-back"
import { isIdle, isOpen, openAsks } from "~/needs/open"
import { SpecNeedCard } from "~/specs/card"
import { personGo } from "~/person-go"

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
            {unchecked && <p className="needs-warn">{t("needs.list.unusual.joins")}</p>}
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
            <Empty title={t("needs.list.nothing")} />
          </div>
        )}
        {idle.length > 0 && (
          <section className="needs-idle" aria-label={t("needs.list.idle.label")}>
            <p className="needs-sum">{tr("needs.list.idle.sum", { rest: <span className="dimmer">{t("needs.list.idle.rest")}</span> })}</p>
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
              {tr("needs.list.answered", { n: <span className="num">{answered.length}</span> })}
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
  if (a.kind === "review" || a.kind === "spec") return a.at
  if (a.kind === "question" && a.closed) return a.closed.at
  return a.answer?.at ?? a.at
}

function byWhom(channel: Channel, by: string): string {
  return by === channel.you ? "" : t("needs.done.by", { name: nickname(channel, by) })
}

function doneLine(channel: Channel, a: Ask): string {
  switch (a.kind) {
    case "permission":
      return a.answer ? `${a.answer.allow ? t("needs.done.allowed") : t("needs.done.denied")} · ${nickname(channel, a.from)} · ${a.code} · ${ago(a.answer.at)}${byWhom(channel, a.answer.by)}` : ""
    case "question":
      if (a.closed) return `${t("needs.done.closed")} · ${nickname(channel, a.from)} · ${ago(a.closed.at)}${byWhom(channel, a.closed.by)}`
      return a.answer ? `${t("needs.done.chose", { text: wordsPlain(a.answer.text, channel.nicknames) })} · ${nickname(channel, a.from)} · ${ago(a.answer.at)}${byWhom(channel, a.answer.by)}` : ""
    case "join":
      return a.answer
        ? `${a.answer.letIn ? t("needs.done.let.in") : t("needs.done.turned.away")} · ${a.name}${a.sponsor ? ` · ${t("needs.brought.by", { name: a.sponsor })}` : ""} · ${ago(a.answer.at)}${byWhom(channel, a.answer.by)}`
        : ""
    case "review":
    case "spec":
      return ""
  }
}

type Face = Pick<Person, "name" | "kind" | "harness" | "presence" | "color">

function Card({ channel, ask, onJump }: { channel: Channel; ask: Ask; onJump: (jump: Jump) => void }) {
  const go = useGo()
  const source = channel.messages.find((m) => m.ask === ask.id)
  const show = (m: Message) => {
    go({ to: "where", where: m.where, jump: true })
    onJump({ m, terms: [] })
  }
  const link = (
    <>
      {source && (
        <button type="button" className="needs-link" onClick={() => show(source)}>
          {t("needs.card.show")}
        </button>
      )}
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
    case "spec":
      return <SpecNeedCard channel={channel} ask={ask} />
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
  until,
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
  until?: ReactNode
  link: ReactNode
}) {
  const go = useGo()
  const open = useChannelHere()
  return (
    <article className="needs-card is-open" aria-label={t("needs.card.label", { name, verb })}>
      <header className="needs-head">
        <Avatar person={face} size="sm" />
        {member ? (
          <button type="button" className="needs-name" onClick={() => go(open ? personGo(open, name) : { to: "modal", modal: { kind: "person", name } })}>
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
      {(actions || until) && (
        <footer className="needs-foot">
          {actions}
          {until && <span className="needs-until">{until}</span>}
        </footer>
      )}
    </article>
  )
}

function Holds({ channel, ids }: { channel: Channel; ids: number[] }) {
  const known = ids.filter((id) => channel.tasks.some((k) => k.id === id))
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
      verb={ask.title}
      at={ask.at}
      link={link}
      until={open && ask.expiresAt !== undefined ? <span title={t("needs.permission.terminal.too")}>{t("needs.permission.until", { time: clock(ask.expiresAt) })}</span> : undefined}
      actions={
        open && (ask.canAllow || ask.canDeny || ask.allower) ? (
          <>
            {ask.canDeny && (
              <button type="button" className="btn" onClick={() => app.actions.answerPermission(channel.code, ask.id, false)}>
                {t("needs.permission.deny")}
              </button>
            )}
            {ask.canAllow && (
              <button type="button" className="btn is-primary" onClick={() => app.actions.answerPermission(channel.code, ask.id, true)}>
                {t("needs.permission.allow")}
              </button>
            )}
            {!ask.canAllow && ask.allower && <span className="needs-why">{t("needs.permission.only", { name: nickname(channel, ask.allower) })}</span>}
          </>
        ) : undefined
      }
    >
      {ask.summary && <p className="needs-title">{t("needs.permission.summary", { text: ask.summary })}</p>}
      <div className="needs-written">
        <pre className="needs-code is-head" title={ask.tool}>
          {ask.code}
          {ask.cwd && <span className="needs-cwd">{t("needs.permission.in", { cwd: ask.cwd })}</span>}
        </pre>
        {ask.replaced !== undefined && <pre className="needs-code is-gone">{ask.replaced}</pre>}
        {ask.content !== undefined && <pre className={ask.replaced !== undefined ? "needs-code is-new" : "needs-code"}>{ask.content}</pre>}
      </div>
      {ask.notes.map((note) => (
        <p key={note} className="needs-alarm">
          {note}
        </p>
      ))}
      {expired && !ask.answer && ask.expiresAt !== undefined && <p className="dim">{t("needs.permission.stopped", { time: clock(ask.expiresAt) })}</p>}
      {ask.task !== undefined && <Holds channel={channel} ids={[ask.task]} />}
    </Shell>
  )
}

function QuestionAskCard({ channel, ask, link }: { channel: Channel; ask: QuestionAsk; link: ReactNode }) {
  const who = member(channel, ask.from)
  const holds = [...new Set([...(ask.task !== undefined ? [ask.task] : []), ...ask.holds])]
  const askedOf = ask.askedOf?.map((n) => nickname(channel, n)).join(t("needs.question.and"))
  return (
    <Shell
      face={who}
      name={nickname(channel, ask.from)}
      member={!!who}
      tag={{ text: ask.label, tone: ask.irreversible ? "alert" : ask.plain ? "quiet" : "decide" }}
      verb={ask.step ? t("needs.question.step") : ask.handoff ? t("needs.question.browser") : askedOf ? t("needs.question.asks", { names: askedOf }) : t("needs.question.asks.you")}
      at={ask.at}
      link={link}
    >
      <p className="needs-text">
        <InlineText text={wordsRaw(ask.text)} channel={channel} before={Number(ask.id)} />
      </p>
      {askedOf && <p className="needs-line">{t("needs.question.answer.too")}</p>}
      <QuestionCard channel={channel} ask={ask} />
      {holds.length > 0 && <Holds channel={channel} ids={holds} />}
    </Shell>
  )
}

const POWER_WORDS = {
  addsAgents: { label: "needs.power.adds.label", on: "needs.power.adds.on", off: "needs.power.adds.off" },
  answersDecisions: { label: "needs.power.answers.label", on: "needs.power.answers.on", off: "needs.power.answers.off" },
  managesAgents: { label: "needs.power.manages.label", on: "needs.power.manages.on", off: "needs.power.manages.off" },
} as const satisfies Record<keyof Powers, { label: Key; on: Key; off: Key }>

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
  if (said === "nothing") return <p className="needs-said">{t("needs.said.nothing")}</p>
  const machine = [said.machine, said.tools?.join(", ")].filter(Boolean).join(" · ")
  return (
    <>
      {said.repo && (
        <p className="needs-said">
          <span className="needs-repo">{said.repo}</span>
          {said.outside && <span className="needs-warn">{t("needs.said.outside")}</span>}
        </p>
      )}
      {machine && (
        <p className="needs-said">
          {machine} <span className="dimmer">{t("needs.said.word")}</span>
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
  const [color, setColor] = useState<Color | null>(null)
  const face: Face = { name: ask.name, kind: ask.who, harness: ask.harness, presence: "online" }
  const ready = (ask.check ?? "ready") === "ready" && ask.code !== ""
  const unchecked = ask.check === "unchecked"
  const line = [
    agent ? t("needs.join.agent") : t("needs.join.person"),
    ask.key && t("needs.join.key", { key: ask.key }),
    ask.runs,
    ask.machine && t("needs.join.on", { machine: ask.machine }),
    ask.sponsor && t("needs.brought.by", { name: ask.sponsor }),
  ]
    .filter(Boolean)
    .join(" · ")
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
      ...(agent ? { persona: chosen, ...(color ? { color } : {}) } : { powers: can }),
      ...(chosen ? {} : { readOnly: only }),
    })
  return (
    <Shell
      face={face}
      name={ask.name}
      member={false}
      verb={t("needs.join.wants.in")}
      at={ask.at}
      link={link}
      actions={
        <>
          <button type="button" className="btn is-danger" onClick={() => app.actions.answerJoin(channel.code, ask.id, false)}>
            {t("needs.join.turn.away")}
          </button>
          {ask.revoked ? null : unchecked ? (
            <button type="button" className="btn is-primary" onClick={() => app.actions.answerJoin(channel.code, ask.id, true)}>
              {agent ? t("needs.join.show.its.code") : t("needs.join.show.their.code")}
            </button>
          ) : (
            <button type="button" className="btn is-primary" disabled={!ready || blocked} onClick={letIn}>
              {!ready
                ? t("needs.join.waiting.code", { name: ask.name })
                : pinGone
                  ? t("needs.join.pick.first")
                  : label
                    ? t("needs.join.let.in.as", { label })
                    : t("needs.join.let.in", { name: ask.freeName ?? ask.name })}
            </button>
          )}
        </>
      }
    >
      <p className="needs-line">{line}</p>
      {ask.freeName && <p className="needs-line">{tr(agent ? "needs.join.taken.agent" : "needs.join.taken.person", { name: ask.name, free: <span className="needs-strong">{ask.freeName}</span> })}</p>}
      {ask.revoked && <p className="needs-warn">{tr("needs.join.revoked", { who: ask.sponsor ?? t("needs.join.its.person"), machine: ask.machine ?? "", command: <code>kiwi login</code> })}</p>}
      {ask.forgotten && !ask.revoked && <p className="needs-warn">{t("needs.join.forgotten", { machine: ask.machine ?? "" })}</p>}
      {ask.said && <Said said={ask.said} />}
      {ask.pin && (
        <p className="needs-line">
          {tr("needs.join.invited.as", { name: <span className="needs-strong">{ask.pin.name}</span> })}
          {ask.pin.persona === null && <span className="needs-warn">{t("needs.join.invited.gone")}</span>}
        </p>
      )}
      {!ask.revoked && (
        <div className="needs-check">
          {ready ? (
            <>
              <p className="needs-check-q">{agent ? t("needs.join.check.agent") : t("needs.join.check.person")}</p>
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
              <p className="needs-check-hint">{t("needs.join.check.hint")}</p>
            </>
          ) : unchecked ? (
            <p className="needs-check-q">{agent ? t("needs.join.shows.agent") : t("needs.join.shows.person")}</p>
          ) : (
            <p className="needs-check-q">{t("needs.join.code.soon", { name: ask.name })}</p>
          )}
        </div>
      )}
      {ready && !ask.revoked && (
        <div className="needs-opts">
          {agent && <Opt label={t("needs.join.colour")}>{() => <Swatches color={color ?? undefined} onPick={setColor} />}</Opt>}
          {agent && (
            <Opt label={t("needs.join.personality")} hint={app.personas.find((p) => p.id === chosen)?.about ?? t("needs.join.personality.default")}>
              {(id) => (
                <span className="needs-select">
                  <select id={id} className="input is-mono" value={pinGone ? "" : (chosen ?? "none")} onChange={(e) => setPersona(e.target.value === "none" ? null : e.target.value)}>
                    {pinGone && (
                      <option value="" disabled>
                        {t("needs.join.pick.one")}
                      </option>
                    )}
                    <option value="none">{t("needs.join.none")}</option>
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
            <Opt label={t("needs.join.full.trust")} hint={!only && trusted(can) ? t("needs.join.full.trust.on") : t("needs.join.full.trust.off")}>
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
              label={t("needs.join.read.only")}
              hint={only ? (agent ? t("needs.join.read.only.agent") : t("needs.join.read.only.person")) : agent ? t("needs.join.writes.agent") : t("needs.join.writes.person")}
            >
              {(id) => <Toggle id={id} on={only} onChange={setReadOnly} />}
            </Opt>
          )}
          {!agent &&
            (["addsAgents", "answersDecisions", "managesAgents"] as const).map((power) => (
              <Opt key={power} label={t(POWER_WORDS[power].label)} hint={t(can[power] ? POWER_WORDS[power].on : POWER_WORDS[power].off)}>
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
  const task = channel.tasks.find((k) => k.id === ask.task)
  const note = task?.notes.at(-1)
  const [sending, setSending] = useState(false)
  const decide = (approve: boolean, why?: string) => {
    app.actions.approveTask(channel.code, ask.task, approve, why)
    setSending(false)
    toast(approve ? t("needs.review.approved", { task: String(ask.task) }) : t("needs.review.sent.back", { task: String(ask.task), name: nickname(channel, task?.owner ?? ask.from) }))
  }
  return (
    <Shell
      face={who}
      name={nickname(channel, ask.from)}
      member={!!who}
      verb={t("needs.review.verb")}
      at={ask.at}
      link={link}
      actions={
        sending ? (
          <SendBack onSend={(why) => decide(false, why)} onCancel={() => setSending(false)} />
        ) : (
          <>
            <button type="button" className="btn is-primary" onClick={() => decide(true)}>
              {t("needs.review.approve")}
            </button>
            <button type="button" className="btn" onClick={() => setSending(true)}>
              {t("needs.review.send.back")}
            </button>
          </>
        )
      }
    >
      {task ? (
        <>
          <button type="button" className="needs-text needs-open" title={t("needs.open.task")} onClick={() => go({ to: "task", task: task.id })}>
            <span className="needs-id">T{task.id}</span> <Shown value={task.title} />
          </button>
          {note && (
            <blockquote className="needs-note">
              <Shown value={note.text} />{" "}
              <span className="needs-note-by">
                {note.by === channel.you ? t("needs.review.you") : nickname(channel, note.by)} · {ago(note.at)}
              </span>
            </blockquote>
          )}
          {task.pr && <PrChip pr={task.pr} />}
        </>
      ) : (
        <p className="needs-text dim">{t("needs.review.gone")}</p>
      )}
    </Shell>
  )
}
