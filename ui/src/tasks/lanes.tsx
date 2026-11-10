import "~/i18n/en/specs"
import "~/styles/tasks.css"

import { t } from "~/i18n/i18n"
import { Avatar, cx, statusWord } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { ago, clock } from "~/kit/time"
import { contextOf, liveOf, restOf } from "~/doing"
import type { Channel, PullRequest, Task } from "~/model"
import { useApp, useGo } from "~/nav"
import { TONES } from "~/tasks/tones"
import { nickname, shown, Shown } from "~/names"
import { lanesOf, type Lane } from "~/now"
import { OutsideLink } from "~/kit/outside"
import { personGo } from "~/person-go"

const MAX_TICKS = 8

function Ticks({ ticks }: { ticks: NonNullable<PullRequest["ticks"]> }) {
  const all = [...ticks.failed.map(() => "is-fail"), ...Array.from({ length: ticks.running }, () => "is-running"), ...Array.from({ length: ticks.passed }, () => "is-pass")].slice(0, MAX_TICKS)
  const label = [
    ticks.passed ? t("tasks.lanes.passed", { count: ticks.passed }) : null,
    ticks.failed.length ? t("tasks.lanes.failed", { count: ticks.failed.length }) : null,
    ticks.running ? t("tasks.lanes.running", { count: ticks.running }) : null,
  ]
    .filter(Boolean)
    .join(", ")
  return (
    <span className="ticks" role="img" aria-label={t("tasks.lanes.checks", { list: label })} title={ticks.failed.length ? t("tasks.lanes.failed.checks", { list: ticks.failed.join(", ") }) : label}>
      {all.map((c, i) => (
        <span key={i} className={cx("tick", c)} />
      ))}
    </span>
  )
}

function PrLine({ pr }: { pr: PullRequest }) {
  return (
    <span className="lane-pr">
      <OutsideLink href={pr.url} className="num">
        {t("tasks.lanes.pr", { number: String(pr.number) })}
      </OutsideLink>
      {pr.state === "merged" || pr.state === "closed" ? (
        <span>{t(pr.state === "merged" ? "tasks.lanes.merged" : "tasks.lanes.closed")}</span>
      ) : pr.ticks ? (
        <Ticks ticks={pr.ticks} />
      ) : (
        <span>{t("tasks.lanes.no.checks")}</span>
      )}
    </span>
  )
}

function Current({ task }: { task: Task }) {
  const go = useGo()
  return (
    <li className="lane-task">
      <button type="button" onClick={() => go({ to: "task", task: task.id })}>
        <span className="lane-title">
          <Shown value={task.title} />
        </span>
        <span className="lane-meta">
          <span className="num">T{task.id}</span>
          {task.status !== "doing" && <span className={TONES[task.status]}> · {statusWord(task)}</span>} · {ago(task.updatedAt)}
        </span>
      </button>
      {task.pr && <PrLine pr={task.pr} />}
    </li>
  )
}

function LaneCard({ channel, lane }: { channel: Channel; lane: Lane }) {
  const { app, go } = useApp()
  const p = lane.person
  const live = liveOf(p)
  const context = app.computer?.contextLine ? contextOf(p) : null
  const line = live?.text ?? (p.presence === "online" ? restOf(p) : t("tasks.lanes.offline"))
  const sponsor = p.sponsor && p.sponsor !== channel.you ? t("tasks.lanes.for", { who: nickname(channel, p.sponsor) }) : null
  const about = [p.sponsor ? t("tasks.lanes.for", { who: nickname(channel, p.sponsor) }) : null, p.model].filter(Boolean).join(" · ")
  return (
    <section className="lane" aria-label={shown(p)}>
      <button type="button" className="lane-head" title={about || undefined} onClick={() => go(personGo(channel, p.name))}>
        <Avatar person={p} pip />
        <span className="lane-who">
          <span className="lane-name">
            {nickname(channel, p.name)}
            {p.name === channel.lead && <span className="dim"> {t("tasks.lanes.lead")}</span>}
          </span>
          <span className="lane-sub">
            <span className={cx(live?.busy && "tone-doing")}>{line}</span>
            {p.load?.level === "overloaded" && <span className="tone-alert"> · {t("tasks.lanes.overloaded")}</span>}
            {sponsor && <span> · {sponsor}</span>}
          </span>
        </span>
        {context && <span className={cx("lane-context num", context.over ? "tone-alert" : "dim")}>{context.text}</span>}
      </button>
      {lane.current.length > 0 && (
        <ul className="lane-list">
          {lane.current.map((task) => (
            <Current key={task.id} task={task} />
          ))}
        </ul>
      )}
      {lane.next.length > 0 && (
        <div className="lane-group">
          <p className="lane-h">{t("tasks.lanes.up.next")}</p>
          <ul>
            {lane.next.map((task) => (
              <li key={task.id}>
                <button type="button" className="lane-row" onClick={() => go({ to: "task", task: task.id })}>
                  <span className="lane-id num">T{task.id}</span>
                  <span className="lane-row-title">
                    <Shown value={task.title} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {lane.watching.length > 0 && (
        <div className="lane-group">
          <p className="lane-h">{t("tasks.lanes.watching")}</p>
          <ul>
            {lane.watching.map((pr) => (
              <li key={pr.url} className="lane-row">
                <OutsideLink href={pr.url} className="lane-id num">
                  #{pr.number}
                </OutsideLink>
                <span className="lane-row-title">{pr.title}</span>
                {pr.ticks && <Ticks ticks={pr.ticks} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {lane.recent.length > 0 && (
        <ul className="lane-recent" aria-label={t("tasks.lanes.recent")}>
          {lane.recent.map((e) => (
            <li key={e.seq}>
              <time className="num">{clock(e.at)}</time>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Lanes({ channel }: { channel: Channel }) {
  const lanes = lanesOf(channel)
  if (!lanes.length)
    return (
      <Empty title={t("tasks.lanes.empty")} icon="agent">
        {t("tasks.lanes.empty.hint")}
      </Empty>
    )
  return (
    <div className="lanes" role="region" aria-label={t("tasks.lanes.label")}>
      {channel.reviewStillRequired && (
        <p className="lanes-warning" role="note">
          {t("tasks.lanes.review.warning", { branches: channel.reviewStillRequired.repos.join(", "), check: channel.reviewStillRequired.check })}
        </p>
      )}
      {lanes.map((lane) => (
        <LaneCard key={lane.person.name} channel={channel} lane={lane} />
      ))}
    </div>
  )
}
