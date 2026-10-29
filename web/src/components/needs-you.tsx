import { CheckmarkCircle02Icon, Globe02Icon, HelpCircleIcon, Key01Icon } from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { useState, type ReactNode } from "react"

import { freeHandle, seededPick } from "@kiwi/core/handles.ts"
import { nameKey, type JoinRequest, type PersonPowers } from "@kiwi/core/membership.ts"
import { HANDOFF_DONE, HANDOFF_FAILED, type Message, type StepReply } from "@kiwi/core/protocol.ts"
import { TOO_MANY_REQUESTS } from "@kiwi/core/sas.ts"
import { taskId, type Task } from "@kiwi/core/state.ts"
import { usePinned } from "@/lib/pinned"
import { noteFor, showLabel, showSeat, useSeatPlaces, type PlacedSeat, type ShowResult } from "@kiwi/app/show-seat.ts"
import { cx } from "@/lib/utils"
import { askLabel, permissionAsks } from "@kiwi/app/asks.ts"
import { excerpt, formatAgo } from "@kiwi/app/format.ts"
import { openHandoff } from "@/lib/handoff-open"
import { handoffLabel, handoffLeft, handoffOf, handoffOpen } from "@kiwi/app/handoff.ts"
import { useControls } from "./controls"
import { Icon } from "./icon"
import { Button, Checkbox, Monogram, TextField, errorText, toast } from "./kit"
import { PermissionItem } from "./lazy"
import { StepDetails, StepResponse, stepReplyText } from "./step-card"
import { defaultPowers, defaultScopes, POWER_WORDS, POWERS } from "./scopes"
import { AgentFacts } from "./agent-facts"

/**
 * The one place a person acts: who wants in, what agents escalated to them, work waiting on their
 * review. Everything else the channel just says.
 */
export function NeedsYou({
  now,
  roomId,
  me,
  decisions,
  escalations,
  questions,
  reviews,
  nameOf,
  agentOf,
  heldOf,
  onReply,
  permissionOf,
  onPermission,
  onApproveTask,
  onSendBack,
  onOpenTask,
  onJump,
  titled,
}: {
  now: number
  roomId: string
  me: string
  /** Asks to this person by name: the oldest also waits above the composer, where it is answered. */
  decisions: Message[]
  /** Escalations to this person nobody has answered yet. */
  escalations: Message[]
  questions: Message[]
  /** Tasks in review that this person may approve. */
  reviews: Task[]
  nameOf: (name: string) => string
  agentOf: (name: string) => boolean
  heldOf: (m: Message) => string[]
  onReply: (m: Message, text: string, stepReply?: StepReply) => Promise<void>
  permissionOf: (m: Message) => { human: string | null; owner: string | null }
  onPermission: (m: Message, allow: boolean) => Promise<void>
  onApproveTask: (t: Task) => Promise<void>
  onSendBack: (t: Task, why: string) => Promise<void>
  onOpenTask: (id: number) => void
  onJump: (seq: number) => void
  /** The header already names this list (the Needs you view on a phone): its own heading goes there. */
  titled?: boolean
}) {
  const { p } = useControls()
  const seats = useSeatPlaces()
  const seatOf = (agent: string | undefined) => (agent ? seats.find((s) => s.room === roomId && s.agent === agent) : undefined)
  const reviewSeat = (t: Task) => seatOf(t.owner ?? t.workedBy[t.workedBy.length - 1])
  const requests = p.isOwner ? p.requests : []
  const asked = (ms: Message[]) => ms.filter((m) => !m.permission)
  const permissions = permissionAsks({ decisions, escalations }, now)
  const items: { key: string; node: ReactNode }[] = [
    ...permissions.map(({ m, p: perm }) => {
      const { human, owner } = permissionOf(m)
      return {
        key: `a${m.seq}`,
        node: (
          <PermissionItem
            m={m}
            p={perm}
            now={now}
            nameOf={nameOf}
            onAnswer={onPermission}
            seat={seatOf(m.from)}
            canAllow={human === me && perm.canAllow}
            canDeny={human === me || owner === me}
            human={human}
          />
        ),
      }
    }),
    ...requests.map((r) => ({ key: `r${r.id}`, node: <RequestItem r={r} roomId={roomId} now={now} /> })),
    ...[...asked(decisions), ...asked(escalations), ...questions].map((m) => ({
      key: `a${m.seq}`,
      node: <AskItem m={m} me={me} now={now} nameOf={nameOf} agent={agentOf(m.from)} held={heldOf(m)} onReply={onReply} onJump={onJump} seat={seatOf(m.from)} />,
    })),
    ...reviews.map((t) => ({
      key: `t${t.id}`,
      node: <ReviewItem t={t} nameOf={nameOf} onApprove={onApproveTask} onSendBack={onSendBack} onOpen={onOpenTask} seat={reviewSeat(t)} />,
    })),
  ]
  if (!items.length) return null
  return (
    <section aria-label="Needs you" className="mt-4 rounded-card border border-line bg-canvas p-1.5">
      <h2 className={cx("flex items-baseline gap-2 px-2 pt-1 pb-0.5 text-ui font-semibold", titled && "max-md:hidden")}>
        Needs you <span className="font-normal text-ink-3 tabular-nums">{items.length}</span>
      </h2>
      {requests.some((r) => r.check === "unchecked") && <p className="mt-1 px-2 text-meta leading-normal text-ink-3">{TOO_MANY_REQUESTS}</p>}
      <ul className="space-y-0.5">
        {items.map((i) => (
          <li key={i.key}>{i.node}</li>
        ))}
      </ul>
    </section>
  )
}

export function Row({
  icon,
  lead,
  title,
  aside,
  detail,
  below,
  children,
}: {
  icon?: IconSvgElement
  lead?: ReactNode
  title: ReactNode
  aside?: ReactNode
  detail?: ReactNode
  below?: ReactNode
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-2 py-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {lead ?? <span className="flex size-7 shrink-0 items-center justify-center rounded-row border border-edge-strong text-decide">{icon && <Icon icon={icon} size={15} />}</span>}
          {detail ? (
            <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-1.5 text-left text-body leading-snug">
              <span className="min-w-0 truncate">{title}</span>
              <span
                aria-hidden
                className={cx("mx-1 size-1.5 shrink-0 border-r-[1.5px] border-b-[1.5px] border-ink-3 transition-transform", open ? "translate-y-0.5 rotate-[225deg]" : "-translate-y-0.5 rotate-45")}
              />
            </button>
          ) : (
            <p className="min-w-0 truncate text-body leading-snug">{title}</p>
          )}
          {aside}
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-2 pl-10 md:pl-0">{children}</div>}
      </div>
      {below && <div className="mt-2 pl-10">{below}</div>}
      {open && detail && <div className="mt-1.5 pl-10 text-meta leading-snug text-ink-3">{detail}</div>}
    </div>
  )
}

export function ShowSeat({ seat }: { seat?: PlacedSeat }) {
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!seat) return null
  const open = () => {
    setBusy(true)
    setNote(null)
    void showSeat(seat)
      .catch((): ShowResult => ({ ok: false, why: "failed" }))
      .then((r) => noteFor(seat.place, r))
      .then(setNote)
      .finally(() => setBusy(false))
  }
  return (
    <>
      <Button size="sm" variant="ghost" disabled={busy} onClick={open}>
        {showLabel(seat.place)}
      </Button>
      {note && <span className="text-meta text-ink-3">{note}</span>}
    </>
  )
}

/** Someone asking to join: compare the code, then one click. Whether it can only read is the default this browser keeps; "Choose…" to change it. */
function RequestItem({ r, roomId, now }: { r: JoinRequest; roomId: string; now: number }) {
  const { p, busy, run, ask } = useControls()
  // A name someone here took since the request was listed (a race: a taken name usually comes offered as a free one): let it in under another.
  const taken = r.kind !== "human" && p.roster.some((m) => m.active && m.pk !== r.pk && nameKey(m.name) === nameKey(r.name))
  const [rename, setRename] = useState(() => (taken ? freeHandle(p.roster, seededPick(r.pk)) : ""))
  // Whose computer it runs on, from its verified computer claim (not the relay's word).
  const who = r.kind === "human" ? (r.person ? `A person · key ${r.person.slice(0, 8)}` : "A person") : r.computer ? `An agent on ${r.computer.personName}’s ${r.computer.label}` : "An agent"
  const lead = <Monogram name={r.display || r.name} hue={r.name} agent={r.kind !== "human"} size={28} />
  const ready = r.check === "ready"
  const pinnedAs = usePinned(r.pin)
  const [powers, setPowers] = useState<PersonPowers>(() => (r.kind === "human" ? defaultPowers(roomId) : {}))
  return (
    <Row
      lead={lead}
      title={
        <>
          <span className="font-medium">{r.display || r.name}</span>
          {r.display && <span className="text-ink-3"> @{r.name}</span>} wants to join
          {r.pin && <span className="text-ink-2">{pinnedAs === null ? `, pinned as ${r.pin.name}, which isn't on your account as it was` : `, pinned as ${r.pin.name}`}</span>}
        </>
      }
      aside={ready && r.code && <span className="shrink-0 font-semibold tracking-[0.04em] whitespace-nowrap text-ink tabular-nums">{r.code}</span>}
      detail={
        <>
          {who} · asked {formatAgo(r.ts, now)}
          {r.kind !== "human" && <AgentFacts card={r.card} runs={r.runs} said repos={p.state.repos} className="mt-1" />}
          {ready && r.code && <span className="mt-1.5 block">Let it in only if {r.kind === "human" ? "they see" : "its terminal shows"} the same code.</span>}
          {r.kind === "human" && ready && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-ink-2">
              {POWERS.map((power) => (
                <label key={power} className="flex items-center gap-2">
                  <Checkbox checked={!!powers[power]} onChange={(e) => setPowers({ ...powers, [power]: e.target.checked })} disabled={busy} />
                  {POWER_WORDS[power].label}
                </label>
              ))}
            </span>
          )}
          {ready && !taken && (
            <span className="mt-1.5 block">
              <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => ask({ kind: "approve", req: r, powers })}>
                Choose what it can do…
              </Button>
            </span>
          )}
        </>
      }
      below={
        ready &&
        taken && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const name = rename.trim()
              if (name) void run(() => p.onApprove({ ...r, name }, defaultScopes(roomId)), `${r.name} joined as ${name}`)
            }}
          >
            <span className="text-meta text-ink-2">{r.name} is taken here. It matches: let in as</span>
            <TextField value={rename} onChange={(e) => setRename(e.target.value)} maxLength={32} aria-label="Name to let it in as" className="w-36" />
            <Button size="sm" variant="secondary" type="submit" disabled={busy || !rename.trim() || p.roster.some((m) => m.active && nameKey(m.name) === nameKey(rename.trim()))}>
              Let in
            </Button>
          </form>
        )
      }
    >
      {ready && !taken ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || (!!r.pin && pinnedAs === undefined)}
          onClick={() => run(() => p.onApprove(r, defaultScopes(roomId), pinnedAs ?? undefined, powers), pinnedAs ? `${r.name} joined as ${pinnedAs.name}` : `${r.name} joined`)}
        >
          {pinnedAs ? `It matches: let in as ${pinnedAs.name}` : "It matches: let in"}
        </Button>
      ) : r.check === "unchecked" ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => p.onCheck(r), `Asked ${r.name} for its code`)}>
          Show code
        </Button>
      ) : (
        !ready && <span className="text-meta text-ink-3">Waiting for {r.kind === "human" ? "their" : "its"} code…</span>
      )}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => p.onDeny(r), `Declined ${r.name}`)}>
        Decline
      </Button>
    </Row>
  )
}

/** An agent handing a decision or step to its person: what it says, and an answer right here. */
function AskItem({
  m,
  me,
  now,
  nameOf,
  agent,
  held,
  onReply,
  onJump,
  seat,
}: {
  m: Message
  me: string
  now: number
  nameOf: (n: string) => string
  agent: boolean
  held: string[]
  onReply: (m: Message, text: string, stepReply?: StepReply) => Promise<void>
  onJump: (seq: number) => void
  seat?: PlacedSeat
}) {
  const { draft, setDraft, busy, send } = useAnswer(m, nameOf, onReply, null)
  const handoff = handoffOf(m)
  const live = !!handoff && handoffOpen(handoff, now)
  return (
    <Row
      icon={handoff ? Globe02Icon : m.esc ? Key01Icon : HelpCircleIcon}
      title={
        <>
          {m.esc && <span className="mr-1.5 rounded-full bg-decide-wash px-1.5 align-middle text-meta font-semibold text-decide">{askLabel(m, me)}</span>}
          <span className="font-semibold">{nameOf(m.from)}</span> {excerpt(m.body, 220)}
        </>
      }
      detail={
        <>
          <p className="text-ui leading-normal whitespace-pre-wrap text-ink-2">{excerpt(m.body, 2000)}</p>
          {m.step && (
            <div className="mt-2">
              <StepDetails step={m.step} />
            </div>
          )}
          <p className="mt-1">
            {[
              held.length ? `holds ${held.join(", ")}` : null,
              `${handoff ? "Browser for you" : askLabel(m, me)} from ${nameOf(m.from)}${agent ? "" : " (a person)"}`,
              formatAgo(m.ts, now),
              handoff ? `${handoffLabel(handoff)} · ${live ? handoffLeft(handoff, now) : "link expired"}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => onJump(m.seq)}>
              Show in the conversation
            </Button>
            <ShowSeat seat={seat} />
          </span>
        </>
      }
      below={
        m.step || draft !== null ? (
          <>
            {m.step && draft === null && <StepResponse id={m.seq} disabled={busy} onAnswer={(reply) => send(stepReplyText(reply), reply)} onElse={() => setDraft("")} />}
            {draft !== null && <AnswerForm draft={draft} setDraft={setDraft} busy={busy} send={send} to={nameOf(m.from)} autoFocus onEscape={() => setDraft(null)} />}
          </>
        ) : undefined
      }
    >
      {draft === null && !m.step && (
        <>
          {!handoff &&
            m.choices?.map((c) => (
              <Button key={c} size="sm" variant="secondary" disabled={busy} title={c} onClick={() => void send(c)} className="max-w-60 min-w-0">
                <span className="truncate">{c}</span>
              </Button>
            ))}
          {handoff && live && (
            <>
              <Button size="sm" variant="secondary" onClick={() => !openHandoff(handoff) && toast("The link has expired", "error")}>
                Open browser
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void send(HANDOFF_DONE)}>
                Done
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send(HANDOFF_FAILED)}>
                Couldn’t
              </Button>
            </>
          )}
          <Button size="sm" variant={m.choices?.length ? "ghost" : "secondary"} onClick={() => setDraft("")}>
            {m.choices?.length ? "Something else" : "Answer"}
          </Button>
        </>
      )}
    </Row>
  )
}

function useAnswer(m: Message, nameOf: (n: string) => string, onReply: (m: Message, text: string, stepReply?: StepReply) => Promise<void>, idle: string | null) {
  const [draft, setDraft] = useState<string | null>(idle)
  const [busy, setBusy] = useState(false)
  const send = async (text = draft?.trim() ?? "", stepReply?: StepReply): Promise<boolean> => {
    if (!text) return false
    setBusy(true)
    try {
      await onReply(m, text, stepReply)
      setDraft(idle)
      toast(`Answered ${nameOf(m.from)}`)
      return true
    } catch (err) {
      toast(`Not sent: ${errorText(err)}`, "error")
      return false
    } finally {
      setBusy(false)
    }
  }
  return { draft, setDraft, busy, send }
}

function AnswerForm({
  draft,
  setDraft,
  busy,
  send,
  to,
  autoFocus,
  onEscape,
}: {
  draft: string
  setDraft: (draft: string) => void
  busy: boolean
  send: (text?: string) => Promise<boolean>
  to: string
  autoFocus: boolean
  onEscape: () => void
}) {
  return (
    <form
      className="flex w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void send(draft.trim())
      }}
    >
      <TextField
        autoFocus={autoFocus}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onEscape()}
        placeholder={`Answer ${to}`}
        aria-label="Answer"
        className="flex-1"
      />
      <Button size="sm" variant="secondary" type="submit" disabled={busy || !draft.trim()}>
        Send
      </Button>
    </form>
  )
}

/** Work an agent says is finished, waiting on this person's word. */
function ReviewItem({
  t,
  nameOf,
  onApprove,
  onSendBack,
  onOpen,
  seat,
}: {
  t: Task
  nameOf: (n: string) => string
  onApprove: (t: Task) => Promise<void>
  onSendBack: (t: Task, why: string) => Promise<void>
  onOpen: (id: number) => void
  seat?: PlacedSeat
}) {
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await fn()
      setWhy(null)
      toast(done)
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Row
      icon={CheckmarkCircle02Icon}
      title={
        <>
          <span className="text-ink-3 tabular-nums">{taskId(t.id)}</span> {t.title}
        </>
      }
      detail={
        <>
          Ready for your review{t.owner ? ` · done by ${nameOf(t.owner)}` : ""} · check the work itself, not just the word
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" className="-ml-2.5" onClick={() => onOpen(t.id)}>
              Open the task
            </Button>
            <ShowSeat seat={seat} />
          </span>
        </>
      }
      below={
        why !== null && (
          <form
            className="flex w-full items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (why.trim()) void act(() => onSendBack(t, why.trim()), `Sent ${taskId(t.id)} back`)
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
        )
      }
    >
      {why === null && (
        <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => onApprove(t), `Approved ${taskId(t.id)}`)}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWhy("")}>
            Send back
          </Button>
        </>
      )}
    </Row>
  )
}
