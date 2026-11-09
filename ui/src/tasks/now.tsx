import "~/i18n/en/specs"
import { useState, type ReactNode } from "react"

import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel, Task } from "~/model"
import { useApp } from "~/nav"
import { nickname, Shown } from "~/names"
import { nowOf, stageWords } from "~/now"
import { wordsPlain } from "~/words"

const FOLDED = "kiwi:now:folded"

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED) !== "0"
  } catch {
    // Storage can be off (private windows, blocked site data): the card opens folded, its one line says enough.
    return true
  }
}

function keepFolded(folded: boolean): void {
  try {
    localStorage.setItem(FOLDED, folded ? "1" : "0")
  } catch {
    // Storage can be off: the fold lasts until the window reloads.
  }
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="now-line">
      <span className="now-label">{label}</span>
      <div className="now-value">{children}</div>
    </div>
  )
}

function TaskLine({ channel, task }: { channel: Channel; task: Task }) {
  const { go } = useApp()
  const stage = stageWords(task)
  return (
    <button type="button" className="now-task" onClick={() => go({ to: "panel", panel: { kind: "task", task: task.id } })}>
      <span className="now-id num">T{task.id}</span>
      <span className="now-title">
        <Shown value={task.title} />
      </span>
      {task.status === "waiting" && <span className="now-needs">{t("tasks.now.needs.you")}</span>}
      <span className={cx("now-stage", stage.red && "tone-alert")}>{[task.owner ? nickname(channel, task.owner) : null, stage.text].filter(Boolean).join(" · ")}</span>
    </button>
  )
}

export function NowCard({ channel }: { channel: Channel }) {
  const [folded, setFolded] = useState(readFolded)
  const now = nowOf(channel)
  const working = now.working.length + now.more
  const counts = [working ? t("tasks.now.in.progress.count", { count: working }) : null, now.doneCount ? t("tasks.now.done.today.count", { count: now.doneCount }) : null].filter(Boolean).join(" · ")
  const fold = () => {
    setFolded(!folded)
    keepFolded(!folded)
  }
  return (
    <section className="now" aria-label={t("tasks.now.label")}>
      <button type="button" className="now-head" aria-expanded={!folded} onClick={fold}>
        <span className="now-name">{t("tasks.now.label")}</span>
        <span className="now-next">{now.next}</span>
        {counts && <span className="now-counts num">{counts}</span>}
        <Icon name="down" size={14} />
      </button>
      {!folded && (
        <div className="now-body">
          <Line label={t("tasks.now.in.progress")}>
            {now.working.length ? (
              <>
                {now.working.map((task) => (
                  <TaskLine key={task.id} channel={channel} task={task} />
                ))}
                {now.more > 0 && <span className="now-more">{t("tasks.now.more", { count: now.more })}</span>}
              </>
            ) : (
              <span className="now-quiet">{t("tasks.now.nothing")}</span>
            )}
          </Line>
          {now.doneCount > 0 && (
            <Line label={t("tasks.now.done.today")}>
              <span className="now-done">{now.done.map((task) => wordsPlain(task.title, channel.nicknames)).join(" · ")}</span>
            </Line>
          )}
        </div>
      )}
    </section>
  )
}
