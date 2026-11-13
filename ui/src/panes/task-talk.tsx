import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Composer } from "~/chat/composer"
import { compactAt, quoteOf, useNames, useTaskIds } from "~/chat/conversation"
import { EditHere } from "~/chat/editing"
import { MessageRow } from "~/chat/message"
import { QuotePick } from "~/chat/quote-pick"
import { jumpTo, ReplyContext, replyTo, type Quoting, type Replying } from "~/chat/reply"
import { useWhole } from "~/chat/whole"
import { Heading } from "~/kit/bits"
import { openMessage } from "~/live/open-message"
import { memberOf, type Channel, type Task } from "~/model"
import { t } from "~/i18n/i18n"

const QUOTABLE = ".msg-body .md, .task-detail"

export function TaskTalk({ channel, task, more, children }: { channel: Channel; task: Task; more: ReactNode; children: ReactNode }) {
  const id = task.id
  const talk = useMemo(() => channel.messages.filter((m) => m.where.kind === "task" && m.where.task === id), [channel.messages, id])
  useWhole(channel.code, "task", talk)
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const bySeq = useMemo(() => new Map(channel.messages.map((m) => [m.seq, m])), [channel.messages])
  const body = useRef<HTMLDivElement>(null)
  const onQuote = useCallback(
    (seq: number) => {
      if (!jumpTo(body.current, seq)) openMessage(channel.code, seq)
    },
    [channel.code]
  )
  const where = `${channel.code}\n${id}`
  const [reply, setReply] = useState<{ where: string; quoting: Quoting } | null>(null)
  if (reply && reply.where !== where) setReply(null)
  const replying = useMemo((): Replying => ({ quoting: reply?.where === where ? reply.quoting : null, set: (quoting) => setReply(quoting ? { where, quoting } : null) }), [reply, where])
  const quoteMessage = useCallback(
    (seq: number, excerpt: string) => {
      const m = talk.find((x) => x.seq === seq)
      if (m) setReply({ where, quoting: replyTo(m, excerpt) })
    },
    [talk, where]
  )
  const quoteTask = useCallback((task: number, excerpt: string) => setReply({ where, quoting: { kind: "task", task, excerpt } }), [where])
  const last = talk.at(-1)?.seq
  const seen = useRef({ id, last })
  useLayoutEffect(() => {
    const was = seen.current
    seen.current = { id, last }
    if (was.id === id && was.last !== last) body.current?.scrollTo({ top: body.current.scrollHeight })
  }, [id, last])
  const may = !memberOf(channel, channel.you)?.readOnly
  return (
    <ReplyContext.Provider value={may ? replying : null}>
      <EditHere.Provider value="panel">
        <div className="panel is-pane task-page">
          {may && <QuotePick root={body} body={QUOTABLE} onQuote={quoteMessage} onQuoteTask={quoteTask} />}
          <div ref={body} className="page is-task">
            <article className="page-text">
              {children}
              {talk.length > 0 && (
                <section className="task-talk">
                  <Heading>{t("panels.task.conversation")}</Heading>
                  {talk.map((m, i) => (
                    <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(talk, i)} names={names} tasks={tasks} inThread quote={quoteOf(talk, i, bySeq)} onQuote={onQuote} />
                  ))}
                </section>
              )}
            </article>
          </div>
          <Composer key={`compose-${id}`} channel={channel} where={{ kind: "task", task: id }} placeholder={t("panels.task.message.in", { task: String(id) })} />
          {more}
        </div>
      </EditHere.Provider>
    </ReplyContext.Provider>
  )
}
