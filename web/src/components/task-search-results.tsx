import { taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"

import { labelOf } from "@/lib/task-labels"

export function TaskSearchResults({ state, tasks, onOpen }: { state: ChannelState; tasks: Task[]; onOpen: (id: number) => void }) {
  return (
    <section aria-label="Matching tasks" className="mb-3 rounded-card border border-line bg-canvas p-1.5">
      <h2 className="px-2 pt-1 pb-1.5 text-ui font-semibold">Tasks</h2>
      <ul className="space-y-0.5">
        {tasks.map((task) => (
          <li key={task.id}>
            <button type="button" onClick={() => onOpen(task.id)} className="flex w-full cursor-pointer items-center gap-3 rounded-ctl px-2 py-2 text-left transition-colors hover:bg-wash">
              <span className="shrink-0 text-meta text-ink-3 tabular-nums">{taskId(task.id)}</span>
              <span className="min-w-0 flex-1 truncate text-body">{task.title}</span>
              <span className="shrink-0 text-meta text-ink-3">{labelOf(state, task)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
