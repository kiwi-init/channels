import "~/styles/tasks.css"

import { Avatar, cx, Empty, statusWord } from "~/kit/bits"
import { ago, clock } from "~/kit/time"
import { contextOf, liveOf, restOf } from "~/doing"
import type { Channel, PullRequest, Task } from "~/model"
import { useApp } from "~/nav"
import { nickname, shown } from "~/names"
import { lanesOf, type Lane } from "~/now"

const MAX_TICKS = 8

function Ticks({ ticks }: { ticks: NonNullable<PullRequest["ticks"]> }) {
  const all = [...ticks.failed.map(() => "is-fail"), ...Array.from({ length: ticks.running }, () => "is-running"), ...Array.from({ length: ticks.passed }, () => "is-pass")].slice(0, MAX_TICKS)
  const label = [ticks.passed ? `${ticks.passed} passed` : null, ticks.failed.length ? `${ticks.failed.length} failed` : null, ticks.running ? `${ticks.running} running` : null]
    .filter(Boolean)
    .join(", ")
  return (
    <span className="ticks" role="img" aria-label={`Checks: ${label}`} title={ticks.failed.length ? `Failed: ${ticks.failed.join(", ")}` : label}>
      {all.map((c, i) => (
        <span key={i} className={cx("tick", c)} />
      ))}
    </span>
  )
}

function PrLine({ pr }: { pr: PullRequest }) {
  return (
    <span className="lane-pr">
      <a href={pr.url} target="_blank" rel="noreferrer" className="num">
        PR #{pr.number}
      </a>
      {pr.state !== "open" && pr.state !== "draft" ? <span>{pr.state}</span> : pr.ticks ? <Ticks ticks={pr.ticks} /> : <span>no checks yet</span>}
    </span>
  )
}

function Current({ t }: { t: Task }) {
  const { go } = useApp()
  return (
    <li className="lane-task">
      <button type="button" onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
        <span className="lane-title">{t.title}</span>
        <span className="lane-meta">
          <span className="num">T{t.id}</span> · {statusWord(t)} · {ago(t.updatedAt)}
        </span>
      </button>
      {t.pr && <PrLine pr={t.pr} />}
    </li>
  )
}

function LaneCard({ channel, lane }: { channel: Channel; lane: Lane }) {
  const { app, go } = useApp()
  const p = lane.person
  const live = liveOf(p)
  const context = app.computer?.contextLine ? contextOf(p) : null
  const line = live?.text ?? (p.presence === "online" ? restOf(p) : "offline")
  const sub = [p.sponsor ? `for ${nickname(channel, p.sponsor)}` : null, p.model].filter(Boolean).join(" · ")
  const empty = !lane.current.length && !lane.next.length && !lane.watching.length
  return (
    <section className="lane" aria-label={shown(p)}>
      <button type="button" className="lane-head" onClick={() => go({ to: "panel", panel: { kind: "person", name: p.name } })}>
        <Avatar person={p} pip />
        <span className="lane-who">
          <span className="lane-name">
            {nickname(channel, p.name)}
            {p.name === channel.lead && <span className="dim"> lead</span>}
          </span>
          {sub && <span className="lane-sub">{sub}</span>}
        </span>
      </button>
      <p className="lane-now">
        <span className={cx("lane-dot", live?.busy ? "is-busy" : p.presence === "online" ? "is-online" : "is-off")} aria-hidden="true" />
        <span className={cx("lane-doing", !live?.busy && "dim")}>{line}</span>
        {p.load?.level === "overloaded" && <span className="tone-alert">overloaded</span>}
        {context && <span className={cx("lane-context num", context.over ? "tone-alert" : "dim")}>{context.text}</span>}
      </p>
      {lane.current.length > 0 && (
        <ul className="lane-list">
          {lane.current.map((t) => (
            <Current key={t.id} t={t} />
          ))}
        </ul>
      )}
      {lane.next.length > 0 && (
        <div className="lane-group">
          <p className="lane-h">Up next</p>
          <ul>
            {lane.next.map((t) => (
              <li key={t.id}>
                <button type="button" className="lane-row" onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
                  <span className="lane-id num">T{t.id}</span>
                  <span className="lane-row-title">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {lane.watching.length > 0 && (
        <div className="lane-group">
          <p className="lane-h">Watching</p>
          <ul>
            {lane.watching.map((pr) => (
              <li key={pr.url} className="lane-row">
                <a href={pr.url} target="_blank" rel="noreferrer" className="lane-id num">
                  #{pr.number}
                </a>
                <span className="lane-row-title">{pr.title}</span>
                {pr.ticks && <Ticks ticks={pr.ticks} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {empty && <p className="lane-empty">Nothing on its plate.</p>}
      {lane.recent.length > 0 && (
        <ul className="lane-recent" aria-label="Recent">
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
  if (!lanes.length) return <Empty title="No agents yet.">Add one from the sidebar to see what it works on here.</Empty>
  return (
    <div className="lanes" role="region" aria-label="Agent lanes">
      {lanes.map((lane) => (
        <LaneCard key={lane.person.name} channel={channel} lane={lane} />
      ))}
    </div>
  )
}
