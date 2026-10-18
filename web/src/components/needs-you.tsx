import { CheckmarkCircle02Icon, Globe02Icon, HelpCircleIcon, Key01Icon } from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
import { useState, type ReactNode } from "react"

import { freeHandle, seededPick } from "@kiwi/core/handles.ts"
import { nameKey, type JoinRequest } from "@kiwi/core/membership.ts"
import { HANDOFF_DONE, HANDOFF_FAILED, type Message } from "@kiwi/core/protocol.ts"
import { TOO_MANY_REQUESTS } from "@kiwi/core/sas.ts"
import { taskId, type Task } from "@kiwi/core/state.ts"
import { usePinned } from "@/lib/pinned"
import { askLabel } from "@/lib/asks"
import { excerpt, formatAgo } from "@/lib/format"
import { openHandoff } from "@/lib/handoff-open"
import { handoffLabel, handoffLeft, handoffOf, handoffOpen } from "@/lib/handoff"
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
  const requests = p.isOwner ? p.requests : []
  const items: { key: string; node: ReactNode }[] = [
    ...requests.map((r) => ({ key: `r${r.id}`, node: <RequestItem r={r} roomId={roomId} now={now} /> })),
    ...[...escalations, ...questions].map((m) => ({
      key: `a${m.seq}`,
      node: <AskItem m={m} me={me} now={now} nameOf={nameOf} agent={agentOf(m.from)} onReply={onReply} onJump={onJump} />,
    })),
    ...reviews.map((t) => ({
      key: `t${t.id}`,
      node: <ReviewItem t={t} nameOf={nameOf} onApprove={onApproveTask} onSendBack={onSendBack} onOpen={onOpenTask} />,
    })),
  ]
  if (!items.length) return null
  return (
    <section aria-label="Needs you" className="pt-3 pb-2">
      <h2 className="flex items-baseline gap-2 text-ui font-semibold">
        Needs you <span className="font-normal text-ink-3 tabular-nums">{items.length}</span>
      </h2>
      {requests.some((r) => r.check === "unchecked") && <p className="mt-1 text-meta leading-normal text-ink-3">{TOO_MANY_REQUESTS}</p>}
      <ul className="divide-y divide-line border-b border-line">
        {items.map((i) => (
          <li key={i.key}>{i.node}</li>
        ))}
      </ul>
    </section>
  )
}

function Row({ icon, lead, title, detail, children }: { icon?: IconSvgElement; lead?: ReactNode; title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-row border border-edge-strong text-decide">{lead ?? (icon && <Icon icon={icon} size={17} />)}</span>
        <div className="min-w-0 flex-1">
          <p className="text-body leading-snug [overflow-wrap:anywhere]">{title}</p>
          {detail && <div className="mt-0.5 text-meta leading-snug text-ink-3">{detail}</div>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 pl-12 md:max-w-[45%] md:shrink-0 md:justify-end md:pl-0">{children}</div>}
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
  const lead = <Monogram name={r.display || r.name} hue={r.name} agent={r.kind !== "human"} size={28} />
  const pinnedAs = usePinned(r.pin)
  return (
    <Row
      lead={lead}
      title={
        <>
          <span className="font-medium">{r.display || r.name}</span>
          {r.display && <span className="text-ink-3"> @{r.name}</span>} wants to join
          {r.pin ? (
            <span className="text-ink-2">{pinnedAs === null ? `, pinned as ${r.pin.name}, which isn't on your account as it was` : `, pinned as ${r.pin.name}`}</span>
          ) : (
            r.role && <span className="text-ink-2">, as {r.role}</span>
          )}
        </>
      }
      detail={
        <>
          {who} · asked {formatAgo(r.ts, now)}
          {r.kind !== "human" && <AgentFacts card={r.card} said repos={p.state.repos} className="mt-1" />}
          {r.check === "ready" && r.code && (
            <span className="mt-1.5 flex items-baseline gap-2">
              <span>Let in only if {r.kind === "human" ? "they see" : "its terminal shows"}</span>
              <span className="text-title font-semibold tracking-[0.04em] whitespace-nowrap text-ink tabular-nums">{r.code}</span>
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
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || (!!r.pin && pinnedAs === undefined)}
            onClick={() => run(() => p.onApprove(r, defaultScopes(roomId), pinnedAs ?? undefined), pinnedAs ? `${r.name} joined as ${pinnedAs.name}` : `${r.name} joined`)}
          >
            {pinnedAs ? `It matches: let in as ${pinnedAs.name}` : "It matches: let in"}
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
      icon={handoff ? Globe02Icon : m.esc ? Key01Icon : HelpCircleIcon}
      title={excerpt(m.body, 220)}
      detail={[
        m.task ? taskId(m.task) : null,
        `${handoff ? "Browser for you" : askLabel(m, me)} from ${nameOf(m.from)}${agent ? "" : " (a person)"}`,
        formatAgo(m.ts, now),
        handoff ? `${handoffLabel(handoff)} · ${live ? handoffLeft(handoff, now) : "link expired"}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {draft === null ? (
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
    <Row icon={CheckmarkCircle02Icon} title={t.title} detail={`${taskId(t.id)} · ready for your review${t.owner ? ` · done by ${nameOf(t.owner)}` : ""} · check the work itself, not just the word`}>
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
