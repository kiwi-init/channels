import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { freeHandle, seededPick } from "@mc/handles.ts"
import { nameKey, type JoinRequest } from "@mc/membership.ts"
import { HANDOFF_DONE, HANDOFF_FAILED, type Message } from "@mc/protocol.ts"
import { TOO_MANY_REQUESTS } from "@mc/sas.ts"
import { taskId, type Task } from "@mc/state.ts"
import { askLabel } from "@/lib/asks"
import { excerpt, formatAgo } from "@/lib/format"
import { openHandoff } from "@/lib/handoff-open"
import { handoffLabel, handoffLeft, handoffOf, handoffOpen } from "@/lib/handoff"
import { cx } from "@/lib/utils"
import { useControls } from "./controls"
import { Icon } from "./icon"
import { Button, Monogram, TextField, errorText, toast } from "./kit"
import { defaultScopes } from "./scopes"
import { AgentFacts } from "./agent-facts"

/**
 * The one place a person acts: who wants in, what agents escalated to them, work waiting on their
 * review. Everything else the channel just says.
 */
export function NeedsYou({
  now,
  roomId,
  me,
  escalations,
  questions,
  reviews,
  nameOf,
  agentOf,
  onReply,
  onApproveTask,
  onSendBack,
  onOpenTask,
  onJump,
}: {
  now: number
  roomId: string
  me: string
  /** Escalations to this person nobody has answered yet. */
  escalations: Message[]
  questions: Message[]
  /** Tasks in review that this person may approve. */
  reviews: Task[]
  nameOf: (name: string) => string
  agentOf: (name: string) => boolean
  onReply: (m: Message, text: string) => Promise<void>
  onApproveTask: (t: Task) => Promise<void>
  onSendBack: (t: Task, why: string) => Promise<void>
  onOpenTask: (id: number) => void
  onJump: (seq: number) => void
}) {
  const { p } = useControls()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLElement>(null)
  const requests = p.isOwner ? p.requests : []
  // Closes on a click elsewhere, or Escape, like any popover.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", esc)
    }
  }, [open])
  const items: { key: string; summary: string; node: ReactNode }[] = [
    ...requests.map((r) => ({ key: `r${r.id}`, summary: `${r.name} wants to join`, node: <RequestItem r={r} roomId={roomId} now={now} /> })),
    ...escalations.map((m) => ({
      key: `e${m.seq}`,
      summary: `${nameOf(m.from)} needs a decision`,
      node: <AskItem m={m} me={me} now={now} nameOf={nameOf} agent={agentOf(m.from)} onReply={onReply} onJump={(seq) => (setOpen(false), onJump(seq))} />,
    })),
    ...questions.map((m) => ({
      key: `q${m.seq}`,
      summary: `${nameOf(m.from)} asked ${m.to?.includes(me) ? "you" : "everyone"}`,
      node: <AskItem m={m} me={me} now={now} nameOf={nameOf} agent={agentOf(m.from)} onReply={onReply} onJump={(seq) => (setOpen(false), onJump(seq))} />,
    })),
    ...reviews.map((t) => ({
      key: `t${t.id}`,
      summary: `${taskId(t.id)} is ready for review`,
      node: <ReviewItem t={t} nameOf={nameOf} onApprove={onApproveTask} onSendBack={onSendBack} onOpen={(id) => (setOpen(false), onOpenTask(id))} />,
    })),
  ]
  if (!items.length) return null
  const n = items.length
  return (
    <section ref={box} aria-label="Needs you" className="sticky top-0 z-20 bg-canvas pt-3 pb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx("flex h-9 w-full items-center gap-2.5 rounded-full bg-field pr-3 pl-3.5 text-left text-ui transition-colors hover:bg-wash-2", open && "bg-wash-2")}
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-decide" />
        <span className="shrink-0 font-semibold">{n === 1 ? "1 thing needs you" : `${n} things need you`}</span>
        <span className="min-w-0 flex-1 truncate text-ink-3">
          {items[0]!.summary}
          {n > 1 ? `, and ${n - 1} more` : ""}
        </span>
        <Icon icon={ArrowDown01Icon} size={14} className={cx("shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="animate-rise absolute inset-x-0 top-full z-20 -mt-1 overflow-hidden rounded-card bg-raised shadow-pop">
          {requests.some((r) => r.check === "unchecked") && <p className="mx-4 mt-3 text-meta leading-normal text-ink-3">{TOO_MANY_REQUESTS}</p>}
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {items.map((i) => (
              <li key={i.key} className="px-4 py-3">
                {i.node}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Row({ lead, title, detail, children }: { lead: ReactNode; title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="pt-0.5">{lead}</span>
      <div className="min-w-0 flex-1">
        <p className="text-ui leading-snug">{title}</p>
        {detail && <div className="mt-0.5 text-meta leading-snug text-ink-2">{detail}</div>}
        {children && <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
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
  const lead = <Monogram name={r.display || r.name} hue={r.name} agent={r.kind !== "human"} size={24} />
  return (
    <Row
      lead={lead}
      title={
        <>
          <span className="font-medium">{r.display || r.name}</span>
          {r.display && <span className="text-ink-3"> @{r.name}</span>} wants to join
          {r.role && <span className="text-ink-2">, as {r.role}</span>}
        </>
      }
      detail={
        <>
          {who} · asked {formatAgo(r.ts, now)}
          {r.kind !== "human" && <AgentFacts card={r.card} said className="mt-1" />}
          {r.check === "ready" && r.code && (
            <span className="mt-1.5 flex items-baseline gap-2">
              <span>Let in only if {r.kind === "human" ? "they see" : "its terminal shows"}</span>
              <span className="text-title font-semibold tracking-[0.04em] text-ink tabular-nums">{r.code}</span>
            </span>
          )}
        </>
      }
    >
      {r.check === "ready" && taken ? (
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
      ) : r.check === "ready" ? (
        <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => p.onApprove(r, defaultScopes(roomId)), `${r.name} joined`)}>
            It matches: let in
          </Button>
          <Button size="sm" variant="ghost" onClick={() => ask({ kind: "approve", req: r })}>
            Choose what it can do…
          </Button>
        </>
      ) : r.check === "unchecked" ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => p.onCheck(r), `Asked ${r.name} for its code`)}>
          Show code
        </Button>
      ) : (
        <span className="text-meta text-ink-3">Waiting for {r.kind === "human" ? "their" : "its"} code…</span>
      )}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => p.onDeny(r), `Declined ${r.name}`)}>
        Decline
      </Button>
    </Row>
  )
}

/** An agent handing a decision to its person: what it says, and an answer right here. */
function AskItem({
  m,
  me,
  now,
  nameOf,
  agent,
  onReply,
  onJump,
}: {
  m: Message
  me: string
  now: number
  nameOf: (n: string) => string
  agent: boolean
  onReply: (m: Message, text: string) => Promise<void>
  onJump: (seq: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const handoff = handoffOf(m)
  const live = !!handoff && handoffOpen(handoff, now)
  const send = async (text = draft?.trim() ?? "") => {
    if (!text) return
    setBusy(true)
    try {
      await onReply(m, text)
      setDraft(null)
      toast(`Answered ${nameOf(m.from)}`)
    } catch (err) {
      toast(`Not sent: ${errorText(err)}`, "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Row
      lead={<Monogram name={m.from} agent={agent} size={24} />}
      title={
        <>
          <span className="mr-1.5 rounded-full bg-decide-wash px-1.5 text-meta font-semibold text-decide">{handoff ? "Browser for you" : askLabel(m, me)}</span>
          <span className="font-medium">{nameOf(m.from)}</span>: {excerpt(m.body, 220)}
        </>
      }
      detail={handoff ? `${formatAgo(m.ts, now)} · ${handoffLabel(handoff)} · ${live ? handoffLeft(handoff, now) : "link expired"}` : formatAgo(m.ts, now)}
    >
      {draft === null ? (
        <>
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
          <Button size="sm" variant="secondary" onClick={() => setDraft("")}>
            Answer
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onJump(m.seq)}>
            Show
          </Button>
        </>
      ) : (
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void send(draft?.trim())
          }}
        >
          <TextField
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
            placeholder={`Answer ${nameOf(m.from)}`}
            aria-label="Answer"
            className="flex-1"
          />
          <Button size="sm" variant="secondary" type="submit" disabled={busy || !draft.trim()}>
            Send
          </Button>
        </form>
      )}
    </Row>
  )
}

/** Work an agent says is finished, waiting on this person's word. */
function ReviewItem({
  t,
  nameOf,
  onApprove,
  onSendBack,
  onOpen,
}: {
  t: Task
  nameOf: (n: string) => string
  onApprove: (t: Task) => Promise<void>
  onSendBack: (t: Task, why: string) => Promise<void>
  onOpen: (id: number) => void
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
      lead={<span className="flex size-6 items-center justify-center text-meta font-semibold text-ink-2 tabular-nums">{taskId(t.id)}</span>}
      title={
        <>
          <span className="font-medium">{t.title}</span> is ready for your review
        </>
      }
      detail={t.owner ? `Done by ${nameOf(t.owner)}. Check the work itself, not just their word.` : "Check the work itself, not just the word of whoever did it."}
    >
      {why === null ? (
        <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => onApprove(t), `Approved ${taskId(t.id)}`)}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWhy("")}>
            Send back
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpen(t.id)}>
            Open
          </Button>
        </>
      ) : (
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
      )}
    </Row>
  )
}
