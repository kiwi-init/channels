import { useState, type ReactNode } from "react"

import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel, Task } from "~/model"
import { useApp } from "~/nav"
import { nickname, Shown } from "~/names"
import { nowOf, stageWords } from "~/now"

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

function TaskLine({ channel, t }: { channel: Channel; t: Task }) {
  const { go } = useApp()
  const stage = stageWords(t)
  return (
    <button type="button" className="now-task" onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
      <span className="now-id num">T{t.id}</span>
      <span className="now-title">
        <Shown value={t.title} />
      </span>
      {t.status === "waiting" && <span className="now-needs">needs you</span>}
      <span className={cx("now-stage", stage.red && "tone-alert")}>{[t.owner ? nickname(channel, t.owner) : null, stage.text].filter(Boolean).join(" · ")}</span>
    </button>
  )
}

export function NowCard({ channel }: { channel: Channel }) {
  const [folded, setFolded] = useState(readFolded)
  const now = nowOf(channel)
  const working = now.working.length + now.more
  const counts = [working ? `${working} in progress` : null, now.doneCount ? `${now.doneCount} done today` : null].filter(Boolean).join(" · ")
  const fold = () => {
    setFolded(!folded)
    keepFolded(!folded)
  }
  return (
    <section className="now" aria-label="Now">
      <button type="button" className="now-head" aria-expanded={!folded} onClick={fold}>
        <span className="now-name">Now</span>
        <span className="now-next">{now.next}</span>
        {counts && <span className="now-counts num">{counts}</span>}
        <Icon name="down" size={14} />
      </button>
      {!folded && (
        <div className="now-body">
          <Line label="In progress">
            {now.working.length ? (
              <>
                {now.working.map((t) => (
                  <TaskLine key={t.id} channel={channel} t={t} />
                ))}
                {now.more > 0 && <span className="now-more">+{now.more} more</span>}
              </>
            ) : (
              <span className="now-quiet">nothing right now</span>
            )}
          </Line>
          {now.doneCount > 0 && (
            <Line label="Done today">
              <span className="now-done">{now.done.map((t) => t.title).join(" · ")}</span>
            </Line>
          )}
        </div>
      )}
    </section>
  )
}
