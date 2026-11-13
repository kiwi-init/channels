import "~/i18n/en/needs"
import "~/styles/needs.css"

import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import type { Color } from "@kiwi/core/protocol.ts"
import { Swatches } from "~/kit/swatches"

import { wordsPlain, wordsRaw } from "~/words"
import QuestionCard from "~/chat/question-card"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { Loading } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Toggle } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { ago, clock, lasting, useNow } from "~/kit/time"
import { NO_POWERS, trusted, type Ask, type Channel, type JoinAsk, type PermissionAsk, type Powers, type QuietAsk, type ReviewAsk } from "~/model"
import { useApp, useGo, type Go } from "~/nav"
import { TASK_TICK_MS } from "~/tasks/tick"
import { wakeLine } from "~/needs/wake-line"
import { nickname } from "~/names"
import { SendBack } from "~/tasks/send-back"
import { isIdle, isOpen, openAsks } from "~/needs/open"
import { SpecNeedCard } from "~/specs/card"
import { esc, inert } from "~/panes/engine"
import { card, join, maker, PageFrame, PageText, prRow, steps, taskRow, type Maker } from "~/panes/page"

export function NeedsYou({ channel }: { channel: Channel }) {
  const go = useGo()
  const built = useMemo(() => needsText(channel, go), [channel, go])
  return (
    <PageFrame kind="needs">
      <PageText channel={channel} md={built.md} seal={built.m.seal} fields={built.m.fields} />
    </PageFrame>
  )
}

export function needsText(channel: Channel, go: (to: Go) => void): { md: string; m: Maker } {
  const m = maker()
  const open = openAsks(channel).sort((a, b) => a.at - b.at)
  const unchecked = open.some((a) => a.kind === "join" && a.check === "unchecked")
  const idle = channel.asks.filter(isIdle).sort((a, b) => a.at - b.at)
  const answered = channel.asks
    .filter((a) => !isOpen(a))
    .sort((a, b) => answeredAt(b) - answeredAt(a))
    .map((a) => doneLine(channel, a))
    .filter(Boolean)
  const md = join([
    `# ${esc(t("shell.channel.needs.you"))}`,
    unchecked ? m.field(() => <p className="needs-warn">{t("needs.list.unusual.joins")}</p>) : "",
    ...open.map((a) => askText(channel, a, m, go)),
    open.length ? "" : m.field(() => <Clear loading={!!channel.loading} />),
    idle.length ? `## ${esc(t("needs.list.idle.label"))}` : "",
    ...idle.map((a) => askText(channel, a, m, go)),
    answered.length ? `## ${esc(t("needs.list.answered", { n: String(answered.length) }))}` : "",
    answered.map((line) => `- ${esc(line)}`).join("\n"),
  ])
  return { md, m }
}

function Clear({ loading }: { loading: boolean }) {
  if (loading) return <Loading />
  return (
    <div className="needs-clear">
      <svg className="needs-tick" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="18" pathLength="1" />
        <path d="M12.5 20.5l5.5 5.5 10-11" pathLength="1" />
      </svg>
      <Empty title={t("needs.list.nothing")} />
    </div>
  )
}

const fence = (text: string, lang = ""): string => {
  const ticks = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (r) => r[0].length + 1)))
  return `${ticks}${lang}\n${text}\n${ticks}`
}

const head = (channel: Channel, from: string, parts: readonly string[], at: number): string => {
  const more = [...parts, ago(at)].filter(Boolean).map(esc).join(" · ")
  return channel.people.some((p) => p.name === from) ? `## [@${esc(from)}](kiwi-mention:${encodeURIComponent(from)}) · ${more}` : `### ${esc(nickname(channel, from))} · ${more}`
}

const show = (channel: Channel, a: Ask): string => {
  const source = channel.messages.find((msg) => msg.ask === a.id)
  return source ? `[${esc(t("needs.card.show"))}](kiwi-msg:${source.seq})` : ""
}

const holds = (channel: Channel, ids: readonly number[]): string =>
  ids
    .map((id) => channel.tasks.find((x) => x.id === id))
    .flatMap((task) => (task ? [taskRow(channel, task, steps(task))] : []))
    .join("\n")

function askText(channel: Channel, a: Ask, m: Maker, go: (to: Go) => void): string {
  switch (a.kind) {
    case "permission":
      return card([
        head(channel, a.from, [a.title], a.at),
        a.summary ? esc(t("needs.permission.summary", { text: a.summary })) : "",
        fence(`${a.code}${a.cwd ? t("needs.permission.in", { cwd: a.cwd }) : ""}`),
        a.replaced !== undefined || a.content !== undefined
          ? fence(
              [...(a.replaced?.split("\n").map((line) => `- ${line}`) ?? []), ...(a.content?.split("\n").map((line) => `${a.replaced !== undefined ? "+ " : ""}${line}`) ?? [])].join("\n"),
              a.replaced !== undefined ? "diff" : ""
            )
          : "",
        a.notes.map((note) => `**${esc(note)}**`).join("\n\n"),
        a.task !== undefined ? holds(channel, [a.task]) : "",
        show(channel, a),
        m.field(() => <PermissionActs channel={channel} ask={a} />),
      ])
    case "question": {
      const askedOf = a.askedOf?.map((n) => nickname(channel, n)).join(t("needs.question.and"))
      const verb = a.step ? t("needs.question.step") : a.handoff ? t("needs.question.browser") : askedOf ? t("needs.question.asks", { names: askedOf }) : t("needs.question.asks.you")
      return card([
        head(channel, a.from, [a.label, verb], a.at),
        inert(wordsRaw(a.text)),
        askedOf ? esc(t("needs.question.answer.too")) : "",
        m.field(() => <QuestionCard channel={channel} ask={a} />),
        holds(channel, [...new Set([...(a.task !== undefined ? [a.task] : []), ...a.holds])]),
        show(channel, a),
      ])
    }
    case "join":
      return card([
        `### ${esc(a.name)} · ${esc(t("needs.join.wants.in"))} · ${esc(ago(a.at))}`,
        joinFacts(a)
          .map((line) => `- ${line}`)
          .join("\n"),
        ...joinNotes(a),
        m.field(() => <JoinGate channel={channel} ask={a} />),
        show(channel, a),
      ])
    case "review": {
      const task = channel.tasks.find((x) => x.id === a.task)
      const note = task?.notes.at(-1)
      return card([
        head(channel, a.from, [t("needs.review.verb")], a.at),
        task ? taskRow(channel, task, steps(task)) : esc(t("needs.review.gone")),
        note ? `*${esc(wordsPlain(note.text, channel.nicknames))}* · ${esc(note.by === channel.you ? t("needs.review.you") : nickname(channel, note.by))} · ${esc(ago(note.at))}` : "",
        task?.pr ? prRow(task.pr) : "",
        show(channel, a),
        m.field(() => <ReviewActs channel={channel} ask={a} />),
      ])
    }
    case "spec":
      return m.field(() => <SpecNeedCard channel={channel} ask={a} />)
    case "quiet": {
      const task = channel.tasks.find((x) => x.id === a.task)
      return card([
        head(channel, a.from, [], a.at),
        m.field(() => <QuietLine ask={a} />),
        task ? taskRow(channel, task, steps(task)) : `T${a.task}`,
        `**${m.act(t("needs.quiet.open"), () => go({ to: "task", task: a.task }))}**`,
      ])
    }
  }
}

function joinFacts(a: JoinAsk): string[] {
  const agent = a.who === "agent"
  const said = a.said
  const machine = said && said !== "nothing" ? [said.machine, said.tools?.join(", ")].filter(Boolean).join(" · ") : ""
  return [
    esc(agent ? t("needs.join.agent") : t("needs.join.person")),
    a.key ? esc(t("needs.join.key", { key: a.key })) : "",
    a.runs ? esc(a.runs) : "",
    a.machine ? esc(t("needs.join.on", { machine: a.machine })) : "",
    a.sponsor ? esc(t("needs.brought.by", { name: a.sponsor })) : "",
    said === "nothing" ? esc(t("needs.said.nothing")) : "",
    said && said !== "nothing" && said.repo ? `${esc(said.repo)}${said.outside ? ` **${esc(t("needs.said.outside"))}**` : ""}` : "",
    machine ? `${esc(machine)} ${esc(t("needs.said.word"))}` : "",
  ].filter(Boolean)
}

function joinNotes(a: JoinAsk): string[] {
  const agent = a.who === "agent"
  const named = a.pin && "name" in a.pin ? a.pin : undefined
  return [
    a.freeName ? esc(t(agent ? "needs.join.taken.agent" : "needs.join.taken.person", { name: a.name, free: a.freeName })) : "",
    a.revoked ? `**${esc(t("needs.join.revoked", { who: a.sponsor ?? t("needs.join.its.person"), machine: a.machine ?? "", command: "kiwi login" }))}**` : "",
    a.forgotten && !a.revoked ? `**${esc(t("needs.join.forgotten", { machine: a.machine ?? "" }))}**` : "",
    named ? `${esc(t("needs.join.invited.as", { name: named.name }))}${named.persona === null ? ` **${esc(t("needs.join.invited.gone"))}**` : ""}` : "",
    a.pin && "failed" in a.pin ? `**${esc(t("needs.join.invite.failed"))}**` : "",
  ]
}

function answeredAt(a: Ask): number {
  if (a.kind === "review" || a.kind === "spec" || a.kind === "quiet") return a.at
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
    case "quiet":
      return ""
  }
}

function usePast(at: number | undefined): boolean {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === undefined || now > at) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(at - now + 50, 2 ** 31 - 1))
    return () => window.clearTimeout(timer)
  }, [at, now])
  return at !== undefined && now > at
}

function PermissionActs({ channel, ask }: { channel: Channel; ask: PermissionAsk }) {
  const { app } = useApp()
  const expired = usePast(ask.expiresAt)
  const open = !ask.answer && !expired
  if (expired && !ask.answer && ask.expiresAt !== undefined) return <p className="dim">{t("needs.permission.stopped", { time: clock(ask.expiresAt) })}</p>
  if (!open || !(ask.canAllow || ask.canDeny || ask.allower)) return null
  return (
    <div className="needs-foot">
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
      {ask.expiresAt !== undefined && (
        <span className="needs-until" title={t("needs.permission.terminal.too")}>
          {t("needs.permission.until", { time: clock(ask.expiresAt) })}
        </span>
      )}
    </div>
  )
}

function QuietLine({ ask }: { ask: QuietAsk }) {
  const now = useNow(TASK_TICK_MS)
  return (
    <p className="needs-note">
      {t("needs.quiet.verb", { time: lasting(now - ask.since) })}. {wakeLine(ask.wake, now)}
    </p>
  )
}

function ReviewActs({ channel, ask }: { channel: Channel; ask: ReviewAsk }) {
  const { app, toast } = useApp()
  const task = channel.tasks.find((k) => k.id === ask.task)
  const [sending, setSending] = useState(false)
  const decide = (approve: boolean, why?: string) => {
    app.actions.approveTask(channel.code, ask.task, approve, why)
    setSending(false)
    toast(approve ? t("needs.review.approved", { task: String(ask.task) }) : t("needs.review.sent.back", { task: String(ask.task), name: nickname(channel, task?.owner ?? ask.from) }))
  }
  if (sending)
    return (
      <div className="needs-foot">
        <SendBack onSend={(why) => decide(false, why)} onCancel={() => setSending(false)} />
      </div>
    )
  return (
    <div className="needs-foot">
      <button type="button" className="btn is-primary" onClick={() => decide(true)}>
        {t("needs.review.approve")}
      </button>
      <button type="button" className="btn" onClick={() => setSending(true)}>
        {t("needs.review.send.back")}
      </button>
    </div>
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

function JoinGate({ channel, ask }: { channel: Channel; ask: JoinAsk }) {
  const { app } = useApp()
  const agent = ask.who === "agent"
  const [persona, setPersona] = useState<string | null | undefined>(undefined)
  const [readOnly, setReadOnly] = useState<boolean | undefined>(undefined)
  const [powers, setPowers] = useState<Powers | undefined>(undefined)
  const [color, setColor] = useState<Color | null>(null)
  const ready = (ask.check ?? "ready") === "ready" && ask.code !== ""
  const unchecked = ask.check === "unchecked"
  const named = ask.pin && "name" in ask.pin ? ask.pin : undefined
  const pinFailed = !!ask.pin && "failed" in ask.pin
  const chosen = agent ? (persona === undefined ? (named?.persona ?? null) : persona) : null
  const pinWaits = agent && persona === undefined && !!named && named.persona === undefined
  const pinGone = agent && persona === undefined && ((!!named && named.persona === null) || pinFailed)
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
    <div className="needs-gate">
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
          {!agent && !only && trusted(can) && (
            <p className="trust-note tone-decide" role="status">
              {t("needs.join.trusted.note", { name: ask.freeName ?? ask.name })}
            </p>
          )}
        </div>
      )}
      <div className="needs-foot">
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
      </div>
    </div>
  )
}
