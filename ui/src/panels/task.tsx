import "~/styles/task-panel.css"

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Composer } from "~/chat/composer"
import { compactAt, quoteOf, useNames, useTaskIds } from "~/chat/conversation"
import { named } from "~/chat/linked"
import { MessageRow } from "~/chat/message"
import { preview } from "~/chat/preview"
import { jumpTo } from "~/chat/reply"
import { ANYONE } from "@kiwi/channel/task-actions.ts"
import { Avatar, cx, Dialog, DialogHead, Dot, Empty, Heading, statusWord } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { MoreButton } from "~/kit/menu-open"
import { ago } from "~/kit/time"
import { memberOf, type Ask, type Channel, type PermissionAsk, type Person, type QuestionAsk, type ReviewRound, type Task, type TaskEvent } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"
import { IssueMark, issueWord, PrCard } from "~/github/parts"
import { PanelHead } from "~/panels/frame"
import { moveWords, someone } from "~/panels/task-moves"
import { TONES } from "~/tasks/row"
import { SendBack } from "~/tasks/send-back"

function since(at: number): string {
  const a = ago(at)
  if (a === "now") return "just now"
  return /^\d+[mhd]$/.test(a) ? `${a} ago` : a
}

const holds = (a: Ask, id: number): a is PermissionAsk | QuestionAsk =>
  a.kind === "permission" ? a.task === id && !a.answer : a.kind === "question" ? (a.task === id || a.holds.includes(id)) && !a.answer : false

export function TaskPanel({ channel, id }: { channel: Channel; id: number }) {
  const task = channel.tasks.find((t) => t.id === id)
  const talk = useMemo(() => channel.messages.filter((m) => m.where.kind === "task" && m.where.task === id && m.inThread === undefined), [channel.messages, id])
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const bySeq = useMemo(() => new Map(channel.messages.map((m) => [m.seq, m])), [channel.messages])
  const body = useRef<HTMLDivElement>(null)
  const { go } = useApp()
  const onQuote = useCallback(
    (seq: number) => {
      if (!jumpTo(body.current, seq)) go({ to: "panel", panel: { kind: "thread", seq: bySeq.get(seq)?.inThread ?? seq } })
    },
    [go, bySeq]
  )
  const last = talk.at(-1)?.seq
  const seen = useRef({ id, last })
  useLayoutEffect(() => {
    const was = seen.current
    seen.current = { id, last }
    if (was.id === id && was.last !== last) body.current?.scrollTo({ top: body.current.scrollHeight })
  }, [id, last])
  if (!task)
    return (
      <>
        <PanelHead title={`T${id}`} />
        <Empty title="This task is gone." />
      </>
    )
  const waits = channel.asks.filter((a) => holds(a, id))
  const may = !memberOf(channel, channel.you)?.readOnly
  return (
    <>
      <PanelHead title={`T${task.id}`}>{may && <TaskMenu key={`menu-${task.id}`} channel={channel} task={task} />}</PanelHead>
      <div key={task.id} ref={body} className="panel-body task-body tp">
        <section className="panel-section tp-top">
          <h3 className="task-title">{task.title}</h3>
          {task.detail && <p className="task-detail">{task.detail}</p>}
          <State key={`state-${task.id}`} channel={channel} task={task} may={may} />
        </section>
        <section className="panel-section">
          <Props key={`props-${task.id}`} channel={channel} task={task} may={may} />
          {may && task.suggested && !task.owner && <Suggested channel={channel} task={task} suggested={task.suggested} />}
        </section>
        {waits.length > 0 && <Waits channel={channel} waits={waits} />}
        <Review key={`review-${task.id}`} channel={channel} task={task} />
        {(task.pr || channel.issues?.some((i) => i.task === task.id)) && (
          <section className="panel-section tp-links">
            {task.pr && <PrCard pr={task.pr} />}
            <LinkedIssue channel={channel} id={task.id} />
          </section>
        )}
        {task.history.length > 0 && <Activity key={`activity-${task.id}`} channel={channel} history={task.history} />}
        {talk.length > 0 && (
          <section className="panel-section task-talk">
            <Heading>Conversation</Heading>
            {talk.map((m, i) => (
              <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(talk, i)} names={names} tasks={tasks} inThread quote={quoteOf(talk, i, bySeq)} onQuote={onQuote} />
            ))}
          </section>
        )}
      </div>
      <Composer key={`compose-${task.id}`} channel={channel} where={{ kind: "task", task: task.id }} placeholder={`Message in T${task.id}`} />
    </>
  )
}

function Who({ channel, name }: { channel: Channel; name: string }) {
  const { go } = useApp()
  const person = memberOf(channel, name)
  return (
    <button type="button" className="task-who" onClick={() => go({ to: "panel", panel: { kind: "person", name } })}>
      <Avatar person={person} size="sm" />
      <span className="task-who-name">{nickname(channel, name)}</span>
      {name === channel.you && <span className="dimmer">you</span>}
    </button>
  )
}

function Props({ channel, task, may }: { channel: Channel; task: Task; may: boolean }) {
  const [picking, setPicking] = useState<"owner" | "reviewer" | null>(null)
  const open = may && task.status !== "done"
  return (
    <>
      <dl className="props task-props tp-props">
        <dt>Owner</dt>
        <dd>
          {task.owner ? <Who channel={channel} name={task.owner} /> : <span className="dimmer">nobody yet</span>}
          {open && (
            <button type="button" className="task-change" onClick={() => setPicking("owner")}>
              {task.owner ? "Reassign" : "Assign"}
            </button>
          )}
        </dd>
        {(task.reviewer || open) && (
          <>
            <dt>Reviewer</dt>
            <dd>
              {!task.reviewer ? (
                <button type="button" className="task-change tp-ask" onClick={() => setPicking("reviewer")}>
                  Ask for a review
                </button>
              ) : (
                <>
                  {task.reviewer === ANYONE ? <span>anyone who hasn't worked on it</span> : <Who channel={channel} name={task.reviewer} />}
                  {open && (
                    <button type="button" className="task-change" onClick={() => setPicking("reviewer")}>
                      Change
                    </button>
                  )}
                </>
              )}
            </dd>
          </>
        )}
        <dt>Asked by</dt>
        <dd>
          <Who channel={channel} name={task.createdBy} />
        </dd>
      </dl>
      <Assign channel={channel} task={task} open={picking === "owner"} onClose={() => setPicking(null)} />
      <PickReviewer channel={channel} task={task} open={picking === "reviewer"} onClose={() => setPicking(null)} />
    </>
  )
}

function Suggested({ channel, task, suggested }: { channel: Channel; task: Task; suggested: NonNullable<Task["suggested"]> }) {
  const { app, toast } = useApp()
  return (
    <div className="task-suggest">
      <Avatar person={memberOf(channel, suggested.name)} size="sm" />
      <p className="task-suggest-text">
        <span className="dimmer">Suggested</span> {nickname(channel, suggested.name)} <span className="dim">· {named(suggested.why, channel.nicknames)}</span>
      </p>
      <button
        type="button"
        className="btn is-small"
        onClick={() => {
          app.actions.assignTask(channel.code, task.id, suggested.name, suggested.why)
          toast(`T${task.id} is ${nickname(channel, suggested.name)}'s now`)
        }}
      >
        Assign
      </button>
    </div>
  )
}

function Choice({ channel, person, on, about, onPick }: { channel: Channel; person: Person; on: boolean; about: string; onPick: () => void }) {
  return (
    <button type="button" className="task-pick-row" aria-pressed={on} disabled={on} onClick={onPick}>
      <Avatar person={person} size="sm" />
      <span className="task-pick-text">
        <span className="task-pick-name">
          {nickname(channel, person.name)}
          {person.you && <span className="dimmer"> · you</span>}
        </span>
        <span className="task-pick-about">{about}</span>
      </span>
      {on && <Icon name="check" size={14} />}
    </button>
  )
}

const agentsFirst = (a: Person, b: Person): number => (a.kind === b.kind ? 0 : a.kind === "agent" ? -1 : 1)

const aboutOf = (p: Person): string =>
  [p.kind === "agent" ? "Agent" : "Person", p.role === "lead" ? "lead" : undefined, p.load?.doing.length ? `on ${p.load.doing.map((t) => `T${t}`).join(", ")}` : undefined].filter(Boolean).join(" · ")

function Assign({ channel, task, open, onClose }: { channel: Channel; task: Task; open: boolean; onClose: () => void }) {
  const { app, toast } = useApp()
  const [why, setWhy] = useState("")
  const close = () => {
    setWhy("")
    onClose()
  }
  const people = channel.people.filter((p) => !p.left && !p.readOnly)
  const first = task.suggested ? people.filter((p) => p.name === task.suggested?.name) : []
  const rest = people.filter((p) => p.name !== task.suggested?.name).sort(agentsFirst)
  const pick = (name: string) => {
    app.actions.assignTask(channel.code, task.id, name, why.trim() || (name === task.suggested?.name ? task.suggested.why : ""))
    toast(`T${task.id} is ${nickname(channel, name)}'s now`)
    close()
  }
  return (
    <Dialog open={open} onClose={close} label={`Who works on T${task.id}?`}>
      <DialogHead
        title={`Who works on T${task.id}?`}
        sub={task.owner ? `Now ${someone(channel, task.owner)}. The new owner gets a message with your note.` : "The new owner gets a message with your note."}
        onClose={close}
      />
      <div className="task-pick">
        <input className="input" value={why} aria-label="A note for them" placeholder="A note for them (optional)" maxLength={300} onChange={(e) => setWhy(e.target.value)} />
        <div className="task-pick-list">
          {[...first, ...rest].map((p) => (
            <Choice
              key={p.name}
              channel={channel}
              person={p}
              on={p.name === task.owner}
              about={p.name === task.suggested?.name ? `Suggested · ${named(task.suggested.why, channel.nicknames)}` : aboutOf(p)}
              onPick={() => pick(p.name)}
            />
          ))}
        </div>
      </div>
    </Dialog>
  )
}

function PickReviewer({ channel, task, open, onClose }: { channel: Channel; task: Task; open: boolean; onClose: () => void }) {
  const { app, toast } = useApp()
  const people = channel.people.filter((p) => !p.left && !p.readOnly && p.name !== task.owner).sort(agentsFirst)
  const pick = (name: string) => {
    app.actions.setReviewer(channel.code, task.id, name)
    toast(name === ANYONE ? `Anyone who hasn't worked on T${task.id} can review it` : `${nickname(channel, name)} reviews T${task.id}`)
    onClose()
  }
  const now = task.reviewer ? (task.reviewer === ANYONE ? "Now anyone who hasn't worked on it. " : `Now ${someone(channel, task.reviewer)}. `) : ""
  return (
    <Dialog open={open} onClose={onClose} label={`Who reviews T${task.id}?`}>
      <DialogHead
        title={`Who reviews T${task.id}?`}
        sub={`${now}${task.status === "review" ? "They give the verdict on the open round." : "They give the verdict when it's sent for review."}`}
        onClose={onClose}
      />
      <div className="task-pick-list">
        <button type="button" className="task-pick-row" aria-pressed={task.reviewer === ANYONE} disabled={task.reviewer === ANYONE} onClick={() => pick(ANYONE)}>
          <span className="task-pick-glyph">
            <Icon name="at" size={14} />
          </span>
          <span className="task-pick-text">
            <span className="task-pick-name">Anyone</span>
            <span className="task-pick-about">Whoever hasn't worked on it</span>
          </span>
          {task.reviewer === ANYONE && <Icon name="check" size={14} />}
        </button>
        {people.map((p) => (
          <Choice key={p.name} channel={channel} person={p} on={p.name === task.reviewer} about={aboutOf(p)} onPick={() => pick(p.name)} />
        ))}
      </div>
    </Dialog>
  )
}

function Waits({ channel, waits }: { channel: Channel; waits: (PermissionAsk | QuestionAsk)[] }) {
  const { go } = useApp()
  return (
    <section className="panel-section" aria-label="Waiting on an answer">
      <div className="task-box is-waiting">
        <ul className="task-waits">
          {waits.map((a) => (
            <li key={a.id}>
              <p className="task-wait-text">{a.kind === "permission" ? a.summary : a.text}</p>
              <p className="task-wait-meta">
                {nickname(channel, a.from)} · {ago(a.at)}
              </p>
            </li>
          ))}
        </ul>
        <button type="button" className="btn is-small" onClick={() => go({ to: "tab", tab: "needs" })}>
          Answer in Needs you
        </button>
      </div>
    </section>
  )
}

function LinkedIssue({ channel, id }: { channel: Channel; id: number }) {
  const { go } = useApp()
  const issue = channel.issues?.find((i) => i.task === id)
  if (!issue) return null
  return (
    <button type="button" className="gh-task" onClick={() => go({ to: "panel", panel: { kind: "issue", repo: issue.repo, number: issue.number } })}>
      <IssueMark issue={issue} size={14} />
      <span className="gh-task-id num">#{issue.number}</span>
      <span className="gh-task-title">{issue.title}</span>
      <span className="gh-task-who">{issueWord(issue)}</span>
    </button>
  )
}

function Review({ channel, task }: { channel: Channel; task: Task }) {
  const { app, toast } = useApp()
  const [sending, setSending] = useState(false)
  const last: ReviewRound | undefined = task.rounds.at(-1)
  const yours = task.youReview !== undefined
  const brief = last?.result === "open" ? last.summary : undefined
  if (!yours && !brief) return null
  const owner = task.owner ? nickname(channel, task.owner) : null
  const ask =
    task.youReview === "send-back"
      ? `This waits for ${task.reviewer && task.reviewer !== ANYONE ? `${nickname(channel, task.reviewer)}'s` : "a"} review. You can still send it back.`
      : task.reviewer === channel.you
        ? owner
          ? `${owner} asks for your review.`
          : "This waits for your review."
        : task.reviewer === ANYONE
          ? "This waits for a review from someone who hasn't worked on it."
          : "This waits for a review."
  const sendBack = (why: string) => {
    app.actions.approveTask(channel.code, task.id, false, why)
    setSending(false)
    toast(`Sent T${task.id} back${owner ? ` to ${owner}` : ""}`)
  }
  const summary = brief && last && (
    <div className="tp-brief">
      <p className="tp-brief-head">Round {last.n} in short</p>
      <p className="tp-brief-text">{named(brief, channel.nicknames)}</p>
    </div>
  )
  if (!yours)
    return (
      <section className="panel-section" aria-label="Review">
        {summary}
      </section>
    )
  return (
    <section className="panel-section" aria-label="Review">
      <div className="task-box is-waiting tp-review">
        <p className="task-review-ask">{ask}</p>
        {summary}
        {sending ? (
          <SendBack onSend={sendBack} onCancel={() => setSending(false)} />
        ) : (
          <div className="actions">
            {task.youReview === "verdict" && (
              <button
                type="button"
                className="btn is-primary"
                onClick={() => {
                  app.actions.approveTask(channel.code, task.id, true)
                  toast(`Approved T${task.id}`)
                }}
              >
                Approve
              </button>
            )}
            <button type="button" className="btn" onClick={() => setSending(true)}>
              Send back
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function TaskMenu({ channel, task }: { channel: Channel; task: Task }) {
  const { app } = useApp()
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const label = `T${task.id}`
  return (
    <>
      <MoreButton
        label={label}
        groups={() => [
          [{ label: "Edit…", run: () => setEditing(true) }, ...(task.status === "done" ? [] : [{ label: "Cancel…", run: () => setCancelling(true) }])],
          [
            {
              label: "Delete…",
              run: () => app.actions.deleteTask(channel.code, task.id),
              confirm: { title: `Delete ${label}?`, sub: "It leaves the board and the counts. The history keeps one line saying you deleted it.", yes: "Delete task" },
            },
          ],
        ]}
      />
      <EditTask channel={channel} task={task} open={editing} onClose={() => setEditing(false)} />
      <Cancel channel={channel} task={task} open={cancelling} onClose={() => setCancelling(false)} />
    </>
  )
}

function EditTask({ channel, task, open, onClose }: { channel: Channel; task: Task; open: boolean; onClose: () => void }) {
  const { app } = useApp()
  const [title, setTitle] = useState(task.title)
  const [detail, setDetail] = useState(task.detail ?? "")
  const close = () => {
    setTitle(task.title)
    setDetail(task.detail ?? "")
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} label={`Edit T${task.id}`}>
      <DialogHead title={`Edit T${task.id}`} sub={task.owner ? `${someone(channel, task.owner)} sees the change in the task's history.` : "The change shows in the task's history."} onClose={close} />
      <form
        className="task-cancel task-edit"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          app.actions.editTask(channel.code, task.id, { title, detail })
          onClose()
        }}
      >
        <input className="input" value={title} aria-label="Title" placeholder="Title" maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="textarea" rows={8} value={detail} aria-label="Body" placeholder="What to do, where the code is and why" onChange={(e) => setDetail(e.target.value)} />
        <div className="dialog-foot">
          <button type="button" className="btn is-quiet" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn is-primary" disabled={!title.trim()}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function State({ channel, task, may }: { channel: Channel; task: Task; may: boolean }) {
  const { app } = useApp()
  return (
    <div className="tp-state">
      <p className="tp-status" title={`Created ${since(task.createdAt)}`}>
        <Dot status={task.status} />
        <span className={task.cancelled ? "dim" : TONES[task.status]}>{statusWord(task)}</span>
        {task.archived && <span className="dimmer">· archived</span>}
        <span className="dimmer">· {since(task.updatedAt)}</span>
      </p>
      {may && (
        <span className="tp-moves">
          {task.status === "done" ? (
            <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setTaskStatus(channel.code, task.id, "todo")}>
              Reopen
            </button>
          ) : (
            <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setTaskStatus(channel.code, task.id, "done")}>
              Mark done
            </button>
          )}
        </span>
      )}
    </div>
  )
}

function Cancel({ channel, task, open, onClose }: { channel: Channel; task: Task; open: boolean; onClose: () => void }) {
  const { app, toast } = useApp()
  const [why, setWhy] = useState("")
  const close = () => {
    setWhy("")
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} label={`Cancel T${task.id}?`}>
      <DialogHead title={`Cancel T${task.id}?`} sub={`It closes for everyone, marked cancelled${task.status === "review" ? ", and its open review round ends" : ""}.`} onClose={close} />
      <form
        className="task-cancel"
        onSubmit={(e) => {
          e.preventDefault()
          if (!why.trim()) return
          app.actions.cancelTask(channel.code, task.id, why.trim())
          toast(`Cancelled T${task.id}`)
          close()
        }}
      >
        <input
          className="input"
          value={why}
          aria-label="Why it's cancelled"
          placeholder={task.owner ? `Why, so ${someone(channel, task.owner)} knows` : "Why it's cancelled"}
          maxLength={500}
          onChange={(e) => setWhy(e.target.value)}
        />
        <div className="dialog-foot">
          <button type="button" className="btn is-quiet" onClick={close}>
            Keep it
          </button>
          <button type="submit" className="btn is-danger" disabled={!why.trim()}>
            Cancel task
          </button>
        </div>
      </form>
    </Dialog>
  )
}

const SHOWN = 6

const LONG = 280

function Activity({ channel, history }: { channel: Channel; history: TaskEvent[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? history : history.slice(-SHOWN)
  const hidden = history.length - shown.length
  return (
    <section className="panel-section">
      <Heading>Activity</Heading>
      {hidden > 0 && (
        <button type="button" className="task-change task-earlier" onClick={() => setAll(true)}>
          Show {hidden} earlier
        </button>
      )}
      <ol className="task-history">
        {shown.map((e) => (
          <Move key={`${e.seq}-${e.what}`} channel={channel} e={e} />
        ))}
      </ol>
    </section>
  )
}

function Move({ channel, e }: { channel: Channel; e: TaskEvent }) {
  const { go } = useApp()
  const [full, setFull] = useState(false)
  const note = e.note ? named(e.what === "mention" ? preview(e.note) : e.note, channel.nicknames) : ""
  const long = note.length > LONG
  const line = (
    <>
      <span className="task-move-who">{e.by === channel.you ? "You" : nickname(channel, e.by)}</span> {moveWords(channel, e)} <span className="dimmer num">· {ago(e.at)}</span>
    </>
  )
  return (
    <li className={cx("task-move", e.what === "cancelled" && "is-cancelled")}>
      {e.what === "mention" && e.root !== undefined ? (
        <button type="button" className="task-move-line task-move-open" onClick={() => go({ to: "panel", panel: { kind: "thread", seq: e.root ?? e.seq } })}>
          {line}
        </button>
      ) : (
        <p className="task-move-line">{line}</p>
      )}
      {note && <p className={cx("task-move-note", e.what === "mention" && "is-quote", long && !full && "is-cut")}>{note}</p>}
      {long && (
        <button type="button" className="task-change" onClick={() => setFull((v) => !v)}>
          {full ? "Show less" : "Show all"}
        </button>
      )}
    </li>
  )
}
