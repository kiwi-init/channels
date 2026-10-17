import { relayUrl } from "../lib/relay"
import { Add01Icon, ArrowRight01Icon, BookOpen01Icon, Cancel01Icon, Link01Icon, PauseIcon, PencilEdit01Icon, PlayIcon, UserMultipleIcon } from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"

import type { ChannelIcon } from "@mc/protocol.ts"
import { colorOf } from "@mc/state.ts"
import { memberLoad } from "@mc/load.ts"
import { memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { RobotAvatar } from "./robot"
import { MemberActions, loadDetail, memberDetail, useControls } from "./controls"
import { Icon, type IconSvgElement } from "./icon"
import { IconButton, Button, Modal, Monogram, errorText, toast } from "./kit"

// The channel's details, as Messages shows a conversation's Info: the channel's face and name, a few
// round actions, everyone in it as faces, then grouped rows for what the channel is (its charter, its
// notes), how to reach it from a terminal, and leaving or closing it at the foot, in red.

export function InfoPanel({
  title,
  icon,
  subtitle,
  onClose,
  onPause,
  notes,
  onMessage,
}: {
  title: string
  icon: ChannelIcon | null
  subtitle: string
  onClose: () => void
  /** Owner: open the pause dialog (the conversation holds it). */
  onPause?: () => void
  /** What agents noted: the channel's Notes block. */
  notes?: ReactNode
  /** Open the direct conversation with a member. */
  onMessage?: (name: string) => void
}) {
  const { p, ask, openInvite, openRequests, openDialog } = useControls()
  const active = p.roster
    .filter((m) => m.active)
    .sort((a, b) => Number(b.owner) - Number(a.owner) || Number(a.kind !== "human") - Number(b.kind !== "human") || Number(p.online.has(b.name)) - Number(p.online.has(a.name)))
  const former = p.roster.filter((m) => !m.active)
  const hold = p.state.hold
  const coordinator = p.state.coordinator

  return (
    <aside aria-label="Details" className="animate-slide-in flex h-full w-full flex-col border-l border-line bg-rail md:w-[340px]" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <header className="drag flex h-(--chrome-h) shrink-0 items-center px-3">
        <IconButton label="Close details" round className="glass size-9 text-ink" onClick={onClose}>
          <Icon icon={Cancel01Icon} size={16} />
        </IconButton>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex flex-col items-center text-center">
          {/* The channel's face is its coordinator, when it has one: the one people talk with. */}
          {coordinator ? <RobotAvatar name={coordinator} size={112} label="The coordinator" /> : <ChannelIconTile icon={icon} title={title} size={64} />}
          <h2 className="mt-2 max-w-full truncate text-display font-semibold">{title}</h2>
          <p className="mt-0.5 text-meta text-ink-3">{subtitle}</p>
        </div>

        {/* A few round actions, as Messages has call and mail under the name. */}
        <div className="mt-4 flex justify-center gap-5">
          {p.isOwner && <RoundAction icon={Add01Icon} label="Invite" onClick={openInvite} />}
          {p.isOwner && onPause && p.onHold && (
            <RoundAction
              icon={hold ? PlayIcon : PauseIcon}
              label={hold ? "Resume" : "Pause"}
              tone={hold ? "alert" : undefined}
              onClick={() =>
                hold
                  ? void p.onHold!(false).then(
                      () => toast("Agents may carry on"),
                      (err) => toast(errorText(err), "error")
                    )
                  : onPause()
              }
            />
          )}
        </div>

        {p.isOwner && p.requests.length > 0 && (
          <Section>
            <Row
              icon={UserMultipleIcon}
              onClick={openRequests}
              trailing={<span className="rounded-full bg-decide-wash px-1.5 text-meta font-semibold text-decide tabular-nums">{p.requests.length}</span>}
            >
              {p.requests.length === 1 ? `${p.requests[0]!.name} wants to join` : `${p.requests.length} want to join`}
            </Row>
          </Section>
        )}

        {/* Everyone, as faces: people round, agents as characters, with what each is doing under them. */}
        <Section label={`${active.length} ${active.length === 1 ? "member" : "members"}`}>
          <div className="grid grid-cols-3 gap-x-1 gap-y-3 px-1 py-3">
            {active.map((m) => {
              const face = (
                <Face
                  name={memberName(m)}
                  handle={m.name}
                  agent={m.kind !== "human"}
                  online={p.online.has(m.name)}
                  color={colorOf(p.state, m.name)}
                  working={m.kind !== "human" && memberLoad(p.state, m.name).current.length > 0}
                  line={m.pk === p.myKey ? "You" : memberDetail(p, m)}
                  strong={coordinator === m.name}
                  title={m.kind !== "human" ? loadDetail(memberLoad(p.state, m.name)) : undefined}
                />
              )
              const mine = m.pk === p.myKey
              return p.isOwner && !m.owner ? (
                <MemberActions
                  key={m.pk}
                  m={m}
                  onMessage={onMessage && !mine ? () => onMessage(m.name) : undefined}
                  trigger={
                    <button type="button" aria-label={`More for ${memberName(m)}`} className="rounded-card py-1 transition-colors hover:bg-wash data-popup-open:bg-wash">
                      {face}
                    </button>
                  }
                />
              ) : onMessage && !mine ? (
                <button key={m.pk} type="button" aria-label={`Message ${memberName(m)} privately`} onClick={() => onMessage(m.name)} className="rounded-card py-1 transition-colors hover:bg-wash">
                  {face}
                </button>
              ) : (
                <div key={m.pk} className="py-1">
                  {face}
                </div>
              )
            })}
            {p.isOwner && (
              <button type="button" onClick={openInvite} className="flex flex-col items-center rounded-card py-1 transition-colors hover:bg-wash">
                <span className="flex size-[52px] items-center justify-center rounded-full bg-field text-ink-2">
                  <Icon icon={Add01Icon} size={22} />
                </span>
                <span className="mt-1.5 text-meta font-medium">Add</span>
              </button>
            )}
          </div>
          {/* A name in use again (a lost key: removed, then joined anew) reads as the earlier key, never as a second one of them. */}
          {former.length > 0 && (
            <p className="px-3 py-2 text-meta text-ink-3 shadow-[inset_0_1px_0_var(--line)]">
              Left: {[...new Set(former.map((m) => (active.some((a) => a.name === m.name) ? `${m.name} (an earlier key)` : m.name)))].join(", ")}
            </p>
          )}
        </Section>

        {/* Coordinator mode: on or off, who relays, and the owner's switch — where they'd look for it. */}
        <Section label="Coordinator mode">
          <CoordinatorMode />
        </Section>

        <Section>
          {(p.isOwner || p.state.charter) && (
            <Row icon={BookOpen01Icon} onClick={() => openDialog("charter")} detail={p.state.charter?.text}>
              Charter
            </Row>
          )}
          {p.isOwner && p.onRename && (
            <Row icon={PencilEdit01Icon} onClick={() => openDialog("rename")}>
              Rename channel
            </Row>
          )}
          {p.isOwner && (
            <Row icon={Link01Icon} onClick={() => void navigator.clipboard.writeText(`${relayUrl()}/#${p.code}`).then(() => toast("Invite link copied"))}>
              Copy invite link
            </Row>
          )}
        </Section>

        {notes}

        <Section>
          <button
            type="button"
            onClick={() => ask(p.isOwner ? { kind: "close" } : { kind: "leave" })}
            className="w-full px-3 py-2.5 text-left text-ui font-medium text-alert transition-colors hover:bg-wash"
          >
            {p.isOwner ? "Close channel…" : "Leave this channel…"}
          </button>
        </Section>

        <p className="mt-3 px-3 text-stamp leading-[15px] text-ink-3">Everything here is end-to-end encrypted: the relay sees only ciphertext, and only members hold the keys.</p>
      </div>
    </aside>
  )
}

/**
 * Coordinator mode: on (someone relays people's words) or off, with the owner's switch where they'd
 * look for it. Turning off keeps the coordinator's role, so turning back on is one pick; turning on
 * someone else moves the role to them.
 */
function CoordinatorMode() {
  const { p, busy, run, setCoordinator } = useControls()
  const [picking, setPicking] = useState(false)
  const coordinator = p.state.coordinator
  const on = p.state.mode.coordinatorOnly
  const agents = p.roster.filter((m) => m.active && m.kind !== "human")

  const turnOff = () => {
    if (p.onMode) void run(() => p.onMode!(false, true), "Coordinator mode off")
  }

  return (
    <>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <p className="min-w-0 flex-1 text-ui leading-snug text-ink-2">
          {on ? (
            <>
              Coordinator mode: <span className="font-semibold text-ink">on</span>
              {coordinator && (
                <>
                  {" "}
                  (<span className="font-medium text-ink">{memberName(p.state.members.get(coordinator), coordinator)}</span> relays)
                </>
              )}
            </>
          ) : (
            <>
              Coordinator mode: <span className="font-semibold text-ink">off</span>
              <span className="text-ink-3"> — people talk with everyone</span>
            </>
          )}
        </p>
        {p.isOwner &&
          (on ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={turnOff}>
              Turn off
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy || agents.length === 0} onClick={() => setPicking(true)}>
              Turn on
            </Button>
          ))}
      </div>

      <Modal open={picking} onClose={() => setPicking(false)}>
        <div className="p-5">
          <h2 className="text-title font-semibold tracking-[-0.01em]">Who coordinates?</h2>
          <p className="mt-1 text-ui leading-normal text-ink-2">People will talk with them, and they pass things on to the other agents.</p>
          <div className="mt-4 grid gap-1">
            {agents.map((m) => (
              <button
                key={m.pk}
                type="button"
                disabled={busy}
                onClick={() => {
                  setPicking(false)
                  // They kept the role while the mode was off: only the mode comes back.
                  if (m.name === coordinator && p.onMode) void run(() => p.onMode!(true, true), `Coordinator mode on: ${memberName(m)} relays`)
                  else void setCoordinator(m, true)
                }}
                className="flex items-center gap-3 rounded-ctl px-2 py-2 text-left transition-colors hover:bg-wash disabled:opacity-40"
              >
                <Monogram name={m.name} agent size={32} online={p.online.has(m.name)} color={colorOf(p.state, m.name)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium">{memberName(m)}</span>
                  <span className="block truncate text-meta text-ink-3">{coordinator === m.name ? (on ? "Coordinating now" : "Still the coordinator") : memberDetail(p, m)}</span>
                </span>
              </button>
            ))}
            {agents.length === 0 && <p className="text-ui text-ink-3">No agents to coordinate yet.</p>}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function RoundAction({ icon, label, onClick, tone }: { icon: IconSvgElement; label: string; onClick: () => void; tone?: "alert" }) {
  return (
    <button type="button" onClick={onClick} aria-label={label === "Pause" ? "Pause agents" : label === "Resume" ? "Resume agents" : label} className="group flex w-14 flex-col items-center gap-1">
      <span className={cx("flex size-10 items-center justify-center rounded-full bg-raised transition-colors group-hover:bg-wash-2", tone === "alert" ? "text-alert" : "text-ink")}>
        <Icon icon={icon} size={18} />
      </span>
      <span className="text-stamp font-medium text-ink-2">{label}</span>
    </button>
  )
}

function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      {label && <h3 className="mb-1.5 px-3 text-stamp font-semibold tracking-[0.04em] text-ink-3 uppercase">{label}</h3>}
      <div className="overflow-hidden rounded-card bg-raised [&>*+*]:shadow-[inset_0_1px_0_var(--line)]">{children}</div>
    </section>
  )
}

function Row({ icon, children, detail, trailing, onClick }: { icon: IconSvgElement; children: ReactNode; detail?: string; trailing?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-wash">
      <Icon icon={icon} size={16} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1">
        <span className="block text-ui">{children}</span>
        {detail && <span className="mt-0.5 line-clamp-2 block text-meta text-ink-3">{detail}</span>}
      </span>
      {trailing ?? <Icon icon={ArrowRight01Icon} size={14} className="shrink-0 text-ink-3" />}
    </button>
  )
}

function Face({
  head,
  name,
  handle,
  agent,
  online,
  color,
  working,
  line,
  strong,
  title,
}: {
  head?: ReactNode
  name: string
  handle: string
  agent: boolean
  online: boolean
  color: ReturnType<typeof colorOf>
  working: boolean
  line: string
  strong: boolean
  title?: string
}) {
  return (
    <span className="flex min-w-0 flex-col items-center px-1" title={title}>
      {head ?? <Monogram name={name} hue={handle} agent={agent} size={52} online={online} color={color} working={working} />}
      <span className="mt-1.5 max-w-full truncate text-meta font-medium" title={`@${handle}`}>
        {name}
      </span>
      <span className={cx("max-w-full truncate text-stamp", strong ? "font-semibold text-ink-2" : "text-ink-3")}>{line}</span>
    </span>
  )
}
