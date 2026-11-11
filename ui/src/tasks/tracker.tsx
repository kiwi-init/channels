import "~/i18n/en/specs"
import "~/styles/tracker.css"

import { Suspense, useState } from "react"

import { useActivity } from "~/chat/activity"
import { t } from "~/i18n/i18n"
import { Dot, STATUS_WORDS } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { later } from "~/kit/later"
import type { Channel, Task, TaskStatus } from "~/model"
import { useGo } from "~/nav"
import { nickname, Shown } from "~/names"
import { nowOf } from "~/now"
import { keepTab, readTab, type TrackTab } from "~/tasks/track-tab"
import { wordsPlain } from "~/words"

const Log = later(() => import("~/chat/updates-panel").then((m) => m.Log))

const SHOWN = 8
const ORDER: readonly TaskStatus[] = ["waiting", "doing", "review", "landing", "todo"]
const BAR: readonly TaskStatus[] = ["done", "landing", "review", "doing", "waiting", "todo"]

const stepsOf = (task: Task): string | null => {
  const steps = task.steps?.filter((s) => s.state !== "skipped") ?? []
  return steps.length ? `${steps.filter((s) => s.state === "done").length}/${steps.length}` : null
}

export function Tracker({ channel }: { channel: Channel }) {
  const activity = useActivity()
  const target = activity?.target ?? null
  const [tab, setTab] = useState(readTab)
  const [reached, setReached] = useState<number | null>(null)
  if (target !== reached) {
    setReached(target)
    if (target !== null) setTab("activity")
  }
  const now = nowOf(channel)
  const open = channel.tasks.filter((x) => !x.archived && !x.cancelled && x.status !== "done").sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updatedAt - a.updatedAt)
  const done = now.doneCount
  const total = open.length + done
  if (!total && !activity) return null
  const log = !!activity && (tab === "activity" || !total)
  const name = log ? t("chat.events.updates") : t("tasks.now.label")
  const pick = (next: TrackTab) => {
    setTab(next)
    keepTab(next)
  }
  const count = (status: TaskStatus): number => (status === "done" ? done : open.filter((x) => x.status === status).length)
  const working = now.working.length + now.more
  const counts = [working ? t("tasks.now.in.progress.count", { count: working }) : null, done ? t("tasks.now.done.today.count", { count: done }) : null].filter(Boolean).join(" · ")
  return (
    <aside className="track" aria-label={name}>
      <div className="track-head">
        {total > 0 && activity ? (
          <Track className="seg" role="group" aria-label={t("tasks.now.shows")}>
            <button type="button" aria-pressed={!log} onClick={() => pick("now")}>
              {t("tasks.now.label")}
            </button>
            <button type="button" aria-pressed={log} onClick={() => pick("activity")}>
              {t("chat.events.updates")}
            </button>
          </Track>
        ) : (
          <h2 className="track-name">{name}</h2>
        )}
        {!log && counts && <span className="track-counts num">{counts}</span>}
      </div>
      {log ? (
        <Suspense fallback={null}>
          <Log channel={channel} runs={activity.runs} here={activity.here} target={target} />
        </Suspense>
      ) : (
        <Now channel={channel} open={open} count={count} counts={counts} next={now.next} />
      )}
    </aside>
  )
}

function Now({ channel, open, count, counts, next }: { channel: Channel; open: readonly Task[]; count: (status: TaskStatus) => number; counts: string; next: string | null }) {
  const go = useGo()
  return (
    <>
      <div className="track-bar" role="img" aria-label={counts}>
        {BAR.map((status) => {
          const n = count(status)
          return n ? <span key={status} className={`track-seg is-${status}`} style={{ flexGrow: n }} title={`${n} ${STATUS_WORDS[status]}`} /> : null
        })}
      </div>
      {next && <p className="track-next">{next}</p>}
      <ul className="track-list">
        {open.slice(0, SHOWN).map((task) => {
          const steps = stepsOf(task)
          return (
            <li key={task.id}>
              <button
                type="button"
                className="side-row track-row"
                title={[`T${task.id}`, STATUS_WORDS[task.status], task.owner ? nickname(channel, task.owner) : null, wordsPlain(task.title, channel.nicknames)].filter(Boolean).join(" · ")}
                onClick={() => go({ to: "task", task: task.id })}
              >
                <span className="side-icon">
                  <Dot status={task.status} />
                </span>
                <span className="side-label">
                  <Shown value={task.title} />
                </span>
                {steps && <span className="track-steps num">{steps}</span>}
              </button>
            </li>
          )
        })}
        {open.length > SHOWN && (
          <li>
            <button type="button" className="side-row is-add track-row" onClick={() => go({ to: "spec", ask: null })}>
              <span className="side-icon" />
              <span className="side-label">{t("tasks.now.more", { count: open.length - SHOWN })}</span>
            </button>
          </li>
        )}
      </ul>
    </>
  )
}
