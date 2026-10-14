import { ArrowDown01Icon, Cancel01Icon, Note01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import type { TaskState } from "@mc/protocol.ts"
import { colorOf, taskId, type ChannelState, type Task } from "@mc/state.ts"
import { formatAgo, memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { isAgent } from "./message"
import { Alert, Button, IconButton, Monogram, errorText, toast } from "./kit"

export const LABEL: Record<TaskState, string> = { doing: "In progress", review: "In review", todo: "Open", done: "Done" }

/** A task's state as a label, saying when a done one was cancelled rather than finished. */
export const labelOf = (t: Pick<Task, "state" | "cancelled">) => (t.state === "done" && t.cancelled ? "Done (cancelled)" : LABEL[t.state])

/** Where a task stands, as one small dot: grey open, blue in progress, amber in review, green done. */
export function StateMark({ state }: { state: TaskState }) {
  return (
    <span title={LABEL[state]} className="flex size-4 shrink-0 items-center justify-center">
      <span className={cx("block size-2 rounded-full", state === "todo" && "bg-ink-3/55", state === "doing" && "bg-doing", state === "review" && "bg-decide", state === "done" && "bg-live")} />
    </span>
  )
}

function TaskRow({ task, state, now, nameOf, unread, onOpen }: { task: Task; state: ChannelState; now: number; nameOf: (n: string) => string; unread?: { n: number; forMe: boolean }; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 pl-4 text-left transition-colors hover:bg-wash">
      <StateMark state={task.state} />
      {/* A grouped list's hairline starts at the text, as in iOS. */}
      <span className="flex min-w-0 flex-1 items-center gap-3 border-b border-line py-3 pr-4 group-last:border-b-0">
        <span className="min-w-0 flex-1">
          <span className={cx("block text-body leading-snug", task.state === "done" && "text-ink-2")}>{task.title}</span>
          <span className="mt-0.5 block truncate text-meta text-ink-3">
            <span className="tabular-nums">{taskId(task.id)}</span>
            {task.cancelled && " · Cancelled"}
            {task.notes.length > 0 && ` · ${task.notes.length === 1 ? "1 note" : `${task.notes.length} notes`}`}
            {` · ${formatAgo(task.updatedAt, now)}`}
          </span>
        </span>
        {unread && unread.n > 0 ? (
          unread.forMe ? (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-stamp font-semibold text-accent-ink tabular-nums">{unread.n}</span>
          ) : (
            <span aria-label="New messages" className="size-2 shrink-0 rounded-full bg-ink-3" />
          )
        ) : null}
        <span className="flex shrink-0 items-center gap-2 text-ui text-ink-3">
          <span className="hidden max-w-32 truncate sm:block">{task.owner ? nameOf(task.owner) : "Unassigned"}</span>
          {task.owner ? (
            <Monogram name={nameOf(task.owner)} agent={isAgent(state.members.get(task.owner))} color={colorOf(state, task.owner)} size={24} />
          ) : (
            <span title="Unassigned" className="size-6 shrink-0 rounded-full border border-dashed border-edge-strong" />
          )}
        </span>
      </span>
    </button>
  )
}

/**
 * What agents told each other to remember (facts), pinned above the conversation as one quiet block.
 * People read it and may clear a value; setting one is the agents' job.
 */
export function Notes({ state, now, onClear }: { state: ChannelState; now: number; onClear: (key: string) => Promise<void> }) {
  const facts = [...state.facts.values()].sort((a, b) => a.key.localeCompare(b.key))
  const [open, setOpen] = useState(false)
  const [clearing, setClearing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!facts.length) return null
  const clear = async (key: string) => {
    setBusy(true)
    try {
      await onClear(key)
      toast(`Cleared ${key}`)
      setClearing(null)
    } catch (err) {
      toast(`Not cleared: ${errorText(err)}`, "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Notes" className="mt-4 overflow-hidden rounded-card bg-raised">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-ui">
        <Icon icon={Note01Icon} size={15} className="shrink-0 text-ink-3" />
        <span className="font-medium">Notes</span>
        <span className="text-meta text-ink-3 tabular-nums">{facts.length}</span>
        {!open && <span className="min-w-0 flex-1 truncate text-meta text-ink-3">{facts.map((f) => f.key).join(", ")}</span>}
        <Icon icon={ArrowDown01Icon} size={14} className={cx("ml-auto shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line px-2 py-1.5">
          {facts.map((f) => (
            <div key={f.key} className="group flex items-start gap-1 rounded-ctl px-2 py-1.5 hover:bg-wash">
              <button type="button" className="min-w-0 flex-1 text-left" title="Copy value" onClick={() => navigator.clipboard.writeText(f.value).then(() => toast(`Copied ${f.key}`))}>
                <p className="flex min-w-0 items-baseline gap-2 text-ui">
                  <span className="shrink-0 font-medium">{f.key}</span>
                  <span className="truncate font-mono text-ink-2" title={f.value}>
                    {f.value}
                  </span>
                </p>
                <p className="text-meta text-ink-3">
                  {f.by} · {formatAgo(f.ts, now)}
                </p>
              </button>
              <IconButton
                label={`Clear ${f.key}`}
                className="size-7 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                onClick={() => setClearing(f.key)}
              >
                <Icon icon={Cancel01Icon} size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <Alert
        open={clearing !== null}
        onClose={() => setClearing(null)}
        title={`Clear ${clearing ?? "this note"}?`}
        message="Agents may be relying on it. It’s gone for everyone in the channel, and an agent can set it again."
      >
        <Button variant="secondary" onClick={() => setClearing(null)}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => clearing && void clear(clearing)}>
          Clear
        </Button>
      </Alert>
    </section>
  )
}

/** Where a task's review stands, in a few words; null when it has no reviewer. */
export function reviewLine(task: Task, nameOf: (n: string) => string): string | null {
  if (task.approvedBy) return `Approved by ${nameOf(task.approvedBy)}`
  if (!task.review) return null
  const who = task.review === "*" ? "someone who hasn’t worked on it" : nameOf(task.review)
  return task.state === "review" ? `Waiting for review by ${who}` : `Reviewed by ${who}`
}

/**
 * A task where it was made in the conversation: one card that follows the task as it moves (its
 * state, who has it, its review), so the timeline doesn't repeat every change. Opens the task.
 */
export function TaskCard({ task, state, now, onOpen, highlighted }: { task: Task; state: ChannelState; now: number; onOpen: () => void; highlighted?: boolean }) {
  const nameOf = (n: string) => memberName(state.members.get(n), n)
  const review = reviewLine(task, nameOf)
  // The header already names the task: this strip says where it stands, and opens it.
  return (
    <button
      type="button"
      id={`m${task.id}`}
      onClick={onOpen}
      aria-label={`${task.title} ${taskId(task.id)}`}
      className={cx("mt-3 mb-1 flex w-full items-center gap-2.5 rounded-card bg-field px-3.5 py-2.5 text-left text-meta text-ink-2 transition-colors hover:bg-wash-2", highlighted && "outline-2 outline-offset-2 outline-[var(--ring)]")}
    >
      <StateMark state={task.state} />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-ink">{labelOf(task)}</span>
        {" · "}
        {task.owner ? nameOf(task.owner) : "Unassigned"}
        {review && (
          <>
            {" · "}
            <span className={cx(task.state === "review" && "font-medium text-decide")}>{review}</span>
          </>
        )}
        {" · "}
        {formatAgo(task.updatedAt, now)}
      </span>
      <span className="shrink-0 font-medium text-ink-2">Open task ›</span>
    </button>
  )
}

/** The board's groups, in the order they ask for attention. */
const GROUPS: [TaskState, string][] = [
  ["review", "Needs review"],
  ["doing", "In progress"],
  ["todo", "Up next"],
  ["done", "Done"],
]

/** Every task by state, with room for whole titles: the conversation's Tasks pill, and the one list of tasks. */
export function Tasks({ state, now, nameOf, unreadIn, onOpen }: { state: ChannelState; now: number; nameOf: (n: string) => string; unreadIn?: (id: number) => { n: number; forMe: boolean }; onOpen: (id: number) => void }) {
  const [showDone, setShowDone] = useState(false)
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const all = [...state.tasks.values()]
    .filter((t) => !q || t.title.toLowerCase().includes(q) || taskId(t.id).toLowerCase().includes(q) || (!!t.owner && nameOf(t.owner).toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  if (!state.tasks.size)
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-xs">
          <p className="text-body font-semibold">No tasks yet</p>
          <p className="mt-1 text-ui leading-normal text-ink-2">When agents split up work, each task and who has it shows up here, and in the conversation where it was made.</p>
        </div>
      </div>
    )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[792px] px-3 pt-[calc(var(--head)+12px)] pb-8 md:px-4">
        <label className="glass mb-5 flex h-9 items-center gap-2 rounded-full px-3.5 text-ink-3 transition-shadow focus-within:shadow-[0_0_0_3px_var(--accent-wash)]">
          <Icon icon={Search01Icon} size={16} className="shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Filter by title, number or who has it"
            aria-label="Filter tasks"
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
        </label>
        {q && !all.length && <p className="py-6 text-center text-ui text-ink-3">No task matches “{query}”.</p>}
        {GROUPS.map(([s, word]) => {
          const list = all.filter((t) => t.state === s)
          if (!list.length) return null
          // Done ones wait behind a tap, unless you're looking for one.
          const closed = s === "done" && !q
          return (
            <section key={s} aria-label={word} className="mb-6">
              <div className="mb-1.5 flex items-baseline gap-2 px-4">
                <h3 className="text-ui font-semibold text-ink-2">{word}</h3>
                <span className="text-meta text-ink-3 tabular-nums">{list.length}</span>
                {closed && (
                  <button type="button" className="ml-auto text-ui font-medium text-accent-text hover:underline" onClick={() => setShowDone((v) => !v)}>
                    {showDone ? "Hide" : "Show"}
                  </button>
                )}
              </div>
              {(!closed || showDone) && (
                <div className="overflow-hidden rounded-card bg-raised shadow-[0_0_0_1px_var(--line)]">
                  {list.map((t) => (
                    <TaskRow key={t.id} task={t} state={state} now={now} nameOf={nameOf} unread={unreadIn?.(t.id)} onOpen={() => onOpen(t.id)} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
