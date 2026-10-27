import { memo } from "react"

import { PermissionCard, PrChip, QuestionCard, TaskChip } from "~/chat/cards"
import { Text } from "~/chat/text"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago, clock } from "~/kit/time"
import type { Channel, Message } from "~/model"
import { useApp } from "~/nav"

const QUICK = ["👍", "🔥", "👀", "✅"]

export const MessageRow = memo(function MessageRow({ channel, m, compact, names, inThread }: { channel: Channel; m: Message; compact: boolean; names: Set<string>; inThread?: boolean }) {
  const { app, go } = useApp()
  const who = channel.people.find((p) => p.name === m.from)
  const ask = m.ask ? channel.asks.find((a) => a.id === m.ask) : undefined
  const quoted = m.replyTo ? channel.messages.find((q) => q.seq === m.replyTo) : undefined
  const openTask = (id: number) => go({ to: "panel", panel: { kind: "task", task: id } })

  if (m.system)
    return (
      <p className="sys">
        <span className="sys-line" />
        <span>{m.text}</span>
        <time>{clock(m.at)}</time>
      </p>
    )

  return (
    <article className={cx("msg", compact && "is-compact", m.mentionsYou && "is-for-you", m.pending && "is-pending")} aria-label={`${m.from}, ${clock(m.at)}`}>
      <div className="msg-gutter">{compact ? <time className="msg-time-hover">{clock(m.at)}</time> : <Avatar person={who} />}</div>
      <div className="msg-body">
        {!compact && (
          <p className="msg-head">
            <button type="button" className="msg-name" onClick={() => go({ to: "panel", panel: { kind: "person", name: m.from } })}>
              {m.from}
            </button>
            {who?.role && <span className="msg-role">{who.role}</span>}
            {who?.runs && <span className="msg-runs">· {who.runs}</span>}
            <time className="msg-time">{clock(m.at)}</time>
          </p>
        )}
        {quoted && (
          <p className="msg-quote">
            <span className="msg-quote-who">{quoted.from}</span> {quoted.text.slice(0, 140)}
          </p>
        )}
        <Text text={m.text} names={names} onTask={openTask} />
        {m.images && (
          <div className="msg-images">
            {m.images.map((img) => (
              <img key={img.url} src={img.url} alt={img.alt} width={img.width} height={img.height} />
            ))}
          </div>
        )}
        {m.task !== undefined && <TaskChip channel={channel} id={m.task} />}
        {m.pr && <PrChip pr={m.pr} />}
        {ask?.kind === "permission" && <PermissionCard channel={channel} ask={ask} />}
        {ask?.kind === "question" && <QuestionCard channel={channel} ask={ask} />}
        {(m.reactions?.length ?? 0) > 0 && (
          <div className="reacts">
            {m.reactions?.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={cx("react", r.by.includes(channel.you) && "is-mine")}
                title={r.by.join(", ")}
                aria-pressed={r.by.includes(channel.you)}
                onClick={() => app.actions.react(channel.code, m.seq, r.emoji)}
              >
                {r.emoji} <span className="num">{r.by.length}</span>
              </button>
            ))}
          </div>
        )}
        {m.thread && !inThread && (
          <button type="button" className="msg-thread" onClick={() => go({ to: "panel", panel: { kind: "thread", seq: m.seq } })}>
            <span className="msg-thread-n">
              {m.thread.replies} {m.thread.replies === 1 ? "reply" : "replies"}
            </span>
            <span className="dim">
              {m.thread.people.join(", ")} · {ago(m.thread.last)}
            </span>
          </button>
        )}
      </div>
      <div className="msg-tools" role="toolbar" aria-label="Message actions">
        {QUICK.map((e) => (
          <button key={e} type="button" className="msg-tool" aria-label={`React ${e}`} onClick={() => app.actions.react(channel.code, m.seq, e)}>
            {e}
          </button>
        ))}
        {!inThread && (
          <button type="button" className="msg-tool" aria-label="Reply in thread" title="Reply in thread" onClick={() => go({ to: "panel", panel: { kind: "thread", seq: m.seq } })}>
            <Icon name="reply" size={14} />
          </button>
        )}
        <button type="button" className="msg-tool" aria-label="Copy text" title="Copy text" onClick={() => void navigator.clipboard?.writeText(m.text)}>
          <Icon name="copy" size={14} />
        </button>
      </div>
    </article>
  )
})
