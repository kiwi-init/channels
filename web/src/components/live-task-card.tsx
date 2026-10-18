import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

import type { Message } from "@kiwi/core/protocol.ts"
import { liveCard } from "@kiwi/core/standup.ts"
import { colorOf, taskId, type ChannelState } from "@kiwi/core/state.ts"
import { formatAgo, memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Monogram } from "./kit"
import { isAgent } from "./message"
import { DecisionMark, labelOf, StateMark } from "./tasks"

export function LiveTaskCard({ id, state, messages, me, now, onOpen }: { id: number; state: ChannelState; messages: readonly Message[]; me: string; now: number; onOpen: (task: number) => void }) {
  const card = liveCard(state, messages, id, me)
  if (!card) return null
  const { task, people, said, lastLine, waiting } = card
  return (
    <div className="flex justify-start pl-9">
      <button
        type="button"
        onClick={() => onOpen(id)}
        aria-label={`Open ${taskId(id)}, ${task.title}`}
        className={cx(
          "group my-1 flex w-full max-w-[34rem] flex-col gap-2 rounded-card bg-raised px-3.5 py-3 text-left shadow-[0_0_0_1px_var(--line)] transition-colors hover:bg-wash",
          waiting && "shadow-[0_0_0_1px_var(--decide)]"
        )}
      >
        <span className="flex items-start gap-2">
          <span className="mt-0.5">
            <StateMark state={task.state} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body leading-snug font-semibold">{task.title}</span>
            <span className="mt-0.5 block text-meta text-ink-3">
              <span className="tabular-nums">{taskId(id)}</span>
              {` · ${labelOf(task)} · ${formatAgo(task.updatedAt, now)}`}
            </span>
          </span>
          {waiting ? <DecisionMark /> : <Icon icon={ArrowRight01Icon} size={16} className="mt-0.5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />}
        </span>
        {lastLine && (
          <span className="flex items-start gap-2 rounded-bubble bg-field px-2.5 py-1.5">
            <span className="shrink-0 text-meta font-medium text-ink-2">{memberName(state.members.get(lastLine.from), lastLine.from)}</span>
            <span className="min-w-0 truncate text-meta text-ink-2">{lastLine.text}</span>
          </span>
        )}
        <span className="flex items-center gap-2">
          <span className="flex -space-x-1.5">
            {people.slice(0, 4).map((n) => (
              <Monogram
                key={n}
                name={memberName(state.members.get(n), n)}
                agent={isAgent(state.members.get(n))}
                color={colorOf(state, n)}
                size={20}
                className={isAgent(state.members.get(n)) ? undefined : "ring-2 ring-raised"}
              />
            ))}
          </span>
          <span className="text-meta text-ink-3 tabular-nums">{said === 0 ? "No messages yet" : said === 1 ? "1 message" : `${said} messages`}</span>
        </span>
      </button>
    </div>
  )
}
