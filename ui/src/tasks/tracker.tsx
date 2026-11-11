import "~/i18n/en/specs"
import "~/styles/tracker.css"

import { t } from "~/i18n/i18n"
import { Dot, STATUS_WORDS } from "~/kit/bits"
import type { Channel, Task, TaskStatus } from "~/model"
import { useGo } from "~/nav"
import { nickname, Shown } from "~/names"
import { nowOf } from "~/now"
import { wordsPlain } from "~/words"

const SHOWN = 8
const ORDER: readonly TaskStatus[] = ["waiting", "doing", "review", "landing", "todo"]
const BAR: readonly TaskStatus[] = ["done", "landing", "review", "doing", "waiting", "todo"]

const stepsOf = (task: Task): string | null => {
  const steps = task.steps?.filter((s) => s.state !== "skipped") ?? []
  return steps.length ? `${steps.filter((s) => s.state === "done").length}/${steps.length}` : null
}

export function Tracker({ channel }: { channel: Channel }) {
  const go = useGo()
  const now = nowOf(channel)
  const open = channel.tasks.filter((x) => !x.archived && !x.cancelled && x.status !== "done").sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updatedAt - a.updatedAt)
  const done = now.doneCount
  const total = open.length + done
  if (!total) return null
  const count = (status: TaskStatus): number => (status === "done" ? done : open.filter((x) => x.status === status).length)
  const working = now.working.length + now.more
  const counts = [working ? t("tasks.now.in.progress.count", { count: working }) : null, done ? t("tasks.now.done.today.count", { count: done }) : null].filter(Boolean).join(" · ")
  return (
    <aside className="track" aria-label={t("tasks.now.label")}>
      <h2 className="track-head">
        {t("tasks.now.label")} {counts && <span className="track-counts num">{counts}</span>}
      </h2>
      <div className="track-bar" role="img" aria-label={counts}>
        {BAR.map((status) => {
          const n = count(status)
          return n ? <span key={status} className={`track-seg is-${status}`} style={{ flexGrow: n }} title={`${n} ${STATUS_WORDS[status]}`} /> : null
        })}
      </div>
      {now.next && <p className="track-next">{now.next}</p>}
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
    </aside>
  )
}
