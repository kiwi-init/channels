import { ArrowDown01Icon, GitPullRequestIcon, Link01Icon, UserMultipleIcon } from "@hugeicons/core-free-icons"
import { useMemo, useState, type ReactNode } from "react"
import { proofLabel } from "@kiwi/core/format.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { colorOf, taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { taskFeed, taskPrs } from "@kiwi/core/work.ts"
import { formatAgo, formatFull, memberName } from "@/lib/format"
import { ANYONE, reviewerChoices, taskActions } from "@/lib/task-actions"
import { cx } from "@/lib/utils"
import { Feed, PrLink } from "./feed"
import { Icon } from "./icon"
import { Alert, Button, Monogram, TextField, errorText, toast } from "./kit"
import { Markdown } from "./lazy"
import { isAgent } from "./message"
import { labelOf, StateMark } from "./tasks"

/**
 * A task at the head of its conversation in the Tasks panel, as a thread opens on its first message:
 * what it is and its properties, then its whole story behind a tap (its events, every thread that
 * names it, the PRs linked there). Comments are task notes, so the story stays on the task.
 */
export function TaskDetails({
  id,
  state,
  messages,
  me,
  now,
  highlighted,
  person,
  noteBlocked,
  onNote,
  onApprove,
  onSendBack,
  onCancel,
  onReviewer,
}: {
  id: number
  state: ChannelState
  messages: Message[]
  me: string
  now: number
  highlighted?: boolean
  person: boolean
  /** Why this member can't add notes (their scopes), or null if they can. */
  noteBlocked: string | null
  onNote: (note: string) => Promise<void>
  onApprove: (t: Task) => Promise<void>
  onSendBack: (t: Task, why: string) => Promise<void>
  onCancel: (t: Task, note: string) => Promise<void>
  onReviewer: (t: Task, review: string) => Promise<void>
}) {
  const task = state.tasks.get(id)
  const items = useMemo(() => taskFeed(state, messages, id), [state, messages, id])
  const [story, setStory] = useState(false)

  if (!task)
    return (
      <div className="p-4">
        <p className="text-body font-semibold">This task is gone</p>
        <p className="mt-1 text-ui text-ink-2">It was pruned from the channel’s history.</p>
      </div>
    )

  return (
    <section
      id={`k${id}`}
      aria-label={`Task ${taskId(id)}`}
      className={cx("mt-1 rounded-card bg-raised px-4 py-3.5 shadow-[0_0_0_1px_var(--line)]", highlighted && "animate-flash outline-2 outline-offset-2 outline-[var(--ring)]")}
    >
      <h2 className="flex items-start gap-2 text-title font-semibold">
        <span className="mt-0.5">
          <StateMark state={task.state} />
        </span>
        <span className="min-w-0">{task.title}</span>
      </h2>
      {task.detail && (
        <div className="mt-1.5 text-body text-ink-2">
          <Markdown>{task.detail}</Markdown>
        </div>
      )}
      <div className="mt-4">
        <Properties task={task} state={state} now={now} items={items} />
      </div>
      {!noteBlocked && <Actions key={task.id} task={task} state={state} me={me} person={person} onApprove={onApprove} onSendBack={onSendBack} onCancel={onCancel} onReviewer={onReviewer} />}
      <h3 className="mt-4 text-ui font-semibold">
        <button type="button" aria-expanded={story} onClick={() => setStory((v) => !v)} className="flex w-full items-center gap-2 text-left">
          Activity
          <span className="text-meta font-normal text-ink-3 tabular-nums">{items.length}</span>
          <Icon icon={ArrowDown01Icon} size={14} className={cx("ml-auto shrink-0 text-ink-3 transition-transform", story && "rotate-180")} />
        </button>
      </h3>
      {story && (
        <div className="mt-2">
          <Feed items={items} state={state} now={now} />
          <NoteBox task={task} blocked={noteBlocked} onNote={onNote} />
        </div>
      )}
    </section>
  )
}

function Properties({ task, state, now, items }: { task: Task; state: ChannelState; now: number; items: ReturnType<typeof taskFeed> }) {
  const prs = taskPrs(items)
  const owner = task.owner ? state.members.get(task.owner) : undefined
  return (
    <dl className="grid grid-cols-2 gap-4">
      <Prop label="Status">
        <StateMark state={task.state} />
        {labelOf(task)}
      </Prop>
      <Prop label="Assignee">
        {task.owner ? (
          <>
            <Monogram name={task.owner} agent={isAgent(owner)} size={18} color={colorOf(state, task.owner)} />
            <span className="truncate">{memberName(owner, task.owner)}</span>
          </>
        ) : (
          <span className="text-ink-3">Nobody yet</span>
        )}
      </Prop>
      {task.review && (
        <Prop label="Review">
          <span className="text-ink-2">
            {task.review === "*" ? "Anyone who hasn’t worked on it" : memberName(state.members.get(task.review), task.review)}
            {task.approvedBy ? `, approved by ${memberName(state.members.get(task.approvedBy), task.approvedBy)}` : task.state === "review" ? ", waiting" : ""}
          </span>
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
      {task.proof && task.proof.length > 0 && (
        <Prop label="Proof">
          <span className="grid gap-1">
            {task.proof.map((p) => (
              <span key={p.url} className="flex items-center gap-2">
                <Icon icon={Link01Icon} size={16} className="shrink-0 text-ink-3" />
                <a href={p.url} target="_blank" rel="noreferrer" title={p.url} className="min-w-0 truncate text-ink-2 hover:text-ink hover:underline">
                  {proofLabel(p)}
                </a>
                <span className="shrink-0 text-meta text-ink-3" title={formatFull(p.ts)}>
                  {memberName(state.members.get(p.by), p.by)}, {formatAgo(p.ts, now)}
                </span>
              </span>
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

function Actions({
  task,
  state,
  me,
  person,
  onApprove,
  onSendBack,
  onCancel,
  onReviewer,
}: {
  task: Task
  state: ChannelState
  me: string
  person: boolean
  onApprove: (t: Task) => Promise<void>
  onSendBack: (t: Task, why: string) => Promise<void>
  onCancel: (t: Task, note: string) => Promise<void>
  onReviewer: (t: Task, review: string) => Promise<void>
}) {
  const [why, setWhy] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [picking, setPicking] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const can = taskActions(task, me, person)
  if (can.kind === "hidden") return null
  const id = taskId(task.id)
  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await fn()
      setWhy(null)
      setCancelling(false)
      setPicking(false)
      toast(done)
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }
  const cancel = () => {
    if (note.trim() && !busy) void act(() => onCancel(task, note.trim()), `Cancelled ${id}`)
  }
  const choices = reviewerChoices(task, state.members.values())
  const nameOf = (name: string) => (name === ANYONE ? "anyone who hasn’t worked on it" : memberName(state.members.get(name), name))
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {why === null ? (
        <>
          {can.review === "verdict" && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => onApprove(task), `Approved ${id}`)}>
              Approve
            </Button>
          )}
          {can.review !== "none" && (
            <Button size="sm" variant="ghost" onClick={() => setWhy("")}>
              Send back
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={choices.length === 0} onClick={() => setPicking(true)}>
            {task.review ? "Change reviewer…" : "Add reviewer…"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => (setNote(""), setCancelling(true))}>
            Cancel task…
          </Button>
        </>
      ) : (
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (why.trim() && !busy) void act(() => onSendBack(task, why.trim()), `Sent ${id} back`)
          }}
        >
          <TextField
            autoFocus
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setWhy(null)}
            placeholder="What to change"
            aria-label="What to change"
            className="flex-1"
          />
          <Button size="sm" variant="secondary" type="submit" disabled={busy || !why.trim()}>
            Send back
          </Button>
        </form>
      )}
      <Alert
        open={picking}
        onClose={() => setPicking(false)}
        title={`Who reviews ${id}?`}
        message={
          <span className="mt-3 grid gap-1">
            <span className="mb-2">
              {task.review ? `Now ${nameOf(task.review)}. ` : ""}
              {task.state === "review" ? "The new reviewer gives the verdict on the open round." : "The new reviewer gives the verdict when it’s sent for review."}
            </span>
            {choices.map((name) => {
              const m = state.members.get(name)
              return (
                <button
                  key={name}
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => onReviewer(task, name), `${id}: ${nameOf(name)} reviews it`)}
                  className="flex items-center gap-3 rounded-ctl px-2 py-2 text-left text-ink transition-colors hover:bg-wash disabled:opacity-40"
                >
                  {name === ANYONE ? (
                    <span className="flex size-6 items-center justify-center text-ink-3">
                      <Icon icon={UserMultipleIcon} size={18} />
                    </span>
                  ) : (
                    <Monogram name={name} agent={isAgent(m)} size={24} color={colorOf(state, name)} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-ui font-medium">
                    {name === ANYONE ? "Anyone who hasn’t worked on it" : nameOf(name)}
                    {name === me && <span className="font-normal text-ink-3"> (you)</span>}
                  </span>
                </button>
              )
            })}
          </span>
        }
      >
        <Button variant="secondary" onClick={() => setPicking(false)}>
          Close
        </Button>
      </Alert>
      <Alert
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Cancel ${id}?`}
        message={
          <span className="mt-3 grid gap-2">
            <span>It closes for everyone, marked cancelled{task.state === "review" ? ", and its open review round ends" : ""}. Say why, so whoever worked on it knows.</span>
            <TextField
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.preventDefault(), cancel())}
              placeholder="Why it’s cancelled"
              maxLength={500}
              aria-label="Why it’s cancelled"
            />
          </span>
        }
      >
        <Button variant="secondary" onClick={() => setCancelling(false)}>
          Keep it
        </Button>
        <Button variant="danger" disabled={busy || !note.trim()} onClick={cancel}>
          Cancel task
        </Button>
      </Alert>
    </div>
  )
}

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1.5 text-meta font-medium text-ink-3">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-ui">{children}</dd>
    </div>
  )
}

/** Comments are task notes: they stay on the task, and the board shows them. */
function NoteBox({ task, blocked, onNote }: { task: Task; blocked: string | null; onNote: (note: string) => Promise<void> }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  if (blocked) return <p className="mt-3 rounded-card bg-field px-3.5 py-2.5 text-ui text-ink-3">{blocked}</p>
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
      className="mt-3 flex items-end gap-2 rounded-card bg-field px-3.5 py-2.5"
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
