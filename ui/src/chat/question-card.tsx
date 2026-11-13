import "~/i18n/en/chat-later"
import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { useEffect, useMemo, useState } from "react"

import { HANDOFF_DONE, HANDOFF_FAILED } from "@kiwi/core/protocol.ts"
import { openOutside } from "~/kit/outside"
import { wordsPlain, wordsRaw, wordsSame } from "~/words"
import { Body } from "~/chat/body"
import { jumpTo } from "~/chat/reply"
import { InlineLinks, InlineText } from "~/chat/inline-text"
import { StepAnswer, StepHow } from "~/chat/step"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { cx } from "~/kit/bits"
import { GlyphIcon } from "~/kit/icons"
import { clock } from "~/kit/time"
import { announce } from "~/kit/toasts"
import type { Channel, QuestionAsk } from "~/model"
import { openMessage } from "~/live/open-message"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { viewImage } from "~/chat/image-view"

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
  if (handoff.expiresAt <= Date.now()) return announce(t("chat.question.card.link.expired.toast"), "error")
  openOutside(handoff.url, () => announce(t("chat.question.card.browser.failed"), "error"))
}

function HandoffLink({ handoff, now }: { handoff: Handoff; now: number }) {
  if (handoff.expiresAt <= now) return <p className="ask-state">{t("chat.question.card.link.expired", { label: handoff.label })}</p>
  const minutes = Math.max(1, Math.ceil((handoff.expiresAt - now) / 60_000))
  return (
    <div className="ask-handoff">
      <button type="button" className="btn is-primary is-small" onClick={() => openBrowser(handoff)}>
        <GlyphIcon glyph={LinkSquare02Icon} size={14} />
        {t("chat.question.card.open.browser")}
      </button>
      <span className="ask-state">{t("chat.question.card.expires.in", { label: handoff.label, minutes })}</span>
    </div>
  )
}

type Closed = NonNullable<QuestionAsk["closed"]>

function seeAsk(code: string, seq: number): void {
  if (!jumpTo(document.body, seq)) openMessage(code, seq)
}

const openImage = viewImage

function ClosedAsk({ channel, closed }: { channel: Channel; closed: Closed }) {
  const who = closed.by === channel.you ? t("chat.question.card.you") : nickname(channel, closed.by)
  const parts = closed.why ? wordsPlain(closed.why, channel.nicknames).split(/(#\d+)/) : []
  return (
    <div className="ask-done">
      <p>{tr("chat.question.card.closed.by", { who, time: <time>{clock(closed.at)}</time> })}</p>
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
    const who = ask.answer.by === channel.you ? t("chat.question.card.you.start") : nickname(channel, ask.answer.by)
    const at = <time>{clock(ask.answer.at)}</time>
    const reply = wordsRaw(ask.answer.text)
    if (ask.handoff && (reply === HANDOFF_DONE || reply === HANDOFF_FAILED))
      return <p className="ask-done">{tr(reply === HANDOFF_DONE ? "chat.question.card.finished.browser" : "chat.question.card.not.finished.browser", { who, time: at })}</p>
    const verb = ask.step ? "chat.question.card.answered" : "chat.question.card.replied"
    const answer = ask.answer
    if (answer.shownIn === "feed")
      return (
        <p className="ask-done">
          {tr(verb, { who, time: at })} ·{" "}
          <button type="button" className="ask-seq" onClick={() => seeAsk(channel.code, answer.seq)}>
            {t("chat.question.card.show.reply")}
          </button>
        </p>
      )
    if (ask.options.some((o) => wordsSame(o, answer.text)))
      return <p className="ask-done">{tr("chat.question.card.chose", { who, choice: <b>{wordsPlain(answer.text, channel.nicknames)}</b>, time: at })}</p>
    return (
      <div className="ask-done">
        <p>{tr(verb, { who, time: at })}</p>
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
            {t("chat.question.card.done")}
          </button>
          <button type="button" className="btn is-quiet is-small" onClick={() => actions.answerQuestion(channel.code, ask.id, HANDOFF_FAILED)}>
            {t("chat.question.card.couldnt")}
          </button>
          <button type="button" className="btn is-quiet is-small" onClick={() => setOther("")}>
            {t("chat.question.card.something.else")}
          </button>
        </div>
      )}
      {ask.step && <StepHow step={ask.step} you={[channel.you, nickname(channel, channel.you)]} text={(s) => <InlineText text={s} channel={channel} before={Number(ask.id)} />} />}
      {ask.step && other === null && <StepAnswer onAnswer={(reply) => actions.answerStep(channel.code, ask.id, reply)} onElse={() => setOther("")} />}
      {ask.options.length > 0 && (
        <ol className="ask-options">
          {ask.options.map((o, i) => (
            <li key={wordsRaw(o)}>
              <button type="button" className="ask-option" onClick={() => actions.answerQuestion(channel.code, ask.id, wordsRaw(o))}>
                <span className="ask-letter">{String.fromCharCode(65 + i)}</span>
                {wordsPlain(o, channel.nicknames)}
              </button>
              <InlineLinks text={wordsRaw(o)} channel={channel} before={Number(ask.id)} />
            </li>
          ))}
        </ol>
      )}
      {(ask.step || (ask.handoff && ask.handoff.expiresAt > now)) && other === null ? null : other === null ? (
        <button type="button" className={choice ? "ask-option is-else" : "btn is-quiet is-small"} onClick={() => setOther("")}>
          {t("chat.question.card.something.else")}
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
              aria-label={t("chat.question.card.reply.to", { asker })}
              title={t("chat.question.card.reply.title")}
              onChange={(e) => setOther(e.target.value)}
              placeholder={t("chat.question.card.reply.placeholder", { asker })}
              onKeyDown={(e) => e.key === "Escape" && !free && setOther(null)}
            />
            <button type="submit" className="btn is-primary is-small" disabled={!other.trim()}>
              {t("chat.question.card.reply")}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
