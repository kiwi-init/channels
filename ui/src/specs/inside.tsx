import { useState } from "react"

import { PrChip } from "~/chat/cards"
import { compactAt, useNames, useTaskIds } from "~/chat/conversation"
import { MessageRow } from "~/chat/message"
import { useWhole } from "~/chat/whole"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { Avatar, cx, Dot, statusWord } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Icon } from "~/kit/icons"
import { ago, clock } from "~/kit/time"
import type { Channel, Spec } from "~/model"
import { useAct } from "~/nav"
import { nickname, Shown } from "~/names"
import { alarmsOf, boxesOf, faceOf, insideOf, lastMove, storyOf, tasksOf, workersOf, type Alarm } from "~/specs/read"

const STORY_SHOWN = 5

const ALARM_WORDS: Record<Alarm["kind"], Key> = {
  changed: "specs.inside.alarm.changed",
  red: "specs.inside.alarm.red",
  stuck: "specs.inside.alarm.stuck",
  circling: "specs.inside.alarm.circling",
}

export function Inside({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { actions, go } = useAct()
  const names = useNames(channel)
  const taskIds = useTaskIds(channel)
  const [all, setAll] = useState(false)
  const [wire, setWire] = useState(false)
  const tasks = tasksOf(channel, spec)
  const alarms = alarmsOf(channel, spec)
  const story = storyOf(channel, spec)
  const shown = all ? story : story.slice(-STORY_SHOWN)
  const messages = insideOf(channel, spec)
  useWhole(channel.code, "spec", messages)
  const who = workersOf(channel, spec)
  const boxes = boxesOf(spec)
  const counted = tasks.filter((task) => !task.cancelled)
  const done = counted.filter((task) => task.status === "done").length
  const ask = () => {
    const lead = channel.lead && channel.lead !== channel.you ? channel.lead : null
    const where = channel.messages.find((m) => m.seq === spec.ask)?.where ?? { kind: "room" as const, room: "general" }
    actions.send(channel.code, where, `${lead ? `@${lead} ` : ""}where does this stand? A few lines for people, please: what's done, what's next, what might need us.`, { inThread: spec.ask })
  }
  return (
    <div className="spec-inside">
      {alarms.length > 0 && (
        <section className="inside-alarms" aria-label={t("specs.inside.alarms")}>
          {alarms.map((a) => (
            <p key={`${a.kind}-${a.task ?? 0}`} className={cx("inside-alarm", `is-${a.kind}`)}>
              <span className="inside-alarm-kind">{t(ALARM_WORDS[a.kind])}</span>
              <span>{a.text}</span>
              {a.task !== undefined && (
                <button type="button" className="btn is-quiet is-small" onClick={() => go({ to: "panel", panel: { kind: "task", task: a.task! } })}>
                  {t("specs.inside.open.task", { task: String(a.task) })}
                </button>
              )}
            </p>
          ))}
        </section>
      )}

      <div className="inside-cols">
        <section className="inside-lanes" aria-label={t("specs.inside.work")}>
          <h2 className="inside-h">
            <span className="inside-h-line num">
              <span className="inside-h-name">{t("specs.inside.work")}</span>
              {spec.stage !== "working" && counted.length > 0 && <span>{t("specs.inside.tasks.done", { done, total: counted.length })}</span>}
              {boxes.length > 0 && <span>{t("specs.inside.boxes.done", { done: boxes.filter((b) => b.done).length, total: boxes.length })}</span>}
              <span>{t("specs.inside.last.move", { when: ago(lastMove(channel, spec)) })}</span>
            </span>
            {who.length > 0 && (
              <span className="inside-faces" aria-label={who.map((n) => nickname(channel, n)).join(", ")}>
                {who.map((n) => (
                  <Avatar key={n} person={faceOf(channel, n)} size="sm" pip />
                ))}
              </span>
            )}
            {!spec.result && (
              <button type="button" className="btn is-quiet is-small" title={t("specs.inside.ask.title")} onClick={ask}>
                {t("specs.inside.ask")}
              </button>
            )}
          </h2>
          {tasks.length ? (
            <ul className="inside-tasks">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button type="button" className={cx("inside-task", task.cancelled && "is-cancelled")} onClick={() => go({ to: "panel", panel: { kind: "task", task: task.id } })}>
                    <Dot status={task.cancelled ? "todo" : task.status} />
                    <span className="inside-task-title">
                      <Shown value={task.title} />
                    </span>
                    <span className="inside-task-meta num">
                      <span>T{task.id}</span>
                      {(task.cancelled || task.status === "waiting") && <span className={cx(task.status === "waiting" && !task.cancelled && "tone-decide")}>{statusWord(task)}</span>}
                      <span>{ago(task.updatedAt)}</span>
                    </span>
                  </button>
                  {task.pr && <PrChip pr={task.pr} />}
                  {task.owner && (
                    <span className="inside-task-face" title={nickname(channel, task.owner)}>
                      <Avatar person={faceOf(channel, task.owner)} size="sm" />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="inside-none">{spec.stage === "draft" ? t("specs.inside.none.draft") : t("specs.inside.none.queued")}</p>
          )}
          {spec.approved && !spec.result && !spec.changed && <AddStep channel={channel} spec={spec} />}
        </section>

        <section className="inside-story" aria-label={t("specs.inside.story")}>
          <h2 className="inside-h">
            <span className="inside-h-name">{t("specs.inside.story")}</span>
            {story.length > STORY_SHOWN && (
              <button type="button" className="btn is-quiet is-small" aria-expanded={all} onClick={() => setAll(!all)}>
                {all ? t("specs.inside.latest.only") : t("specs.inside.all", { count: story.length })}
              </button>
            )}
          </h2>
          {shown.length ? (
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
          ) : (
            <p className="inside-none">{t("specs.inside.nothing.yet")}</p>
          )}
        </section>
      </div>

      <section className="inside-wire" aria-label={t("specs.inside.wire")}>
        <button type="button" className="inside-wire-toggle" aria-expanded={wire} onClick={() => setWire(!wire)}>
          <span className="sys-line" />
          <span>{wire ? t("specs.inside.hide.messages") : t("specs.inside.messages", { count: messages.length })}</span>
        </button>
        {wire &&
          (messages.length ? (
            <div className="inside-wire-list">
              {messages.map((m, i) => (
                <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(messages, i)} names={names} tasks={taskIds} inThread />
              ))}
            </div>
          ) : (
            <Empty title={t("specs.inside.empty")} />
          ))}
      </section>
    </div>
  )
}

function AddStep({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { actions } = useAct()
  const [title, setTitle] = useState("")
  return (
    <form
      className="board-new inside-add"
      onSubmit={(e) => {
        e.preventDefault()
        const text = title.trim()
        if (!text) return
        actions.addTask(channel.code, spec.ask, text)
        setTitle("")
      }}
    >
      <Icon name="plus" />
      <input className="board-new-input" value={title} aria-label={t("specs.inside.add.task")} placeholder={t("specs.inside.add.task")} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" className="btn is-small" disabled={!title.trim()}>
        {t("specs.inside.add")}
      </button>
    </form>
  )
}
