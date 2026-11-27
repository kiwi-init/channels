import "~/i18n/en/needs"
import "~/styles/needs.css"

import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import type { Color } from "@kiwi/core/protocol.ts"
import { Swatches } from "~/kit/swatches"

import { wordsPlain, wordsRaw, wrote } from "~/words"
import QuestionCard from "~/chat/question-card"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { Loading } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Toggle } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { ago, clock, lasting, useNow } from "~/kit/time"
import { NO_POWERS, trusted, type Ask, type Channel, type JoinAsk, type PermissionAsk, type Powers, type PullRequest, type QuestionAsk, type ReviewAsk } from "~/model"
import { useApp, useGo, type Go } from "~/nav"
import { TASK_TICK_MS } from "~/tasks/tick"
import { wakeLine } from "~/needs/wake-line"
import SettledList from "~/needs/settled"
import { nickname } from "~/names"
import { SendBack } from "~/tasks/send-back"
import { isOpen, openAsks } from "~/needs/open"
import { SpecNeedCard } from "~/specs/card"
import { authored, esc, face, type Stranger } from "~/panes/engine"
import { card, join, link, main, maker, newTag, PageFrame, PageText, prTail, steps, taskRow, type Maker } from "~/panes/page"

export function NeedsYou({ channel }: { channel: Channel }) {
  const go = useGo()
  const [tag] = useState(newTag)
  const now = useNow(TASK_TICK_MS)
  const built = useMemo(() => needsText(channel, go, tag, now), [channel, go, tag, now])
  const look = useMemo(() => ({ stranger: strangerOf(channel) }), [channel])
  return (
    <PageFrame kind="needs">
      <PageText channel={channel} md={built.md} seal={built.m.seal} fields={built.m.fields} look={look} />
    </PageFrame>
  )
}

const strangerOf =
  (channel: Channel) =>
  (name: string): Stranger | undefined => {
    const ask = channel.asks.find((a): a is JoinAsk => a.kind === "join" && a.name === name)
    return ask ? { name: ask.name, kind: ask.who, harness: ask.harness, presence: "online" } : undefined
  }

const isIdle = (a: Ask): boolean => a.kind === "question" && !!a.idle && !a.answer

export function needsText(channel: Channel, go: (to: Go) => void, tag?: string, now = Date.now()): { md: string; m: Maker } {
  const m = maker(tag)
  const pending = openAsks(channel)
  const open = pending.filter((a) => !isIdle(a)).sort((a, b) => a.at - b.at)
  const joins = joinedQuestions(open)
  const unchecked = open.some((a) => a.kind === "join" && a.check === "unchecked")
  const idle = channel.asks.filter(isIdle).sort((a, b) => a.at - b.at)
  const settled = [...(channel.settled ?? [])].sort((a, b) => b.at - a.at)
  const answered = channel.asks
    .filter((a) => !isOpen(a))
    .sort((a, b) => answeredAt(b) - answeredAt(a))
    .map((a) => doneLine(channel, a))
    .filter(Boolean)
  const md = join([
    `# ${esc(t("shell.channel.needs.you"))}`,
    unchecked ? tone(t("needs.list.unusual.joins"), "decide") : "",
    ...open.filter((a) => !joins.joined.has(a.id)).map((a) => askText(channel, a, m, go, now, joins.more.get(a.id))),
    pending.length ? "" : m.field("clear", () => <Clear loading={!!channel.loading} />),
    settled.length ? `## \`kiwi:fold\` ${esc(t("needs.settled", { n: String(settled.length) }))}` : "",
    settled.length ? m.field("settled", () => <SettledList channel={channel} settled={settled} />) : "",
    idle.length ? `## ${esc(t("needs.list.idle.sum", { rest: t("needs.list.idle.rest") }))}` : "",
    ...idle.map((a) => askText(channel, a, m, go, now)),
    answered.length ? `## \`kiwi:fold\` ${esc(t("needs.list.answered", { n: String(answered.length) }))}` : "",
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

type Tone = "decide" | "alert" | "quiet"

const toned = (md: string, kind: Tone): string => `[${md}](kiwi-do:?tone=${kind})`
const tone = (text: string, kind: Tone): string => toned(esc(text), kind)

const SPOT = "\u0000"

const marked = (key: Key, vars: Record<string, string>, name: string, mark: (text: string) => string): string =>
  esc(t(key, { ...vars, [name]: SPOT }))
    .split(SPOT)
    .join(mark(vars[name] ?? ""))

const strong = (text: string): string => `**${esc(text)}**`
const code = (text: string): string => `\`${text.replaceAll("`", "'")}\``

const fence = (lines: readonly string[], lang = ""): string => {
  const text = lines.join("\n")
  const ticks = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (r) => r[0].length + 1)))
  return `${ticks}${lang}\n${text}\n${ticks}`
}

const quote = (text: string): string => `> ${text}`

interface Head {
  from: string
  name?: string
  tag?: string
  verb: string
  show?: string
  at: number
}

const headOf = (channel: Channel, h: Head, now: number): string =>
  `### ${[link(h.name ?? nickname(channel, h.from), face(h.from)), h.tag ?? "", esc(h.verb), h.show ?? "", esc(ago(h.at, now))].filter(Boolean).join(" · ")}`

const show = (channel: Channel, a: Ask): string => {
  const source = channel.messages.find((msg) => msg.ask === a.id)
  return source ? `[${esc(t("needs.card.show"))}](kiwi-msg:${source.seq})` : ""
}

const HELD_WORDS = 80

type HeldHead = NonNullable<QuestionAsk["heads"]>[number]

const heldRow = (channel: Channel, id: number, heads: readonly HeldHead[]): string[] => {
  const task = channel.tasks.find((x) => x.id === id)
  if (task) return [taskRow(channel, task, steps(task))]
  const head = heads.find((h) => h.id === id)
  if (!head) return []
  const start = wordsPlain(wrote(head.words), channel.nicknames).replace(/\s+/g, " ").trim()
  return [`- ${link(nickname(channel, head.by), face(head.by))} · ${link(start.length > HELD_WORDS ? `${start.slice(0, HELD_WORDS)}…` : start, `kiwi-msg:${id}`)}`]
}

const holds = (channel: Channel, ids: readonly number[], asks: readonly Ask[]): string => {
  const heads = asks.flatMap((a) => (a.kind === "question" ? (a.heads ?? []) : []))
  return ids.flatMap((id) => heldRow(channel, id, heads)).join("\n")
}

const prLine = (pr: PullRequest): string =>
  `- ${link(`#${pr.number} ${pr.title}`, `kiwi-pr:${pr.repo}/${pr.number}`)}${pr.additions === undefined ? "" : ` · +${pr.additions} −${pr.deletions ?? 0}`}${prTail(pr)}`

const QUESTION_TONE = (a: { irreversible?: boolean | undefined; plain?: boolean | undefined }): "alert" | "quiet" | "decide" => (a.irreversible ? "alert" : a.plain ? "quiet" : "decide")

const workOf = (a: QuestionAsk): number[] => [...new Set([...(a.task !== undefined ? [a.task] : []), ...a.holds])]

const joinsCard = (a: Ask): a is QuestionAsk => a.kind === "question" && !a.irreversible && !a.handoff && !a.step

const tagOf = (q: QuestionAsk): string => (q.area !== undefined && !q.irreversible ? q.area : q.label)

const areaKey = (a: QuestionAsk): string | undefined => a.area?.toLocaleLowerCase()

const together = (lead: QuestionAsk, a: QuestionAsk): boolean => workOf(lead).some((id) => workOf(a).includes(id)) || (a.area !== undefined && lead.from === a.from && areaKey(lead) === areaKey(a))

export function joinedQuestions(open: readonly Ask[]): { more: Map<string, QuestionAsk[]>; joined: Set<string> } {
  const more = new Map<string, QuestionAsk[]>()
  const joined = new Set<string>()
  const leads: QuestionAsk[] = []
  for (const a of open) {
    if (!joinsCard(a)) continue
    if (!workOf(a).length && a.area === undefined) continue
    const lead = leads.find((l) => together(l, a))
    if (!lead) {
      leads.push(a)
      continue
    }
    more.set(lead.id, [...(more.get(lead.id) ?? []), a])
    joined.add(a.id)
  }
  return { more, joined }
}

function askText(channel: Channel, a: Ask, m: Maker, go: (to: Go) => void, now: number, more: readonly QuestionAsk[] = []): string {
  switch (a.kind) {
    case "permission":
      return card([
        headOf(channel, { from: a.from, verb: a.title, show: show(channel, a), at: a.at }, now),
        a.summary ? `**${esc(t("needs.permission.summary", { text: a.summary }))}**` : "",
        fence(
          [
            ...`${a.code}${a.cwd ? t("needs.permission.in", { cwd: a.cwd }) : ""}`.split("\n").map((line) => ` ${line}`),
            ...(a.replaced?.split("\n").map((line) => `-${line}`) ?? []),
            ...(a.content?.split("\n").map((line) => `${a.replaced !== undefined ? "+" : " "}${line}`) ?? []),
          ],
          "diff"
        ),
        ...a.notes.map((note) => tone(note, "alert")),
        a.task !== undefined ? holds(channel, [a.task], [a]) : "",
        m.field(`permission-${a.id}`, () => <PermissionActs channel={channel} ask={a} />),
      ])
    case "question": {
      const one = (q: QuestionAsk, i: number): string[] => {
        const askedOf = q.askedOf?.map((n) => nickname(channel, n)).join(t("needs.question.and"))
        const verb = q.step ? t("needs.question.step") : q.handoff ? t("needs.question.browser") : askedOf ? t("needs.question.asks", { names: askedOf }) : t("needs.question.asks.you")
        return [
          i > 0 && q.from === a.from && tagOf(q).toLocaleLowerCase() === tagOf(a).toLocaleLowerCase()
            ? ""
            : headOf(channel, { from: q.from, tag: tone(tagOf(q), QUESTION_TONE(q)), verb, show: show(channel, q), at: q.at }, now),
          authored(wordsRaw(q.text)),
          q.via ? tone(t("needs.question.via", { name: nickname(channel, q.via) }), "quiet") : "",
          askedOf ? tone(t("needs.question.answer.too"), "quiet") : "",
          m.field(`question-${q.id}`, () => <QuestionCard channel={channel} ask={q} joined={i > 0} />),
        ]
      }
      return card([...one(a, 0), ...more.flatMap((q) => one(q, 1)), holds(channel, [...new Set([a, ...more].flatMap(workOf))], [a, ...more])])
    }
    case "join":
      return card([
        headOf(channel, { from: a.name, name: a.name, verb: t("needs.join.wants.in"), show: show(channel, a), at: a.at }, now),
        ...joinLines(a),
        m.field(`join-${a.id}`, () => <JoinGate channel={channel} ask={a} />),
      ])
    case "review": {
      const task = channel.tasks.find((x) => x.id === a.task)
      const note = task?.notes.at(-1)
      return card([
        headOf(channel, { from: a.from, verb: t("needs.review.verb"), show: show(channel, a), at: a.at }, now),
        task ? taskRow(channel, task, steps(task)) : esc(t("needs.review.gone")),
        note ? quote(`${esc(wordsPlain(note.text, channel.nicknames))} · ${esc(note.by === channel.you ? t("needs.review.you") : nickname(channel, note.by))} · ${esc(ago(note.at, now))}`) : "",
        task?.pr ? prLine(task.pr) : "",
        m.field(`review-${a.id}`, () => <ReviewActs channel={channel} ask={a} />),
      ])
    }
    case "spec":
      return m.field(`spec-${a.id}`, () => <SpecNeedCard channel={channel} ask={a} />)
    case "quiet": {
      const task = channel.tasks.find((x) => x.id === a.task)
      return card([
        headOf(channel, { from: a.from, verb: t("needs.quiet.verb", { time: lasting(now - a.since) }), at: a.at }, now),
        task ? taskRow(channel, task, steps(task)) : `T${a.task}`,
        quote(esc(wakeLine(a.wake, now))),
        main(m.act(t("needs.quiet.open"), () => go({ to: "task", task: a.task }))),
      ])
    }
  }
}

function joinLines(a: JoinAsk): string[] {
  const agent = a.who === "agent"
  const said = a.said
  const named = a.pin && "name" in a.pin ? a.pin : undefined
  const machine = said && said !== "nothing" ? [said.machine, said.tools?.join(", ")].filter(Boolean).join(" · ") : ""
  const repo = said && said !== "nothing" ? said.repo : undefined
  const outside = !!said && said !== "nothing" && !!said.outside
  return [
    tone(
      [
        agent ? t("needs.join.agent") : t("needs.join.person"),
        a.key ? t("needs.join.key", { key: a.key }) : "",
        a.runs ?? "",
        a.machine ? t("needs.join.on", { machine: a.machine }) : "",
        a.sponsor ? t("needs.brought.by", { name: a.sponsor }) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      "quiet"
    ),
    a.freeName ? toned(marked(agent ? "needs.join.taken.agent" : "needs.join.taken.person", { name: a.name, free: a.freeName }, "free", strong), "quiet") : "",
    a.revoked ? toned(marked("needs.join.revoked", { who: a.sponsor ?? t("needs.join.its.person"), machine: a.machine ?? "", command: "kiwi login" }, "command", code), "decide") : "",
    a.forgotten && !a.revoked ? tone(t("needs.join.forgotten", { machine: a.machine ?? "" }), "decide") : "",
    said === "nothing" ? tone(t("needs.said.nothing"), "quiet") : "",
    repo ? toned(`${code(repo)}${outside ? esc(t("needs.said.outside")) : ""}`, outside ? "decide" : "quiet") : "",
    machine ? tone(`${machine} ${t("needs.said.word")}`, "quiet") : "",
    named
      ? toned(`${marked("needs.join.invited.as", { name: named.name }, "name", strong)}${named.persona === null ? esc(t("needs.join.invited.gone")) : ""}`, named.persona === null ? "decide" : "quiet")
      : "",
    a.pin && "failed" in a.pin ? tone(t("needs.join.invite.failed"), "decide") : "",
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
