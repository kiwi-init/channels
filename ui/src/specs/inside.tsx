import { useState } from "react"

import { PrChip } from "~/chat/cards"
import { compactAt, useNames, useTaskIds } from "~/chat/conversation"
import { MessageRow } from "~/chat/message"
import { Avatar, cx, Dot, Empty, statusWord } from "~/kit/bits"
import { ago, clock } from "~/kit/time"
import type { Channel, Spec } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { alarmsOf, boxesOf, faceOf, insideOf, lastMove, stageLine, storyOf, tasksOf, workersOf } from "~/specs/read"

const STORY_SHOWN = 12

export function Inside({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { actions, go } = useAct()
  const names = useNames(channel)
  const taskIds = useTaskIds(channel)
  const [all, setAll] = useState(false)
  const [wire, setWire] = useState(false)
  const line = stageLine(channel, spec)
  const tasks = tasksOf(channel, spec)
  const alarms = alarmsOf(channel, spec)
  const story = storyOf(channel, spec)
  const shown = all ? story : story.slice(-STORY_SHOWN)
  const messages = insideOf(channel, spec)
  const who = workersOf(channel, spec)
  const boxes = boxesOf(spec)
  const counted = tasks.filter((t) => !t.cancelled)
  const done = counted.filter((t) => t.status === "done").length
  const ask = () => {
    const lead = channel.lead && channel.lead !== channel.you ? channel.lead : null
    const where = channel.messages.find((m) => m.seq === spec.ask)?.where ?? { kind: "room" as const, room: "general" }
    actions.send(channel.code, where, `${lead ? `@${lead} ` : ""}where does this stand? A few lines for people, please: what's done, what's next, what might need us.`, { inThread: spec.ask })
  }
  return (
    <div className="spec-inside">
      <section className="inside-glance" aria-label="At a glance">
        <span className={cx("inside-pulse", line.tone)} aria-hidden="true" />
        <span className="inside-glance-line num">
          <span className={line.tone}>{line.word}</span>
          {who.length > 0 && <span>{who.length === 1 ? "1 agent" : `${who.length} agents`}</span>}
          <span>
            {done} of {counted.length} tasks done
          </span>
          {boxes.length > 0 && (
            <span>
              {boxes.filter((b) => b.done).length}/{boxes.length} done when
            </span>
          )}
          <span>last move {ago(lastMove(channel, spec))}</span>
        </span>
        <span className="inside-faces" aria-hidden="true">
          {who.map((n) => (
            <Avatar key={n} person={faceOf(channel, n)} size="sm" pip />
          ))}
        </span>
        <button type="button" className="btn is-quiet is-small" onClick={ask}>
          Ask the lead where it stands
        </button>
      </section>

      {alarms.length > 0 && (
        <section className="inside-alarms" aria-label="Worth a look">
          {alarms.map((a) => (
            <p key={`${a.kind}-${a.task ?? 0}`} className={cx("inside-alarm", `is-${a.kind}`)}>
              <span className="inside-alarm-kind">{a.kind === "changed" ? "changed" : a.kind === "red" ? "checks failed" : a.kind}</span>
              <span>{a.text}</span>
              {a.task !== undefined && (
                <button type="button" className="btn is-quiet is-small" onClick={() => go({ to: "panel", panel: { kind: "task", task: a.task! } })}>
                  Open T{a.task}
                </button>
              )}
            </p>
          ))}
        </section>
      )}

      <section className="inside-lanes" aria-label="The work">
        <h2 className="inside-h">The work</h2>
        {tasks.length ? (
          <ul className="inside-tasks">
            {tasks.map((t) => (
              <li key={t.id}>
                <button type="button" className={cx("inside-task", t.cancelled && "is-cancelled")} onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
                  <Dot status={t.cancelled ? "todo" : t.status} />
                  <span className="inside-task-title">{t.title}</span>
                  <span className="inside-task-meta num">
                    <span>T{t.id}</span>
                    {t.owner && <span>{nickname(channel, t.owner)}</span>}
                    <span>{statusWord(t)}</span>
                    <span>{ago(t.updatedAt)}</span>
                  </span>
                  {t.owner && <Avatar person={faceOf(channel, t.owner)} size="sm" />}
                </button>
                {t.pr && <PrChip pr={t.pr} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="inside-none">{spec.stage === "draft" ? "No work yet: it starts once someone approves the spec." : "No tasks yet: the first free agent splits the spec into tasks."}</p>
        )}
      </section>

      <section className="inside-story" aria-label="What happened">
        <h2 className="inside-h">
          What happened
          {story.length > STORY_SHOWN && (
            <button type="button" className="btn is-quiet is-small" onClick={() => setAll(!all)}>
              {all ? "Latest only" : `All ${story.length}`}
            </button>
          )}
        </h2>
        <ol className="story">
          {shown.map((s, i) => (
            <li key={`${s.at}-${i}`} className="story-line">
              <time className="story-time">{clock(s.at)}</time>
              <Avatar person={faceOf(channel, s.who)} size="sm" />
              <span className="story-text">
                <span className="story-who">{nickname(channel, s.who)}</span> <span className={s.tone}>{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="inside-wire" aria-label="Every message">
        <button type="button" className="inside-wire-toggle" aria-expanded={wire} onClick={() => setWire(!wire)}>
          <span className="sys-line" />
          <span>{wire ? "Hide the messages" : `Every message inside: ${messages.length}, between ${new Set(messages.map((m) => m.from)).size} members`}</span>
        </button>
        {wire &&
          (messages.length ? (
            <div className="inside-wire-list">
              {messages.map((m, i) => (
                <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(messages, i)} names={names} tasks={taskIds} inThread />
              ))}
            </div>
          ) : (
            <Empty title="Nothing said inside yet." />
          ))}
      </section>
    </div>
  )
}
