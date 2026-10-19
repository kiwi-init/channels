import type { LiveCard } from "@kiwi/core/standup.ts"
import type { TaskState } from "@kiwi/core/protocol.ts"
import { colorOf, taskId, tasksAwaitingPeople, type ChannelState } from "@kiwi/core/state.ts"
import { formatAgo, memberName } from "@/lib/format"
import { labelOf, stateWord, YOUR_REVIEW } from "@/lib/task-labels"
import { cx } from "@/lib/utils"
import { Monogram } from "./kit"
import { isAgent } from "./message"
import { DecisionMark, StateMark } from "./tasks"

const TONE: Record<TaskState, { tone: string; pulse?: boolean }> = {
  todo: { tone: "text-ink-3" },
  doing: { tone: "text-doing", pulse: true },
  review: { tone: "text-accent-text" },
  done: { tone: "text-live" },
}

export function LiveTaskCard({ id, card, state, now, onOpen }: { id: number; card: LiveCard | undefined; state: ChannelState; now: number; onOpen: (task: number) => void }) {
  if (!card) return null
  const { task, waiting, lastLine } = card
  const live = TONE[task.state]
  const asked = tasksAwaitingPeople(state).has(task.id)
  const owner = task.owner ? state.members.get(task.owner) : undefined
  return (
    <div className="pl-11">
      <button
        type="button"
        onClick={() => onOpen(id)}
        aria-label={`Open ${taskId(id)}, ${task.title}`}
        title={`${labelOf(task)} · ${formatAgo(task.updatedAt, now)}`}
        className={cx(
          "my-1 flex w-full max-w-[560px] min-w-0 flex-col gap-1 rounded-row px-3 py-2 text-left text-ui shadow-[inset_0_0_0_1px_var(--line)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--edge-strong)]",
          (asked || waiting) && "shadow-[inset_0_0_0_1px_var(--decide)]"
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {task.owner ? <Monogram name={memberName(owner, task.owner)} agent={isAgent(owner)} color={colorOf(state, task.owner)} size={18} /> : <StateMark state={task.state} />}
          <span className="shrink-0 text-ink-3 tabular-nums">{taskId(id)}</span>
          <span className="min-w-0 flex-1 truncate text-ink">{task.title}</span>
          {asked ? (
            <DecisionMark />
          ) : waiting ? (
            <span className="shrink-0 text-meta font-semibold whitespace-nowrap text-decide">{YOUR_REVIEW}</span>
          ) : (
            <span className={cx("flex shrink-0 items-center gap-1.5 text-meta", live.tone)}>
              {live.pulse && !task.cancelled && <span aria-hidden className="size-1.5 rounded-full bg-doing shadow-[0_0_0_3px_color-mix(in_srgb,var(--doing)_18%,transparent)]" />}
              {stateWord(task)}
            </span>
          )}
        </span>
        {lastLine && (
          <span className="flex min-w-0 gap-1.5 pl-7 text-meta text-ink-3">
            <span className="shrink-0 font-medium text-ink-2">{memberName(state.members.get(lastLine.from), lastLine.from)}</span>
            <span className="min-w-0 truncate">{lastLine.text}</span>
          </span>
        )}
      </button>
    </div>
  )
}
