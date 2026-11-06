import { useEffect, useMemo, useState } from "react"

import { HANDOFF_DONE, HANDOFF_FAILED } from "@kiwi/core/protocol.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { wordsPlain, wordsRaw, wordsSame } from "~/words"
import { Body } from "~/chat/body"
import { jumpTo } from "~/chat/reply"
import { StepAnswer, StepHow } from "~/chat/step"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { clock } from "~/kit/time"
import { announce } from "~/kit/toasts"
import type { Channel, QuestionAsk } from "~/model"
import { openMessage } from "~/live/open-message"
import { useAct } from "~/nav"
import { nickname } from "~/names"

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
  if (handoff.expiresAt <= Date.now()) return announce("The link has expired", "error")
  const b = bridge()
  if (b) void b.openExternal(handoff.url).catch(() => announce("Couldn't open the browser", "error"))
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

type Closed = NonNullable<QuestionAsk["closed"]>

function seeAsk(code: string, seq: number): void {
  if (!jumpTo(document.body, seq)) openMessage(code, seq)
}

const openImage = (url: string) => void window.open(url, "_blank", "noopener,noreferrer")

function ClosedAsk({ channel, closed }: { channel: Channel; closed: Closed }) {
  const who = closed.by === channel.you ? "you" : nickname(channel, closed.by)
  const parts = closed.why ? wordsPlain(closed.why, channel.nicknames).split(/(#\d+)/) : []
  return (
    <div className="ask-done">
      <p>
        Closed by {who} <time>{clock(closed.at)}</time>
      </p>
      {closed.why && (
        <p className="ask-reply">
          {parts.map((part, i) =>
            /^#\d+$/.test(part) ? (
              <button key={i} type="button" className="ask-seq" onClick={() => seeAsk(channel.code, Number(part.slice(1)))}>
                {part}
              </button>
            ) : (
              part
            )
          )}
        </p>
      )}
    </div>
  )
}

export default function QuestionCard({ channel, ask }: { channel: Channel; ask: QuestionAsk }) {
  const { actions } = useAct()
  const free = !ask.step && !ask.handoff && ask.options.length === 0
  const [other, setOther] = useState<string | null>(free ? "" : null)
  const now = useNow(ask.answer ? undefined : ask.handoff?.expiresAt)
  const asker = nickname(channel, ask.from)
  const tasks = useMemo(() => new Set(channel.tasks.map((t) => t.id)), [channel.tasks])
  if (ask.answer) {
    const who = ask.answer.by === channel.you ? "You" : nickname(channel, ask.answer.by)
    const at = <time>{clock(ask.answer.at)}</time>
    const reply = wordsRaw(ask.answer.text)
    if (ask.handoff && (reply === HANDOFF_DONE || reply === HANDOFF_FAILED))
      return (
        <p className="ask-done">
          {who} {reply === HANDOFF_DONE ? "finished in the browser" : "couldn’t finish in the browser"} {at}
        </p>
      )
    const answered = ask.answer.text
    if (ask.options.some((o) => wordsSame(o, answered)))
      return (
        <p className="ask-done">
          {who} chose <b>{wordsPlain(ask.answer.text, channel.nicknames)}</b> {at}
        </p>
      )
    const verb = ask.step ? "answered" : "replied"
    const answer = ask.answer
    if (answer.shownIn === "feed")
      return (
        <p className="ask-done">
          {who} {verb} {at} ·{" "}
          <button type="button" className="ask-seq" onClick={() => seeAsk(channel.code, answer.seq)}>
            Show the reply
          </button>
        </p>
      )
    return (
      <div className="ask-done">
        <p>
          {who} {verb} {at}
        </p>
        <div className="ask-reply">
          <Body text={answer.text} seq={Number(ask.id)} names={channel.nicknames} tasks={tasks} onImage={openImage} onMessage={(seq) => seeAsk(channel.code, seq)} />
        </div>
      </div>
    )
  }
  if (ask.closed) return <ClosedAsk channel={channel} closed={ask.closed} />
  const choice = ask.options.length > 0 && !ask.step && !ask.handoff
  return (
    <div className={cx("ask", choice && "is-choice", free && "is-free")}>
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
      {ask.step && <StepHow step={ask.step} you={[channel.you, nickname(channel, channel.you)]} />}
      {ask.step && other === null && <StepAnswer onAnswer={(reply) => actions.answerStep(channel.code, ask.id, reply)} onElse={() => setOther("")} />}
      {ask.options.length > 0 && (
        <ol className="ask-options">
          {ask.options.map((o, i) => (
            <li key={wordsRaw(o)}>
              <button type="button" className="ask-option" onClick={() => actions.answerQuestion(channel.code, ask.id, wordsRaw(o))}>
                <span className="ask-letter">{String.fromCharCode(65 + i)}</span>
                {wordsPlain(o, channel.nicknames)}
              </button>
            </li>
          ))}
        </ol>
      )}
      {(ask.step || (ask.handoff && ask.handoff.expiresAt > now)) && other === null ? null : other === null ? (
        <button type="button" className={choice ? "ask-option is-else" : "btn is-quiet is-small"} onClick={() => setOther("")}>
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
          <div className="ask-other">
            <input
              id={`reply-${ask.id}`}
              autoFocus={!free}
              className="input"
              value={other}
              aria-label={`Reply to ${asker}`}
              title="Answers this card, in its thread"
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
