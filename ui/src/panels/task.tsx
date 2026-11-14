import "~/i18n/en/needs"
import "~/styles/task-panel.css"

import { AtIcon } from "@hugeicons/core-free-icons"
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"

import { EditHere } from "~/chat/editing"
import { Composer } from "~/chat/composer"
import { compactAt, quoteOf, useNames, useTaskIds } from "~/chat/conversation"
import { named } from "~/chat/linked"
import { MessageRow } from "~/chat/message"
import { preview } from "~/chat/preview"
import { jumpTo, ReplyContext, replyTo, type Quoting, type Replying } from "~/chat/reply"
import { QuotePick } from "~/chat/quote-pick"
import { useWhole } from "~/chat/whole"
import { ANYONE } from "@kiwi/channel/task-actions.ts"
import { autofocus, Avatar, cx, Dot, Heading, statusWord } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Modal } from "~/kit/modal"
import { GlyphIcon, Icon } from "~/kit/icons"
import { MoreButton } from "~/kit/menu-open"
import { ageOf, ago, lasting } from "~/kit/time"
import { memberOf, type Ask, type Channel, type PermissionAsk, type Person, type QuestionAsk, type ReviewRound, type Task, type TaskEvent, type TaskStep } from "~/model"
import { openMessage } from "~/live/open-message"
import { useGo, useActions, useToast } from "~/nav"
import { Body } from "~/chat/body"
import { detailParts } from "~/panels/task-detail"
import { nickname, Shown } from "~/names"
import { wordsPlain, wordsRaw, wrote } from "~/words"
import { IssueMark, issueWord, PrCard } from "~/github/parts"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { SENT } from "~/sent"
import { reasonWords } from "~/live/reason-words"
import { reasonText } from "@kiwi/core/routing-text.ts"
import { PanelHead } from "~/panels/frame"
import { moveWords, someone } from "~/panels/task-moves"
import { moverWords, quietWords, TROUBLES, useTaskNow } from "~/tasks/mover"
import { TONES } from "~/tasks/tones"
import { SendBack } from "~/tasks/send-back"
import { personGo } from "~/person-go"
import { viewImage } from "~/chat/image-view"

function since(at: number): string {
  const age = ageOf(at)
  if (age === "now") return t("panels.task.just.now")
  return age === "recent" ? t("panels.task.ago", { time: ago(at) }) : ago(at)
}

export const holds = (a: Ask, id: number): a is PermissionAsk | QuestionAsk =>
  a.kind === "permission" ? a.task === id && !a.answer : a.kind === "question" ? (a.task === id || a.holds.includes(id)) && !a.answer && !a.closed : false

const openImage = viewImage

const QUOTABLE = ".msg-body .md, .task-detail"

export function TaskPanel({ channel, id }: { channel: Channel; id: number }) {
  const task = channel.tasks.find((k) => k.id === id)
  const talk = useMemo(() => channel.messages.filter((m) => m.where.kind === "task" && m.where.task === id), [channel.messages, id])
  useWhole(channel.code, "task", talk)
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const bySeq = useMemo(() => new Map(channel.messages.map((m) => [m.seq, m])), [channel.messages])
  const body = useRef<HTMLDivElement>(null)
  const onQuote = useCallback(
    (seq: number) => {
      if (!jumpTo(body.current, seq)) openMessage(channel.code, seq)
    },
    [channel.code]
  )
  const where = `${channel.code}\n${id}`
  const [reply, setReply] = useState<{ where: string; quoting: Quoting } | null>(null)
  if (reply && reply.where !== where) setReply(null)
  const replying = useMemo((): Replying => ({ quoting: reply?.where === where ? reply.quoting : null, set: (quoting) => setReply(quoting ? { where, quoting } : null) }), [reply, where])
  const quoteMessage = useCallback(
    (seq: number, excerpt: string) => {
      const m = talk.find((x) => x.seq === seq)
      if (m) setReply({ where, quoting: replyTo(m, excerpt) })
    },
    [talk, where]
  )
  const quoteTask = useCallback((task: number, excerpt: string) => setReply({ where, quoting: { kind: "task", task, excerpt } }), [where])
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
        <Empty title={t("panels.task.gone")} />
      </>
    )
  const waits = channel.asks.filter((a) => holds(a, id))
  const parts = detailParts(wordsRaw(task.title), task.detail ? wordsRaw(task.detail) : undefined)
  const may = !memberOf(channel, channel.you)?.readOnly
  return (
    <ReplyContext.Provider value={may ? replying : null}>
      <EditHere.Provider value="panel">
        <PanelHead title={`T${task.id}`}>{may && <TaskMenu key={`menu-${task.id}`} channel={channel} task={task} />}</PanelHead>
        {may && <QuotePick root={body} body={QUOTABLE} onQuote={quoteMessage} onQuoteTask={quoteTask} />}
        <div key={task.id} ref={body} className="panel-body task-body tp">
          <section className="panel-section tp-top">
            <h3 className="task-title">
              <Shown value={wrote(parts.title)} />
            </h3>
            {parts.body && (
              <div className="task-detail" data-quote-task={task.id}>
                <Body text={wrote(parts.body)} seq={0} names={names} tasks={tasks} onImage={openImage} onMessage={onQuote} />
              </div>
            )}
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
              <Heading>{t("panels.task.conversation")}</Heading>
              {talk.map((m, i) => (
                <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(talk, i)} names={names} tasks={tasks} inThread quote={quoteOf(talk, i, bySeq)} onQuote={onQuote} />
              ))}
            </section>
          )}
        </div>
        <Composer key={`compose-${task.id}`} channel={channel} where={{ kind: "task", task: task.id }} placeholder={t("panels.task.message.in", { task: String(task.id) })} />
      </EditHere.Provider>
    </ReplyContext.Provider>
  )
}

function Who({ channel, name, markLeft = false }: { channel: Channel; name: string; markLeft?: boolean }) {
  const go = useGo()
  const person = memberOf(channel, name)
  return (
    <button type="button" className="task-who" title={markLeft && person?.left ? t("shell.sidebar.left.channel") : undefined} onClick={() => go(personGo(channel, name))}>
      <Avatar person={person} size="sm" />
      <span className="task-who-name">{nickname(channel, name)}</span>
      {markLeft && person?.left && <span className="dimmer mono">{t("shell.sidebar.left")}</span>}
      {name === channel.you && <span className="dimmer">{t("panels.task.you")}</span>}
    </button>
  )
}

export function stepState(step: TaskStep, now: number): string | null {
  if (step.state === "done") return t("panels.task.step.done")
  if (step.state === "skipped") return t("panels.task.step.skipped")
  if (step.state !== "current") return null
  if (step.wait) return t("panels.task.step.waits", { time: lasting(step.wait.until - now) })
  if (step.run) return t("panels.task.step.run", { time: lasting(step.run.due - now) })
  return step.trouble ? t(TROUBLES[step.trouble]) : t("panels.task.step.current")
}

function Steps({ channel, task, steps, now }: { channel: Channel; task: Task; steps: TaskStep[]; now: number }) {
  const actions = useActions()
  return (
    <ol className="tp-steps">
      {steps.map((step) => {
        const state = stepState(step, now)
        const waiting = step.wait
        return (
          <li key={step.id} className={cx("tp-step", `is-${step.state}`)} aria-current={step.state === "current" ? "step" : undefined}>
            <span className="tp-step-words">
              <Shown value={step.words} />
            </span>
            <span className="tp-step-meta">
              {[step.by ? nickname(channel, step.by) : null, state].filter(Boolean).join(" · ")}
              {waiting && (
                <>
                  {": "}
                  <Shown value={waiting.reason} />
                </>
              )}
            </span>
            {step.yours && (
              <button type="button" className="btn is-small" onClick={() => actions.endStep(channel.code, task.id, step.id)}>
                {t("panels.task.step.end")}
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Props({ channel, task, may }: { channel: Channel; task: Task; may: boolean }) {
  const [picking, setPicking] = useState<"owner" | "reviewer" | null>(null)
  const open = may && task.status !== "done"
  const now = useTaskNow()
  const move = moverWords(channel, task, now)
  const quiet = quietWords(channel, task, now)
  return (
    <>
      <dl className="props task-props tp-props">
        <dt>{t("panels.task.owner")}</dt>
        <dd>
          {task.owner ? <Who channel={channel} name={task.owner} /> : <span className="dimmer">{t("panels.task.nobody.yet")}</span>}
          {open && (
            <button type="button" className="task-change" onClick={() => setPicking("owner")}>
              {task.owner ? t("panels.task.reassign") : t("panels.task.assign")}
            </button>
          )}
        </dd>
        {(task.reviewer || open) && (
          <>
            <dt>{t("panels.task.reviewer")}</dt>
            <dd>
              {!task.reviewer ? (
                <button type="button" className="task-change tp-ask" onClick={() => setPicking("reviewer")}>
                  {t("panels.task.ask.review")}
                </button>
              ) : (
                <>
                  {task.reviewer === ANYONE ? <span>{t("panels.task.anyone.unworked")}</span> : <Who channel={channel} name={task.reviewer} markLeft />}
                  {open && (
                    <button type="button" className="task-change" onClick={() => setPicking("reviewer")}>
                      {t("panels.task.change")}
                    </button>
                  )}
                </>
              )}
            </dd>
          </>
        )}
        {move && (
          <>
            <dt>{t("panels.task.move")}</dt>
            <dd className="tp-move">
              <span>{move}</span>
              {quiet && <span className="tone-alert">{quiet}</span>}
            </dd>
          </>
        )}
        {task.steps && (
          <>
            <dt>{t("panels.task.steps")}</dt>
            <dd>
              <Steps channel={channel} task={task} steps={task.steps} now={now} />
            </dd>
          </>
        )}
        {task.closedWith && (
          <>
            <dt>{t("panels.task.closed")}</dt>
            <dd>{tr("panels.task.closed.without", { why: <Shown value={task.closedWith} /> })}</dd>
          </>
        )}
        <dt>{t("panels.task.asked.by")}</dt>
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
  const actions = useActions()
  const toast = useToast()
  return (
    <div className="task-suggest">
      <Avatar person={memberOf(channel, suggested.name)} size="sm" />
      <p className="task-suggest-text">
        <span className="dimmer">{t("panels.task.suggested")}</span> {nickname(channel, suggested.name)} <span className="dim">· {reasonWords(suggested.reason)}</span>
      </p>
      <button
        type="button"
        className="btn is-small"
        onClick={() => {
          actions.assignTask(channel.code, task.id, suggested.name, suggested.reason ? reasonText(suggested.reason) : SENT.hasContext)
          toast(t("panels.task.yours.now", { task: String(task.id), name: nickname(channel, suggested.name) }))
        }}
      >
        {t("panels.task.assign")}
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
          {person.you && <span className="dimmer">{t("panels.task.choice.you")}</span>}
        </span>
        <span className="task-pick-about">{about}</span>
      </span>
      {on && <Icon name="check" size={14} />}
    </button>
  )
}

const agentsFirst = (a: Person, b: Person): number => (a.kind === b.kind ? 0 : a.kind === "agent" ? -1 : 1)

const aboutOf = (p: Person): string =>
  [
    p.kind === "agent" ? t("panels.task.about.agent") : t("panels.task.about.person"),
    p.role === "lead" ? t("panels.task.about.lead") : undefined,
    p.load?.doing.length ? t("panels.task.about.on", { tasks: p.load.doing.map((n) => `T${n}`).join(", ") }) : undefined,
  ]
    .filter(Boolean)
    .join(" · ")

export function Assign({ channel, task, open, onClose }: { channel: Channel; task: Task; open: boolean; onClose: () => void }) {
  const actions = useActions()
  const toast = useToast()
  const [why, setWhy] = useState("")
  const close = () => {
    setWhy("")
    onClose()
  }
  const people = channel.people.filter((p) => !p.left && !p.readOnly)
  const first = task.suggested ? people.filter((p) => p.name === task.suggested?.name) : []
  const rest = people.filter((p) => p.name !== task.suggested?.name).sort(agentsFirst)
  const pick = (name: string) => {
    actions.assignTask(channel.code, task.id, name, why.trim() || (name === task.suggested?.name ? (task.suggested.reason ? reasonText(task.suggested.reason) : SENT.hasContext) : ""))
    toast(t("panels.task.yours.now", { task: String(task.id), name: nickname(channel, name) }))
    close()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      label={t("panels.task.who.works", { task: String(task.id) })}
      title={t("panels.task.who.works", { task: String(task.id) })}
      sub={task.owner ? t("panels.task.assign.sub.now", { name: someone(channel, task.owner) }) : t("panels.task.assign.sub")}
    >
      <div className="task-pick">
        <input
          ref={autofocus}
          className="input"
          value={why}
          aria-label={t("panels.task.note.label")}
          placeholder={t("panels.task.note.placeholder")}
          maxLength={300}
          onChange={(e) => setWhy(e.target.value)}
        />
        <div className="task-pick-list">
          {[...first, ...rest].map((p) => (
            <Choice
              key={p.name}
              channel={channel}
              person={p}
              on={p.name === task.owner}
              about={p.name === task.suggested?.name ? t("panels.task.suggested.about", { why: reasonWords(task.suggested.reason) }) : aboutOf(p)}
              onPick={() => pick(p.name)}
            />
          ))}
        </div>
      </div>
    </Modal>
  )
}

export function PickReviewer({ channel, task, open, onClose }: { channel: Channel; task: Task; open: boolean; onClose: () => void }) {
  const actions = useActions()
  const toast = useToast()
  const people = channel.people.filter((p) => !p.left && !p.readOnly && p.name !== task.owner).sort(agentsFirst)
  const pick = (name: string) => {
    actions.setReviewer(channel.code, task.id, name)
    toast(name === ANYONE ? t("panels.task.anyone.reviews", { task: String(task.id) }) : t("panels.task.reviews", { name: nickname(channel, name), task: String(task.id) }))
    onClose()
  }
  const name = task.reviewer ? someone(channel, task.reviewer) : ""
  const current = task.reviewer && memberOf(channel, task.reviewer)?.left ? `${name} (${t("shell.sidebar.left")})` : name
  const now = task.reviewer ? (task.reviewer === ANYONE ? t("panels.task.reviewer.now.anyone") : t("panels.task.reviewer.now", { name: current })) : ""
  const verdict = task.status === "review" ? t("panels.task.reviewer.open") : t("panels.task.reviewer.later")
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={t("panels.task.who.reviews", { task: String(task.id) })}
      title={t("panels.task.who.reviews", { task: String(task.id) })}
      sub={now ? t("panels.task.reviewer.sub", { now, verdict }) : verdict}
    >
      <div className="task-pick-list">
        <button type="button" className="task-pick-row" aria-pressed={task.reviewer === ANYONE} disabled={task.reviewer === ANYONE} onClick={() => pick(ANYONE)}>
          <span className="task-pick-glyph">
            <GlyphIcon glyph={AtIcon} size={14} />
          </span>
          <span className="task-pick-text">
            <span className="task-pick-name">{t("panels.task.anyone")}</span>
            <span className="task-pick-about">{t("panels.task.anyone.about")}</span>
          </span>
          {task.reviewer === ANYONE && <Icon name="check" size={14} />}
        </button>
        {people.map((p) => (
          <Choice key={p.name} channel={channel} person={p} on={p.name === task.reviewer} about={aboutOf(p)} onPick={() => pick(p.name)} />
        ))}
      </div>
    </Modal>
  )
}

function Waits({ channel, waits }: { channel: Channel; waits: (PermissionAsk | QuestionAsk)[] }) {
  const go = useGo()
  return (
    <section className="panel-section" aria-label={t("panels.task.waiting.label")}>
      <div className="task-box is-waiting">
        <ul className="task-waits">
          {waits.map((a) => (
            <li key={a.id}>
              <p className="task-wait-text">{a.kind === "permission" ? a.summary : wordsPlain(a.text, channel.nicknames)}</p>
              <p className="task-wait-meta">
                {nickname(channel, a.from)} · {ago(a.at)}
              </p>
            </li>
          ))}
        </ul>
        <button type="button" className="btn is-small" onClick={() => go({ to: "tab", tab: "needs" })}>
          {t("panels.task.answer.in.needs")}
        </button>
      </div>
    </section>
  )
}

function LinkedIssue({ channel, id }: { channel: Channel; id: number }) {
  const go = useGo()
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
  const actions = useActions()
  const toast = useToast()
  const [sending, setSending] = useState(false)
  const last: ReviewRound | undefined = task.rounds.at(-1)
  const yours = task.youReview !== undefined
  const brief = last?.result === "open" ? last.summary : undefined
  if (!yours && !brief) return null
  const owner = task.owner ? nickname(channel, task.owner) : null
  const ask =
    task.youReview === "send-back"
      ? task.reviewer && task.reviewer !== ANYONE
        ? t("panels.task.review.send.back.named", { name: nickname(channel, task.reviewer) })
        : t("panels.task.review.send.back")
      : task.reviewer === channel.you
        ? owner
          ? t("panels.task.review.asks", { owner })
          : t("panels.task.review.yours")
        : task.reviewer === ANYONE
          ? t("panels.task.review.unworked")
          : t("panels.task.review.waits")
  const sendBack = (why: string) => {
    actions.approveTask(channel.code, task.id, false, why)
    setSending(false)
    toast(owner ? t("panels.task.sent.back.to", { task: String(task.id), name: owner }) : t("panels.task.sent.back", { task: String(task.id) }))
  }
  const summary = brief && last && (
    <div className="tp-brief">
      <p className="tp-brief-head">{t("panels.task.round.short", { n: last.n })}</p>
      <p className="tp-brief-text">{wordsPlain(brief, channel.nicknames)}</p>
    </div>
  )
  if (!yours)
    return (
      <section className="panel-section" aria-label={t("panels.task.review.label")}>
        {summary}
      </section>
    )
  return (
    <section className="panel-section" aria-label={t("panels.task.review.label")}>
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
                  actions.approveTask(channel.code, task.id, true)
                  toast(t("panels.task.approved", { task: String(task.id) }))
                }}
              >
                {t("panels.task.approve")}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setSending(true)}>
              {t("panels.task.send.back")}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function TaskMenu({ channel, task }: { channel: Channel; task: Task }) {
  const actions = useActions()
  const [editing, setEditing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const label = `T${task.id}`
  return (
    <>
      <MoreButton
        label={label}
        groups={() => [
          [{ label: t("panels.task.menu.edit"), run: () => setEditing(true) }, ...(task.status === "done" ? [] : [{ label: t("panels.task.menu.cancel"), run: () => setCancelling(true) }])],
          [
            {
              label: t("panels.task.menu.delete"),
              run: () => actions.deleteTask(channel.code, task.id),
              confirm: { title: t("panels.task.delete.title", { task: String(task.id) }), sub: t("panels.task.delete.sub"), yes: t("panels.task.delete.yes") },
            },
          ],
        ]}
      />
      <EditTask channel={channel} task={task} open={editing} onClose={() => setEditing(false)} />
      <Cancel channel={channel} task={task} open={cancelling} onClose={() => setCancelling(false)} />
    </>
  )
}

export function EditTask({ channel, task, open, onClose }: { channel: Channel; task: Task; open: boolean; onClose: () => void }) {
  const actions = useActions()
  const [title, setTitle] = useState(wordsRaw(task.title))
  const [detail, setDetail] = useState(task.detail ? wordsRaw(task.detail) : "")
  const close = () => {
    setTitle(wordsRaw(task.title))
    setDetail(task.detail ? wordsRaw(task.detail) : "")
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      label={t("panels.task.edit.heading", { task: String(task.id) })}
      title={t("panels.task.edit.heading", { task: String(task.id) })}
      sub={task.owner ? t("panels.task.edit.sub.owner", { name: someone(channel, task.owner) }) : t("panels.task.edit.sub")}
    >
      <form
        className="task-cancel task-edit"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          actions.editTask(channel.code, task.id, { title, detail })
          onClose()
        }}
      >
        <input
          ref={autofocus}
          className="input"
          value={title}
          aria-label={t("panels.task.edit.title")}
          placeholder={t("panels.task.edit.title")}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="textarea"
          rows={8}
          value={detail}
          aria-label={t("panels.task.edit.body")}
          placeholder={t("panels.task.edit.body.placeholder")}
          onChange={(e) => setDetail(e.target.value)}
        />
        <div className="modal-foot">
          <button type="button" className="btn is-quiet" onClick={close}>
            {t("panels.task.edit.cancel")}
          </button>
          <button type="submit" className="btn is-primary" disabled={!title.trim()}>
            {t("panels.task.edit.save")}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function State({ channel, task, may }: { channel: Channel; task: Task; may: boolean }) {
  const actions = useActions()
  return (
    <div className="tp-state">
      <p className="tp-status" title={t("panels.task.created", { when: since(task.createdAt) })}>
        <Dot status={task.status} />
        <span className={task.cancelled ? "dim" : TONES[task.status]}>{statusWord(task)}</span>
        {task.archived && <span className="dimmer">{t("panels.task.archived")}</span>}
        <span className="dimmer">· {since(task.updatedAt)}</span>
      </p>
      {may && (
        <span className="tp-moves">
          {task.status === "done" ? (
            <button type="button" className="btn is-quiet is-small" onClick={() => actions.setTaskStatus(channel.code, task.id, "todo")}>
              {t("panels.task.reopen")}
            </button>
          ) : (
            <button type="button" className="btn is-quiet is-small" onClick={() => actions.setTaskStatus(channel.code, task.id, "done")}>
              {t("panels.task.mark.done")}
            </button>
          )}
        </span>
      )}
    </div>
  )
}

export function Cancel({ channel, task, open, onClose }: { channel: Channel; task: Task; open: boolean; onClose: () => void }) {
  const actions = useActions()
  const toast = useToast()
  const [why, setWhy] = useState("")
  const close = () => {
    setWhy("")
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      label={t("panels.task.cancel.title", { task: String(task.id) })}
      title={t("panels.task.cancel.title", { task: String(task.id) })}
      sub={task.status === "review" ? t("panels.task.cancel.sub.review") : t("panels.task.cancel.sub")}
    >
      <form
        className="task-cancel"
        onSubmit={(e) => {
          e.preventDefault()
          if (!why.trim()) return
          actions.cancelTask(channel.code, task.id, why.trim())
          toast(t("panels.task.cancelled", { task: String(task.id) }))
          close()
        }}
      >
        <input
          ref={autofocus}
          className="input"
          value={why}
          aria-label={t("panels.task.cancel.why")}
          placeholder={task.owner ? t("panels.task.cancel.why.owner", { name: someone(channel, task.owner) }) : t("panels.task.cancel.why")}
          maxLength={500}
          onChange={(e) => setWhy(e.target.value)}
        />
        <div className="modal-foot">
          <button type="button" className="btn is-quiet" onClick={close}>
            {t("panels.task.cancel.keep")}
          </button>
          <button type="submit" className="btn is-danger" disabled={!why.trim()}>
            {t("panels.task.cancel.yes")}
          </button>
        </div>
      </form>
    </Modal>
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
      <Heading>{t("panels.task.activity")}</Heading>
      {hidden > 0 && (
        <button type="button" className="task-change task-earlier" onClick={() => setAll(true)}>
          {t("panels.task.show.earlier", { count: hidden })}
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
  const go = useGo()
  const [full, setFull] = useState(false)
  const note = e.note ? named(e.what === "mention" ? preview(wordsRaw(e.note)) : wordsRaw(e.note), channel.nicknames) : ""
  const long = note.length > LONG
  const line = (
    <>
      {tr("panels.task.move.line", { who: <span className="task-move-who">{e.by === channel.you ? t("panels.task.move.you") : nickname(channel, e.by)}</span>, what: moveWords(channel, e) })}{" "}
      <span className="dimmer num">· {ago(e.at)}</span>
    </>
  )
  return (
    <li className={cx("task-move", e.what === "cancelled" && "is-cancelled")}>
      {e.what === "mention" && e.root !== undefined ? (
        <button
          type="button"
          className="task-move-line task-move-open"
          onClick={() => {
            const root = e.root ?? e.seq
            go((channel.specs ?? []).some((s) => s.ask === root) ? { to: "spec", ask: root, part: "spec" } : { to: "panel", panel: { kind: "thread", seq: root } })
          }}
        >
          {line}
        </button>
      ) : (
        <p className="task-move-line">{line}</p>
      )}
      {note && <p className={cx("task-move-note", e.what === "mention" && "is-quote", long && !full && "is-cut")}>{note}</p>}
      {long && (
        <button type="button" className="task-change" onClick={() => setFull((v) => !v)}>
          {full ? t("panels.task.show.less") : t("panels.task.show.all")}
        </button>
      )}
    </li>
  )
}
