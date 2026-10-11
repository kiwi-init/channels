import { ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon, GitPullRequestIcon } from "@hugeicons/core-free-icons"
import { useMemo, useState, type ReactNode } from "react"
import type { Message } from "@mc/protocol.ts"
import { colorOf, taskId, type ChannelState, type Task } from "@mc/state.ts"
import { taskFeed, taskPrs } from "@mc/work.ts"
import { fitsLine } from "@mc/format.ts"
import { formatAgo, formatFull, memberName } from "@/lib/format"
import { Feed, PrLink } from "./feed"
import { Icon } from "./icon"
import { Button, IconButton, Monogram } from "./kit"
import { Markdown } from "./markdown"
import { isAgent } from "./message"
import { LABEL, StateMark } from "./tasks"

const ORDER = ["blocked", "doing", "review", "todo", "done", "cancelled"] as const

/** The board's order: blocked first, then in progress, review, to do, done; oldest first within each. */
export function boardOrder(state: ChannelState): number[] {
  return [...state.tasks.values()].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.id - b.id).map((t) => t.id)
}

/**
 * One task as its own page, like a Linear issue: what it is, then its whole story as one feed (its
 * events, every thread that names it, the PRs linked there), with its properties beside it.
 * Comments are task notes, so the story stays on the task.
 */
export function TaskPage({
  id,
  state,
  messages,
  me,
  now,
  onOpen,
  onClose,
  noteBlocked,
  onNote,
}: {
  id: number
  state: ChannelState
  messages: Message[]
  me: string
  now: number
  onOpen: (id: number) => void
  onClose: () => void
  /** Why this member can't add notes (their scopes), or null if they can. */
  noteBlocked: string | null
  onNote: (note: string) => Promise<void>
}) {
  const task = state.tasks.get(id)
  const items = useMemo(() => taskFeed(state, messages, id, me), [state, messages, id, me])
  const order = useMemo(() => boardOrder(state), [state])
  const at = order.indexOf(id)

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`Task ${taskId(id)}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4 md:px-5">
        <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-title font-semibold" aria-label="Breadcrumb">
          <button type="button" onClick={onClose} className="font-medium text-ink-3 hover:text-ink">
            Work
          </button>
          <span className="text-ink-3">/</span>
          <span className="tabular-nums">{taskId(id)}</span>
        </nav>
        {at >= 0 && (
          <span className="text-meta text-ink-3 tabular-nums">
            {at + 1} / {order.length}
          </span>
        )}
        <IconButton label="Previous task" disabled={at <= 0} onClick={() => onOpen(order[at - 1]!)}>
          <Icon icon={ArrowUp01Icon} size={16} />
        </IconButton>
        <IconButton label="Next task" disabled={at < 0 || at >= order.length - 1} onClick={() => onOpen(order[at + 1]!)}>
          <Icon icon={ArrowDown01Icon} size={16} />
        </IconButton>
        <IconButton label="Close task" onClick={onClose}>
          <Icon icon={Cancel01Icon} size={16} />
        </IconButton>
      </header>

      {!task ? (
        <div className="p-8">
          <p className="text-body font-semibold">This task is gone</p>
          <p className="mt-1 text-ui text-ink-2">It was pruned from the channel’s history.</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="min-w-0 flex-1">
            <div className="mx-auto max-w-[760px] px-6 pt-8 pb-16">
              <h1 className="flex items-center gap-2.5 text-display font-semibold tracking-[-0.01em]">
                <StateMark state={task.state} />
                <span className="min-w-0">{task.title}</span>
              </h1>
              {task.detail && (
                <div className="mt-2 max-w-[680px] text-body text-ink-2">
                  <Markdown>{task.detail}</Markdown>
                </div>
              )}
              <div className="mt-6 lg:hidden">
                <Properties task={task} state={state} now={now} items={items} onOpen={onOpen} />
              </div>
              <h2 className="mt-8 mb-2 text-title font-semibold">Activity</h2>
              <Feed items={items} state={state} now={now} />
              <NoteBox task={task} blocked={noteBlocked} onNote={onNote} />
            </div>
          </div>
          <aside className="hidden w-[272px] shrink-0 border-l border-edge px-5 pt-8 lg:block">
            <Properties task={task} state={state} now={now} items={items} onOpen={onOpen} />
          </aside>
        </div>
      )}
    </section>
  )
}

function Properties({ task, state, now, items, onOpen }: { task: Task; state: ChannelState; now: number; items: ReturnType<typeof taskFeed>; onOpen: (id: number) => void }) {
  const unblocks = [...state.tasks.values()].filter((t) => t.after.includes(task.id))
  const prs = taskPrs(items)
  const claims = task.owner ? state.claims.filter((c) => c.owner === task.owner) : []
  const owner = task.owner ? state.members.get(task.owner) : undefined
  // The latest handover that named a place to pick the work up from.
  const handoff = task.notes.findLast((n) => n.handoff?.branch || n.handoff?.commit)?.handoff
  return (
    <dl className="grid grid-cols-2 gap-4 lg:block lg:space-y-4">
      <Prop label="Status">
        <StateMark state={task.state} />
        {LABEL[task.state]}
      </Prop>
      <Prop label="Assignee">
        {task.owner ? (
          <>
            <Monogram name={task.owner} agent={isAgent(owner)} size={18} color={colorOf(state, task.owner)} />
            {memberName(owner, task.owner)}
          </>
        ) : (
          <span className="text-ink-3">Nobody yet</span>
        )}
      </Prop>
      {task.needs.length > 0 && (
        <Prop label="Needs">
          <span className="grid gap-1">
            <span className="flex flex-wrap gap-1">
              {task.needs.map((n) => (
                <span key={n} className="rounded-row bg-wash px-1.5 text-meta text-ink-2">
                  {n}
                </span>
              ))}
            </span>
            {task.state !== "done" && task.state !== "cancelled" && <span className="text-meta text-ink-3">{fitsLine(state, task, now)}</span>}
          </span>
        </Prop>
      )}
      {task.review && (
        <Prop label="Review">
          <span className="text-ink-2">
            {task.review === "*" ? "Anyone but its owner" : memberName(state.members.get(task.review), task.review)}
            {task.approvedBy ? `, approved by ${memberName(state.members.get(task.approvedBy), task.approvedBy)}` : task.state === "review" ? ", waiting" : ""}
          </span>
        </Prop>
      )}
      {handoff && (
        <Prop label="Pick it up from">
          <span className="font-mono text-meta text-ink-2">
            {handoff.branch ?? ""}
            {handoff.commit ? ` @ ${handoff.commit}` : ""}
          </span>
        </Prop>
      )}
      <Prop label="Waits on">{task.after.length ? <TaskLinks ids={task.after} state={state} onOpen={onOpen} /> : <span className="text-ink-3">Nothing</span>}</Prop>
      {unblocks.length > 0 && (
        <Prop label="Unblocks">
          <TaskLinks ids={unblocks.map((t) => t.id)} state={state} onOpen={onOpen} />
        </Prop>
      )}
      {prs.length > 0 && (
        <Prop label="Pull requests">
          <span className="grid gap-1">
            {prs.map((pr) => (
              <span key={pr.url} className="flex items-center gap-2">
                <Icon icon={GitPullRequestIcon} size={16} className="text-ink-3" />
                <PrLink pr={pr} />
              </span>
            ))}
          </span>
        </Prop>
      )}
      {claims.length > 0 && (
        <Prop label="Claims">
          <span className="grid gap-0.5 font-mono text-meta text-ink-2">
            {claims.map((c) => (
              <span key={c.path}>{c.path}</span>
            ))}
          </span>
        </Prop>
      )}
      <Prop label="Created">
        <span className="text-ink-2" title={formatFull(task.createdAt)}>
          by {memberName(state.members.get(task.createdBy), task.createdBy)}, {formatAgo(task.createdAt, now)}
        </span>
      </Prop>
    </dl>
  )
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="mb-1.5 text-meta font-medium text-ink-3">{label}</dt>
      <dd className="flex items-center gap-2 text-ui">{children}</dd>
    </div>
  )
}

function TaskLinks({ ids, state, onOpen }: { ids: number[]; state: ChannelState; onOpen: (id: number) => void }) {
  return (
    <span className="grid gap-1">
      {ids.map((d) => {
        const t = state.tasks.get(d)
        return (
          <button key={d} type="button" onClick={() => onOpen(d)} className="flex items-center gap-2 text-left hover:text-ink">
            {t && <StateMark state={t.state} />}
            <span className="text-ink-3 tabular-nums">{taskId(d)}</span>
            <span className="truncate">{t?.title}</span>
          </button>
        )
      })}
    </span>
  )
}

/** Comments are task notes: they stay on the task, and the board shows them. */
function NoteBox({ task, blocked, onNote }: { task: Task; blocked: string | null; onNote: (note: string) => Promise<void> }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  if (blocked) return <p className="mt-4 rounded-card border border-edge bg-raised px-4 py-3 text-ui text-ink-3">{blocked}</p>
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await onNote(text.trim())
      setText("")
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="mt-4 flex items-end gap-2 rounded-card border border-edge bg-raised px-4 py-3 focus-within:border-edge-strong"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
        }}
        rows={1}
        aria-label={`Comment on ${taskId(task.id)}`}
        placeholder={`Comment on ${taskId(task.id)}…`}
        className="min-h-[22px] flex-1 resize-none bg-transparent text-body outline-none placeholder:text-ink-3"
      />
      <Button type="submit" size="sm" disabled={!text.trim() || busy}>
        Comment
      </Button>
    </form>
  )
}
