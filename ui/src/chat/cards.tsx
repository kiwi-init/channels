import { useState } from "react"

import { cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { clock } from "~/kit/time"
import type { Channel, PermissionAsk, PullRequest, QuestionAsk } from "~/model"
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
        {t.owner ? ` · ${nickname(channel, t.owner)}` : ""} · {STATUS_WORDS[t.status]}
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
            {" · "}
            <span className="num">+{pr.additions}</span> <span className="num">−{pr.deletions}</span>
          </>
        )}
        {" · "}
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

export function PermissionCard({ channel, ask }: { channel: Channel; ask: PermissionAsk }) {
  const { actions } = useAct()
  return (
    <div className={cx("ask", !ask.answer && "is-open")}>
      <p className="ask-title">
        {ask.summary} <span className="dim">· {ask.tool}</span>
      </p>
      <pre className="ask-code">{ask.code}</pre>
      {ask.answer ? (
        <p className="ask-state">
          {ask.answer.allow ? "Allowed" : "Denied"} by {ask.answer.by === channel.you ? "you" : nickname(channel, ask.answer.by)} · {clock(ask.answer.at)}
        </p>
      ) : (
        <>
          <p className="ask-state is-waiting">Waiting on you</p>
          <div className="actions">
            <button type="button" className="btn is-primary is-small" onClick={() => actions.answerPermission(channel.code, ask.id, true)}>
              Allow
            </button>
            <button type="button" className="btn is-small" onClick={() => actions.answerPermission(channel.code, ask.id, false)}>
              Deny
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function QuestionCard({ channel, ask }: { channel: Channel; ask: QuestionAsk }) {
  const { actions } = useAct()
  const [other, setOther] = useState<string | null>(null)
  if (ask.answer)
    return (
      <div className="ask">
        <p className="ask-state">
          {ask.answer.by === channel.you ? "You" : nickname(channel, ask.answer.by)} chose “{ask.answer.text}” · {clock(ask.answer.at)}
        </p>
      </div>
    )
  return (
    <div className="ask is-open">
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
      {other === null ? (
        <button type="button" className="btn is-quiet is-small" onClick={() => setOther("")}>
          Something else…
        </button>
      ) : (
        <form
          className="ask-other"
          onSubmit={(e) => {
            e.preventDefault()
            if (other.trim()) actions.answerQuestion(channel.code, ask.id, other.trim())
          }}
        >
          <input autoFocus className="input" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Your answer" onKeyDown={(e) => e.key === "Escape" && setOther(null)} />
          <button type="submit" className="btn is-primary is-small" disabled={!other.trim()}>
            Answer
          </button>
        </form>
      )}
    </div>
  )
}
