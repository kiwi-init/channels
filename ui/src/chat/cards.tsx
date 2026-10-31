import { useEffect, useState } from "react"

import { HANDOFF_DONE, HANDOFF_FAILED } from "@kiwi/core/protocol.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { StepAnswer, StepHow } from "~/chat/step"
import { cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { clock } from "~/kit/time"
import { announce } from "~/kit/toasts"
import type { Channel, PullRequest, QuestionAsk } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"

export function TaskChip({ channel, id }: { channel: Channel; id: number }) {
  const { go } = useAct()
  const t = channel.tasks.find((t) => t.id === id)
  if (!t) return null
  return (
    <button type="button" className={cx("chip", `is-${t.status}`)} onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
      <Dot status={t.status} />
      <span className="chip-id">T{t.id}</span>
      <span className="chip-title">{t.title}</span>
      <span className="chip-meta">
        {t.owner ? `${nickname(channel, t.owner)} · ` : ""}
        {STATUS_WORDS[t.status]}
        {t.pr ? ` · PR #${t.pr.number}` : ""}
      </span>
    </button>
  )
}

export const CHECKS: Record<PullRequest["checks"], string> = { pass: "checks pass", fail: "checks fail", running: "checks running", none: "no checks" }

export function PrChip({ pr }: { pr: PullRequest }) {
  return (
    <a className={cx("chip is-pr", `is-${pr.state}`)} href={pr.url} target="_blank" rel="noreferrer noopener">
      <Icon name="pr" size={14} />
      <span className="chip-id">#{pr.number}</span>
      <span className="chip-title">{pr.title}</span>
      <span className="chip-meta">
        {pr.additions !== undefined && (
          <>
            <span className="num">+{pr.additions}</span> <span className="num">−{pr.deletions}</span>
            {" · "}
          </>
        )}
        <span
          className={
            pr.state === "merged"
              ? "tone-review"
              : pr.state === "closed"
                ? "tone-alert"
                : pr.checks === "pass"
                  ? "tone-live"
                  : pr.checks === "fail"
                    ? "tone-alert"
                    : pr.checks === "running"
                      ? "tone-decide"
                      : ""
          }
        >
          {pr.state === "merged" ? "merged" : pr.state === "closed" ? "closed" : CHECKS[pr.checks]}
        </span>
      </span>
    </a>
  )
}

type Handoff = NonNullable<QuestionAsk["handoff"]>

function useNow(until: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === undefined || now >= until) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(30_000, until - now + 50))
    return () => window.clearTimeout(timer)
  }, [until, now])
  return now
}

function openBrowser(handoff: Handoff): void {
  if (handoff.expiresAt <= Date.now()) return announce("The link has expired")
  const b = bridge()
  if (b) void b.openExternal(handoff.url).catch(() => announce("Couldn't open the browser"))
  else window.open(handoff.url, "_blank", "noopener,noreferrer")
}

function HandoffLink({ handoff, now }: { handoff: Handoff; now: number }) {
  if (handoff.expiresAt <= now) return <p className="ask-state">{handoff.label} · link expired</p>
  const minutes = Math.max(1, Math.ceil((handoff.expiresAt - now) / 60_000))
  return (
    <div className="ask-handoff">
      <button type="button" className="btn is-primary is-small" onClick={() => openBrowser(handoff)}>
        <Icon name="external" size={14} />
        Open browser
      </button>
      <span className="ask-state">
        {handoff.label} · expires in {minutes} min
      </span>
    </div>
  )
}

export function QuestionCard({ channel, ask }: { channel: Channel; ask: QuestionAsk }) {
  const { actions } = useAct()
  const free = !ask.step && !ask.handoff && ask.options.length === 0
  const [other, setOther] = useState<string | null>(free ? "" : null)
  const now = useNow(ask.answer ? undefined : ask.handoff?.expiresAt)
  const asker = nickname(channel, ask.from)
  if (ask.answer) {
    const who = ask.answer.by === channel.you ? "You" : nickname(channel, ask.answer.by)
    if (ask.handoff && (ask.answer.text === HANDOFF_DONE || ask.answer.text === HANDOFF_FAILED))
      return (
        <div className="ask">
          <p className="ask-state">
            {who} {ask.answer.text === HANDOFF_DONE ? "finished in the browser" : "couldn’t finish in the browser"} · {clock(ask.answer.at)}
          </p>
        </div>
      )
    if (ask.options.includes(ask.answer.text))
      return (
        <div className="ask">
          <p className="ask-state">
            {who} chose “{ask.answer.text}” · {clock(ask.answer.at)}
          </p>
        </div>
      )
    return (
      <div className="ask">
        <p className="ask-state">
          {who} {ask.step ? "answered" : "replied"} · {clock(ask.answer.at)}
        </p>
        <p className="ask-reply">{ask.answer.text}</p>
      </div>
    )
  }
  return (
    <div className="ask is-open">
      {ask.handoff && <HandoffLink handoff={ask.handoff} now={now} />}
      {ask.handoff && other === null && ask.handoff.expiresAt > now && (
        <div className="actions">
          <button type="button" className="btn is-small" onClick={() => actions.answerQuestion(channel.code, ask.id, HANDOFF_DONE)}>
            Done
          </button>
          <button type="button" className="btn is-quiet is-small" onClick={() => actions.answerQuestion(channel.code, ask.id, HANDOFF_FAILED)}>
            Couldn’t
          </button>
          <button type="button" className="btn is-quiet is-small" onClick={() => setOther("")}>
            Something else…
          </button>
        </div>
      )}
      {ask.step && <StepHow step={ask.step} />}
      {ask.step && other === null && <StepAnswer onAnswer={(reply) => actions.answerStep(channel.code, ask.id, reply)} onElse={() => setOther("")} />}
      {ask.options.length > 0 && (
        <ol className="ask-options">
          {ask.options.map((o, i) => (
            <li key={o}>
              <button type="button" className="ask-option" onClick={() => actions.answerQuestion(channel.code, ask.id, o)}>
                <span className="ask-letter">{String.fromCharCode(65 + i)}</span>
                {o}
              </button>
            </li>
          ))}
        </ol>
      )}
      {(ask.step || (ask.handoff && ask.handoff.expiresAt > now)) && other === null ? null : other === null ? (
        <button type="button" className="btn is-quiet is-small" onClick={() => setOther("")}>
          Something else…
        </button>
      ) : (
        <form
          className="ask-reply-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (other.trim()) actions.answerQuestion(channel.code, ask.id, other.trim())
          }}
        >
          <label className="ask-reply-label" htmlFor={`reply-${ask.id}`}>
            Reply to {asker}
            <span className="ask-reply-hint"> · answers this card, in its thread</span>
          </label>
          <div className="ask-other">
            <input
              id={`reply-${ask.id}`}
              autoFocus={!free}
              className="input"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder={`Your reply to ${asker}`}
              onKeyDown={(e) => e.key === "Escape" && !free && setOther(null)}
            />
            <button type="submit" className="btn is-primary is-small" disabled={!other.trim()}>
              Reply
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
