import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"

import { taskId, type ChannelState } from "@kiwi/core/state.ts"
import { nowCard, type NowTask } from "@/lib/now"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"

const FOLDED_KEY = "kiwi:now:folded"

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED_KEY) === "1"
  } catch {
    // Private browsing can refuse storage: the card then opens unfolded.
    return false
  }
}

function writeFolded(folded: boolean): void {
  try {
    localStorage.setItem(FOLDED_KEY, folded ? "1" : "0")
  } catch {
    // Private browsing can refuse storage: the fold then lasts this load.
  }
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-baseline gap-x-3 py-1">
      <span className="text-meta text-ink-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function TaskLine({ t, nameOf, onOpenTask }: { t: NowTask; nameOf: (name: string) => string; onOpenTask: (id: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpenTask(t.id)}
      className="-mx-1.5 flex w-[calc(100%+12px)] min-w-0 items-baseline gap-2 rounded-row px-1.5 py-0.5 text-left text-ui transition-colors hover:bg-wash"
    >
      <span className="shrink-0 text-ink-3 tabular-nums">{taskId(t.id)}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
      {t.needsYou && <span className="shrink-0 text-meta font-semibold text-decide">needs you</span>}
      <span className={cx("hidden max-w-[45%] shrink-0 truncate text-meta @lg:block", t.red ? "text-alert" : "text-ink-2")}>
        {[t.owner ? nameOf(t.owner) : null, t.stage].filter(Boolean).join(" · ")}
      </span>
    </button>
  )
}

function Quiet({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  if (!onClick) return <span className="text-ui text-ink-2">{children}</span>
  return (
    <button type="button" onClick={onClick} className="text-ui text-ink underline decoration-line underline-offset-3 hover:decoration-ink-3">
      {children}
    </button>
  )
}

export function NowCard({
  state,
  clock,
  needs,
  nameOf,
  onOpenTask,
  onNeeds,
  onDone,
  needsRow,
  className,
}: {
  state: ChannelState
  clock: number
  needs: number
  nameOf: (name: string) => string
  onOpenTask: (id: number) => void
  onNeeds: () => void
  onDone: () => void
  needsRow: boolean
  className?: string
}) {
  const [folded, setFolded] = useState(readFolded)
  const now = nowCard(state, clock)
  const fold = () => {
    setFolded(!folded)
    writeFolded(!folded)
  }
  const working = now.working.length + now.moreWorking
  const summary = [working ? `${working} working` : "nobody working", needs ? `${needs} ${needs === 1 ? "needs" : "need"} you` : "nothing needs you", `${now.doneCount} done today`].join(" · ")
  return (
    <section aria-label="Now" className={cx("@container rounded-card border border-line bg-canvas px-3.5 py-2", className)}>
      <button type="button" aria-expanded={!folded} onClick={fold} className="flex w-full min-w-0 items-baseline gap-3 py-1 text-left">
        <span className="shrink-0 text-ui font-semibold text-ink">Now</span>
        <span className="min-w-0 flex-1 truncate text-ui text-ink-2">{folded ? [now.next, summary].filter(Boolean).join(" · ") : now.next}</span>
        <Icon icon={ArrowDown01Icon} size={15} className={cx("shrink-0 self-center text-ink-3 transition-transform", !folded && "rotate-180")} />
      </button>
      {!folded && (
        <div className="pb-1">
          <Line label="Working">
            {now.working.length ? (
              <>
                {now.working.map((t) => (
                  <TaskLine key={t.id} t={t} nameOf={nameOf} onOpenTask={onOpenTask} />
                ))}
                {now.moreWorking > 0 && <span className="block pt-0.5 text-meta text-ink-3">+{now.moreWorking} more</span>}
              </>
            ) : (
              <Quiet>nobody right now</Quiet>
            )}
          </Line>
          {needsRow && (
            <Line label="Needs you">
              {needs ? (
                <Quiet onClick={onNeeds}>
                  <span aria-hidden className="mr-1.5 inline-block size-1.5 translate-y-[-2px] rounded-full bg-alert" />
                  {needs} waiting
                </Quiet>
              ) : (
                <Quiet>nothing</Quiet>
              )}
            </Line>
          )}
          <Line label="Done today">
            {now.doneCount ? (
              <span className="flex min-w-0 items-baseline gap-2 text-ui">
                <Quiet onClick={onDone}>{now.doneCount}</Quiet>
                <span className="min-w-0 truncate text-ink-2">{now.done.map((t) => t.title).join(" · ")}</span>
              </span>
            ) : (
              <Quiet>nothing yet</Quiet>
            )}
          </Line>
        </div>
      )}
    </section>
  )
}
