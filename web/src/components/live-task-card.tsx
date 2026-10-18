import type { Message } from "@kiwi/core/protocol.ts"
import { liveCard } from "@kiwi/core/standup.ts"
import { colorOf, taskId, type ChannelState } from "@kiwi/core/state.ts"
import { formatAgo, memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { Monogram } from "./kit"
import { isAgent } from "./message"
import { DecisionMark, labelOf, StateMark } from "./tasks"

const LIVE: Record<string, { word: string; tone: string; pulse?: boolean }> = {
  todo: { word: "up next", tone: "text-ink-3" },
  doing: { word: "in progress", tone: "text-doing", pulse: true },
  review: { word: "in review", tone: "text-accent-text" },
  done: { word: "done", tone: "text-live" },
}

export function LiveTaskCard({ id, state, messages, me, now, onOpen }: { id: number; state: ChannelState; messages: readonly Message[]; me: string; now: number; onOpen: (task: number) => void }) {
  const card = liveCard(state, messages, id, me)
  if (!card) return null
  const { task, waiting } = card
  const live = LIVE[task.state] ?? LIVE.todo!
  const owner = task.owner ? state.members.get(task.owner) : undefined
  return (
    <div className="pl-11">
      <button
        type="button"
        onClick={() => onOpen(id)}
        aria-label={`Open ${taskId(id)}, ${task.title}`}
        title={`${labelOf(task)} · ${formatAgo(task.updatedAt, now)}`}
        className={cx(
          "my-1 flex w-full max-w-[560px] min-w-0 items-center gap-2.5 rounded-row px-3 py-2 text-left text-ui shadow-[inset_0_0_0_1px_var(--line)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--edge-strong)]",
          waiting && "shadow-[inset_0_0_0_1px_var(--decide)]"
        )}
      >
        {task.owner ? (
          <Monogram name={memberName(owner, task.owner)} agent={isAgent(owner)} color={colorOf(state, task.owner)} size={18} />
        ) : (
          <StateMark state={task.state} />
        )}
        <span className="shrink-0 text-ink-3 tabular-nums">{taskId(id)}</span>
        <span className="min-w-0 flex-1 truncate text-ink">{task.title}</span>
        {waiting ? (
          <DecisionMark />
        ) : (
          <span className={cx("flex shrink-0 items-center gap-1.5 text-meta", live.tone)}>
            {live.pulse && <span aria-hidden className="size-1.5 rounded-full bg-doing shadow-[0_0_0_3px_color-mix(in_srgb,var(--doing)_18%,transparent)]" />}
            {task.cancelled ? "cancelled" : live.word}
          </span>
        )}
      </button>
    </div>
  )
}
