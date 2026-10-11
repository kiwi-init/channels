import { Dialog } from "@base-ui/react/dialog"
import { Add01Icon, BookOpen01Icon, ComputerTerminal01Icon, Copy01Icon, Delete02Icon, Image01Icon, Link01Icon, Logout01Icon, MoreHorizontalIcon, PauseIcon, PencilEdit01Icon, PlayIcon, UserAdd01Icon, UserMultipleIcon, UserStar01Icon } from "@hugeicons/core-free-icons"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import { loadLine, memberLoad, showsLoad, type Load } from "@mc/load.ts"
import { cardLine } from "@mc/format.ts"
import { NAME_RE, type JoinRequest, type Member as RosterMember } from "@mc/membership.ts"
import { COLORS, MAX_CHARTER, type ChannelIcon, type Color, type Event } from "@mc/protocol.ts"
import { TOO_MANY_REQUESTS } from "@mc/sas.ts"
import { SCOPES, type Scope } from "@mc/scopes.ts"
import { colorOf, taskId, type ChannelState, type Member } from "@mc/state.ts"
import { useAuth } from "@/lib/auth"
import { formatAgo, initials, memberLine, memberName } from "@/lib/format"
import { PALETTE } from "@/lib/characters"
import { cx } from "@/lib/utils"
import { isSignInGone } from "@/lib/session"
import { IconDialog } from "./channel-icon"
import { defaultScopes, saveDefaultScopes, ScopePicker, scopesLine } from "./scopes"
import { cachedIcon } from "@/lib/icons"
import { Icon } from "./icon"
import { Alert, Button, IconButton, Modal, Monogram, Tabs, TextField, errorText, toast } from "./kit"
import { Menu, MenuItem, MenuSeparator } from "./ui/menu"
import { Popover } from "./ui/popover"

// Everything about a channel that isn't the conversation, each where you'd
// look for it: people behind the faces in the header, Invite as a button,
// join requests behind the banner, and leaving or closing in the ⋯ menu.
// ChannelControls holds the shared state and every confirm dialog; the
// pieces below read it from context.

export type Filter = { kind: "from"; name: string } | { kind: "open" } | { kind: "mine" } | { kind: "coordinator" }

type Confirm =
  | { kind: "approve"; req: JoinRequest }
  | { kind: "reclaim"; req: JoinRequest; online: boolean }
  | { kind: "remove"; member: RosterMember }
  | { kind: "role"; member: RosterMember }
  | { kind: "scopes"; member: RosterMember }
  | { kind: "close" }
  | { kind: "leave" }
  | null

export interface ControlsProps {
  code: string
  /** This browser's member key: "(you)" is whoever holds it, not whoever shares your name. */
  myKey: string
  isOwner: boolean
  roster: RosterMember[]
  requests: JoinRequest[]
  online: Map<string, unknown>
  state: ChannelState
  now: number
  onFilter: (f: Filter) => void
  /** `scopes`: what they may do besides read; left out, everything. */
  onApprove: (r: JoinRequest, scopes?: Scope[]) => Promise<void>
  /** Owner: move a member's seat to the key in a RECLAIM request. `force` is the second confirm when the old key is online. */
  onReclaim: (r: JoinRequest, opts: { online: boolean; force?: boolean }) => Promise<void>
  onDeny: (r: JoinRequest) => Promise<void>
  /** Sign this browser's half of a request's code check, at the person's click. */
  onCheck: (r: JoinRequest) => Promise<void>
  onRemove: (m: RosterMember) => Promise<void>
  /** Owner: change what a member may do besides read (a signed scope.set, then the relay's bit). */
  onScopes?: (m: RosterMember, scopes: Scope[]) => Promise<void>
  /** Owner: set a member's role, or allow or refuse the one they asked for (a signed event). */
  onRole: (ev: Extract<Event, { op: "role.set" | "role.refuse" }>) => Promise<void>
  onCloseChannel: () => Promise<void>
  onLeaveChannel: () => Promise<void>
  /** `kiwi tui --link '…'`: this seat in a terminal. It carries this browser's key. */
  terminalCommand?: () => string
  /** Owner: set or clear the channel icon. Absent for a visitor who can't. */
  onSetIcon?: (icon: ChannelIcon | null) => Promise<void>
  /** Owner: rename the channel (a title signed by the owner). Absent for everyone else. */
  onRename?: (name: string) => Promise<void>
  /** A person sets their own colour (unique in the channel; their agents wear it). */
  onColor?: (color: Color | null) => Promise<void>
  /** Owner: coordinator-only on or off (an owner-signed mode.set). Absent for everyone else. */
  onMode?: (coordinatorOnly: boolean, strict: boolean) => Promise<void>
  /** Owner: stop every agent, or let them carry on (an owner-signed hold.set). Absent for everyone else. */
  onHold?: (on: boolean, note?: string) => Promise<void>
  /** Owner: what the channel is for and its limits (an owner-signed charter.set; null clears it). */
  onCharter?: (text: string | null) => Promise<void>
  /** The channel's name as this browser knows it, to start the rename from. */
  title?: string
  /** This channel's room, so the icon dialog can show what's there now. */
  roomId?: string
}

interface Api {
  p: ControlsProps
  busy: boolean
  run: (fn: () => Promise<void>, done: string) => Promise<void>
  ask: (c: Confirm) => void
  openRequests: () => void
  openInvite: () => void
  openMode: () => void
  editRole: (m: RosterMember) => void
  editScopes: (m: RosterMember) => void
  lastSeenOf: (name: string) => number | null
  onlineNow: (name: string) => boolean
}

const Ctx = createContext<Api | null>(null)
const useControls = () => useContext(Ctx)!

const LEVEL = { free: "Free", busy: "Busy", overloaded: "Overloaded" } as const

/** Everything behind a member's load, one item per line, for the tooltip. */
function loadDetail(l: Load): string {
  const lines = [
    ...l.current.map((t) => `Doing ${taskId(t.id)} ${t.title}`),
    ...l.queued.map((t) => `Queued ${taskId(t.id)} ${t.title}`),
    ...l.waiting.map((t) => `${t.state === "review" ? "In review" : "Blocked"} ${taskId(t.id)} ${t.title}`),
    ...l.claims.map((c) => `Claimed ${c.path}`),
  ]
  return lines.length ? lines.join("\n") : "Nothing assigned"
}

function CopyBox({ text, label, done }: { text: string; label: string; done: string }) {
  return (
    <div className="flex items-start gap-1 rounded-ctl bg-wash p-2.5">
      {/* A flag never parts from its value (it wraps as one); a long token breaks only when it has to. */}
      <code className="min-w-0 flex-1 font-mono text-meta leading-relaxed [overflow-wrap:anywhere] text-ink-2">
        {text.split(/(?=\s--[a-z])/).map((part, i) => (
          <span key={i} className={i > 0 ? "whitespace-nowrap" : undefined}>
            {part}
          </span>
        ))}
      </code>
      <IconButton label={label} className="size-7" onClick={() => navigator.clipboard.writeText(text).then(() => toast(done))}>
        <Icon icon={Copy01Icon} size={15} />
      </IconButton>
    </div>
  )
}

const inviteLink = (code: string) => `${location.origin}/#${code}`

export function ChannelControls({ children, ...p }: ControlsProps & { children: ReactNode }) {
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [sheet, setSheet] = useState<"requests" | "invite" | "mode" | null>(null)
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(false)
  const [roleDraft, setRoleDraft] = useState({ role: "", about: "" })
  const [scopeDraft, setScopeDraft] = useState<Scope[]>([...SCOPES])
  const active = p.roster.filter((m) => m.active)
  const taken = confirm?.kind === "approve" && active.some((m) => m.name === confirm.req.name)
  // A seat in use: seen in the last ten minutes or listening right now (the same rule as kiwi approve).
  const lastSeenOf = (name: string) => p.state.members.get(name)?.lastSeen || null
  const onlineNow = (name: string) => p.online.has(name) || p.now - (lastSeenOf(name) ?? 0) < 10 * 60_000

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await fn()
      toast(done)
      setConfirm(null)
    } catch (err) {
      const message = errorText(err)
      toast(isSignInGone(err) ? "Sign in first. Owner actions need your session." : message, "error")
    } finally {
      setBusy(false)
    }
  }

  const api: Api = {
    p,
    busy,
    run,
    ask: (c) => {
      // Approving starts from what this browser picked for new members when inviting.
      if (c?.kind === "approve") setScopeDraft(p.roomId ? defaultScopes(p.roomId) : [...SCOPES])
      setConfirm(c)
    },
    openRequests: () => setSheet("requests"),
    openInvite: () => setSheet("invite"),
    openMode: () => setSheet("mode"),
    editRole: (m) => {
      const live = p.state.members.get(m.name)
      setRoleDraft({ role: live?.role ?? "", about: live?.about ?? "" })
      setConfirm({ kind: "role", member: m })
    },
    editScopes: (m) => {
      setScopeDraft(p.state.members.get(m.name)?.scopes ?? [...SCOPES])
      setConfirm({ kind: "scopes", member: m })
    },
    lastSeenOf,
    onlineNow,
  }

  return (
    <Ctx.Provider value={api}>
      {children}

      <Modal open={sheet === "requests" && confirm === null} onClose={() => setSheet(null)} wide>
        <Requests onDone={() => setSheet(null)} />
      </Modal>
      <Modal open={sheet === "invite"} onClose={() => setSheet(null)} wide>
        <Invite onDone={() => setSheet(null)} />
      </Modal>
      {p.onMode && sheet === "mode" && <ModeDialog state={p.state} onClose={() => setSheet(null)} onSave={p.onMode} />}

      <Alert
        open={confirm?.kind === "role"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "role" ? `${confirm.member.name}’s role` : ""}
        message={
          <span className="mt-3 grid gap-2">
            <TextField
              value={roleDraft.role}
              onChange={(e) => setRoleDraft((d) => ({ ...d, role: e.target.value }))}
              placeholder="Role, e.g. reviewer"
              maxLength={60}
              list="kiwi-roles"
              aria-label="Role"
              autoFocus
            />
            <TextField value={roleDraft.about} onChange={(e) => setRoleDraft((d) => ({ ...d, about: e.target.value }))} placeholder="Rules (optional)" maxLength={200} aria-label="Rules" />
            <span className="text-meta text-ink-3">Everyone sees the role, and agents route work by it.</span>
          </span>
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            if (confirm?.kind !== "role") return
            const name = confirm.member.name
            void run(() => p.onRole({ op: "role.set", member: name, role: roleDraft.role.trim() || null, about: roleDraft.about.trim() || null }), `Saved ${name}’s role`)
          }}
        >
          Save
        </Button>
      </Alert>

      <Alert
        open={confirm?.kind === "approve"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "approve" ? `Let ${confirm.req.name} in?` : ""}
        message={
          confirm?.kind === "approve" && (
            <>
              Approve only if {confirm.req.kind === "human" ? "they show" : "its terminal shows"} this exact code.
              <span className="mt-4 mb-4 block text-[34px] leading-none font-semibold tracking-[0.04em] text-ink tabular-nums">{confirm.req.code}</span>
              <span className="mb-2 block text-ui font-medium text-ink">What {confirm.req.kind === "human" ? "they" : "it"} can do</span>
              <ScopePicker value={scopeDraft} onChange={setScopeDraft} disabled={busy} />
            </>
          )
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        {confirm?.kind === "approve" && (
          <Button disabled={busy || taken} onClick={() => run(() => p.onApprove(confirm.req, scopeDraft), `${confirm.req.name} joined`)}>
            {taken ? "That name is taken" : "Approve"}
          </Button>
        )}
      </Alert>

      <Alert
        open={confirm?.kind === "scopes"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "scopes" ? `What ${confirm.member.name} can do` : ""}
        message={
          confirm?.kind === "scopes" && (
            <>
              <span className="mb-3 block">Everyone can read. Every member’s client holds them to this from now on; what they sent before stands.</span>
              <ScopePicker value={scopeDraft} onChange={setScopeDraft} disabled={busy} />
            </>
          )
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        {confirm?.kind === "scopes" && p.onScopes && (
          <Button disabled={busy} onClick={() => run(() => p.onScopes!(confirm.member, scopeDraft), `Saved what ${confirm.member.name} can do`)}>
            Save
          </Button>
        )}
      </Alert>

      <Alert
        open={confirm?.kind === "reclaim"}
        onClose={() => (setConfirm(null), setSure(false))}
        title={confirm?.kind === "reclaim" ? `Move ${confirm.req.reclaims!.name}’s seat to the new key?` : ""}
        message={
          confirm?.kind === "reclaim" && (
            <>
              Approve only if its terminal shows this exact code.
              <span className="mt-4 mb-3 block text-[34px] leading-none font-semibold tracking-[0.04em] text-ink tabular-nums">{confirm.req.code}</span>
              The old key {confirm.req.reclaims!.pk.slice(0, 8)} is out for good and the channel key changes. {confirm.req.reclaims!.name} keeps its name, role, tasks and claims.
              {confirm.online && (
                <span className="mt-3 block rounded-card bg-[color-mix(in_srgb,var(--alert)_10%,transparent)] p-3 text-alert">
                  <span className="block font-semibold">{confirm.req.reclaims!.name} is online now with its current key.</span>
                  This may be someone else taking its seat. Go on only if you know the old key is lost.
                  <label className="mt-2 flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="size-4 accent-[var(--alert)]" />
                    I’m sure the old key is lost
                  </label>
                </span>
              )}
            </>
          )
        }
      >
        <Button variant="secondary" onClick={() => (setConfirm(null), setSure(false))}>
          Cancel
        </Button>
        {confirm?.kind === "reclaim" && (
          <Button
            variant={confirm.online ? "danger" : "primary"}
            disabled={busy || (confirm.online && !sure)}
            onClick={() =>
              run(() => p.onReclaim(confirm.req, { online: confirm.online, force: confirm.online && sure }), `${confirm.req.reclaims!.name}’s seat moved to the new key`).then(() => setSure(false))
            }
          >
            Move seat
          </Button>
        )}
      </Alert>

      <Alert
        open={confirm?.kind === "remove"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "remove" ? `Remove ${memberName(confirm.member)}?` : ""}
        message="They’re disconnected at once, and the key rotates so they can’t read anything new."
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        {confirm?.kind === "remove" && (
          <Button className="bg-alert" disabled={busy} onClick={() => run(() => p.onRemove(confirm.member), `Removed ${confirm.member.name}`)}>
            Remove
          </Button>
        )}
      </Alert>

      <Alert
        open={confirm?.kind === "close" || confirm?.kind === "leave"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "close" ? "Close this channel for everyone?" : "Leave this channel?"}
        message={
          confirm?.kind === "close"
            ? "Every message, member and key is deleted on the relay, and everyone’s copy is wiped the next time they connect. It can’t be recovered."
            : "You lose access at once, and the key rotates so you can’t read anything newer. Coming back takes the owner’s approval."
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        <Button
          className="bg-alert"
          disabled={busy}
          onClick={() => run(confirm?.kind === "close" ? p.onCloseChannel : p.onLeaveChannel, confirm?.kind === "close" ? "Channel closed" : "You left the channel")}
        >
          {confirm?.kind === "close" ? "Close channel" : "Leave channel"}
        </Button>
      </Alert>
    </Ctx.Provider>
  )
}

// ---------- people ----------

/** The faces in the header and, behind them, everyone in the channel: role, load, and what the owner can do. */
export function People({ here, subtitle, live }: { here: Member[]; subtitle: string; live: boolean }) {
  const { p, busy, run, ask, editRole, editScopes, openMode } = useControls()
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const mode = p.state.mode
  const coordinator = p.state.coordinator
  const active = p.roster.filter((m) => m.active).sort((a, b) => Number(b.owner) - Number(a.owner) || Number(p.online.has(b.name)) - Number(p.online.has(a.name)))
  const former = p.roster.filter((m) => !m.active)
  const act = (fn: () => void) => () => (setOpen(false), fn())

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="w-[340px] p-1.5"
      trigger={
        <button type="button" aria-label={`People, ${subtitle}`} className="flex h-7 max-w-full items-center gap-1.5 rounded-full px-2 text-left transition-colors hover:bg-wash data-popup-open:bg-wash">
          {live && here.length > 0 && (
            <span className="flex shrink-0 -space-x-1" aria-hidden>
              {here.slice(0, 5).map((m) => (
                <span key={m.name} className="flex rounded-full bg-canvas p-px">
                  <Monogram name={memberName(m)} agent={m.kind !== "human"} color={colorOf(p.state, m.name)} working={m.kind !== "human" && memberLoad(p.state, m.name, p.now).current.length > 0} size={16} />
                </span>
              ))}
            </span>
          )}
          <span className="truncate text-meta leading-tight text-ink-2">{subtitle}</span>
        </button>
      }
    >
      <div className="max-h-[min(520px,70svh)] overflow-y-auto">
        <h2 className="sr-only">People</h2>
        {/* Coordinator-only, where people are: who relays, and (owner) the switch. */}
        {(p.isOwner || mode.coordinatorOnly) && (
          <div className="mb-1 flex items-center gap-3 rounded-ctl bg-wash px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-ui font-medium">Coordinator-only {mode.coordinatorOnly ? "is on" : "is off"}</span>
              <span className="block text-meta text-ink-2">
                {coordinator
                  ? mode.coordinatorOnly
                    ? `People talk with ${memberName(p.state.members.get(coordinator))}, who passes things on.`
                    : `${memberName(p.state.members.get(coordinator))} is the coordinator.`
                  : "Make an agent the coordinator to route people through it."}
              </span>
            </span>
            {p.isOwner && p.onMode && (
              <Button size="sm" variant="secondary" onClick={act(openMode)}>
                {mode.coordinatorOnly ? "Change…" : "Turn on…"}
              </Button>
            )}
          </div>
        )}
        {active.map((m) => {
          // Agents always show load, so a coordinator sees who's free; people only when they hold tasks.
          const load = memberLoad(p.state, m.name, p.now)
          const showLoad = showsLoad(m, load)
          // Roles as the owner last set them: role events fold on top of the signed record.
          const now = p.state.members.get(m.name)
          const asked = now?.roleRequest
          return (
            <div key={m.pk} className="rounded-ctl px-2 py-1.5 hover:bg-wash">
              <div className="flex items-center gap-2.5">
                <Monogram name={memberName(m)} agent={m.kind !== "human"} size={26} online={p.online.has(m.name)} color={colorOf(p.state, m.name)} working={m.kind !== "human" && load.current.length > 0} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={act(() => p.onFilter({ kind: "from", name: m.name }))} title="Show only their messages">
                  <p className="truncate text-ui font-medium">
                    {memberName(m)}
                    {m.pk === p.myKey && <span className="font-normal text-ink-2"> (you)</span>}
                  </p>
                  <p className="truncate text-meta text-ink-2" title={`${now?.about ? `Rules: ${now.about}\n` : ""}Key ${m.pk.slice(0, 16)}`}>
                    {showLoad && load.level !== "free" ? loadLine(load) : memberLine(now ?? m)}
                    {now && !m.owner && scopesLine(now.scopes) && <span> · {scopesLine(now.scopes)}</span>}
                  </p>
                  {now?.card && (
                    <p className="truncate text-meta text-ink-3" title={cardLine(now.card)}>
                      {cardLine(now.card)}
                    </p>
                  )}
                </button>
                {showLoad && (
                  <span
                    title={loadDetail(load)}
                    className={cx("shrink-0 rounded-full px-2 py-0.5 text-meta font-medium shadow-[inset_0_0_0_1px_var(--line)]", load.level === "overloaded" ? "text-alert" : "text-ink-2")}
                  >
                    {LEVEL[load.level]}
                  </span>
                )}
                {p.isOwner && !m.owner && (
                  <Menu
                    align="end"
                    trigger={
                      <IconButton label={`More for ${memberName(m)}`} className="size-7">
                        <Icon icon={MoreHorizontalIcon} size={16} />
                      </IconButton>
                    }
                  >
                    <MenuItem onClick={act(() => editRole(m))}>Set role…</MenuItem>
                    {m.kind !== "human" && p.state.coordinator !== m.name && (
                      <MenuItem onClick={act(() => void run(() => p.onRole({ op: "role.set", member: m.name, role: "coordinator" }), `${m.name} is the coordinator`))}>Make coordinator</MenuItem>
                    )}
                    {p.onScopes && <MenuItem onClick={act(() => editScopes(m))}>What they can do…</MenuItem>}
                    <MenuSeparator />
                    <MenuItem tone="danger" onClick={act(() => ask({ kind: "remove", member: m }))}>
                      Remove from channel…
                    </MenuItem>
                  </Menu>
                )}
              </div>
              {asked && (
                <div className="mt-1 ml-[36px] flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
                  <span className="min-w-0 text-ink-2">
                    Asks to be <span className="font-medium text-ink">{asked.role ?? "unassigned"}</span>
                    {asked.about && <span> · {asked.about}</span>}
                  </span>
                  {p.isOwner ? (
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(() => p.onRole({ op: "role.set", member: m.name, role: asked.role ?? null, about: asked.about ?? null }), `${m.name} is now ${asked.role ?? "unassigned"}`)
                        }
                      >
                        Allow
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => p.onRole({ op: "role.refuse", member: m.name }), `Kept ${m.name}'s role`)}>
                        Refuse
                      </Button>
                    </span>
                  ) : (
                    <span className="text-ink-2">The owner decides.</span>
                  )}
                </div>
              )}
              {m.pk === p.myKey && (m.kind === "human" || m.owner) && p.onColor && (
                <div className="mt-1 ml-[36px]">
                  {picking ? (
                    <ColorPicker state={p.state} me={m.name} />
                  ) : (
                    <button type="button" onClick={() => setPicking(true)} className="flex h-6 items-center gap-1.5 rounded-row px-1.5 text-meta text-ink-2 hover:bg-wash hover:text-ink">
                      <span className="size-3 rounded-full" style={{ background: colorOf(p.state, m.name) ? PALETTE[colorOf(p.state, m.name)!].fill : "var(--wash-2)" }} />
                      Your colour
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {former.length > 0 && <p className="px-2 pt-1.5 pb-1 text-meta text-ink-2">Left: {former.map((m) => m.name).join(", ")}</p>}
      </div>
      <div className="mt-1 border-t border-line px-2 pt-2 pb-1 text-meta text-ink-2">Choose a name to see only their messages.</div>
    </Popover>
  )
}

/** Your colour: one per person in the channel, and your agents wear it. Taken ones show who holds them. */
function ColorPicker({ state, me }: { state: ChannelState; me: string }) {
  const { p, busy, run } = useControls()
  const mine = colorOf(state, me)
  const holders = new Map<Color, Member>()
  for (const x of state.members.values()) if (x.active && x.name !== me && x.color && (x.kind === "human" || x.owner)) holders.set(x.color, x)
  const pick = (c: Color | null) => void run(() => p.onColor!(c), c ? `You're ${c} now` : "Colour cleared")
  return (
    <div className="flex flex-wrap items-center gap-1 py-0.5" role="radiogroup" aria-label="Your colour">
      {COLORS.map((c) => {
        const holder = holders.get(c)
        const on = mine === c
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={holder ? `${c}, ${memberName(holder)}'s` : c}
            title={holder ? `${memberName(holder)}'s colour` : on ? `${c} (yours, click to clear)` : c}
            disabled={busy || !!holder}
            onClick={() => pick(on ? null : c)}
            className={cx(
              "grid size-5 place-items-center rounded-full text-[8px] font-semibold transition-[opacity,box-shadow] disabled:cursor-not-allowed",
              holder && "opacity-35",
              on && "shadow-[0_0_0_2px_var(--canvas),0_0_0_3.5px_var(--ink)]",
            )}
            style={{ background: PALETTE[c].fill, color: PALETTE[c].text }}
          >
            {holder && initials(memberName(holder))}
          </button>
        )
      })}
    </div>
  )
}

// ---------- invite ----------

/**
 * Single-quoted for the agent's shell. Apostrophes become ’ so the same line works in sh, bash, zsh
 * and PowerShell, which escape a quote inside quotes differently.
 */
const quoted = (s: string) => `'${s.replace(/'/g, "’")}'`

/** The CLI's default relay (DEFAULT_RELAY in src/config.ts, which the browser can't import). */
const PUBLIC_RELAY = "https://channels.kiwiinit.com"

const ROLES = ["designer", "frontend", "backend", "reviewer", "tester", "docs", "intern"]

export function InviteButton() {
  const { p, openInvite } = useControls()
  if (!p.isOwner) return null
  return (
    // On a phone it lives in the channel menu (Invite…), so the header keeps room for the title.
    <Button size="sm" variant="secondary" className="h-8 gap-1 pr-3 pl-2.5 max-md:hidden" aria-label="Invite" onClick={openInvite}>
      <Icon icon={Add01Icon} size={15} />
      <span>Invite</span>
    </Button>
  )
}

/** One dialog for both ways in: a link for a person, a command for an agent with the role and rules agreed up front. */
function Invite({ onDone }: { onDone: () => void }) {
  const { p } = useControls()
  const [who, setWho] = useState<"person" | "agent">("agent")
  const [name, setName] = useState("")
  const [role, setRole] = useState("")
  const [rules, setRules] = useState("")
  const [newScopes, setNewScopes] = useState<Scope[]>(() => (p.roomId ? defaultScopes(p.roomId) : [...SCOPES]))
  const n = name.trim()
  const badName = !!n && !NAME_RE.test(n)
  const command = [
    `kiwi join ${p.code}`,
    // On any other relay, the agent's CLI has to be told where to go.
    location.origin !== PUBLIC_RELAY && `--relay ${location.origin}`,
    `--as ${n && !badName ? n : "<name>"}`,
    role.trim() && `--role ${quoted(role.trim())}`,
    rules.trim() && `--about ${quoted(rules.trim())}`,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className="p-5">
      <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Invite to this channel</Dialog.Title>
      <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">Everyone who joins waits for you to approve them with a 6-digit code.</Dialog.Description>
      <div className="mt-4">
        <Tabs
          stretch
          label="Who you're inviting"
          value={who}
          onChange={setWho}
          options={[
            { value: "agent", label: "An agent" },
            { value: "person", label: "A person" },
          ]}
        />
      </div>
      {who === "person" ? (
        <div role="tabpanel" aria-label="A person" className="mt-4 grid gap-2">
          <p className="text-ui leading-normal text-ink-2">Send them this link. They open it, sign in, and ask to join.</p>
          <CopyBox text={inviteLink(p.code)} label="Copy link" done="Invite link copied" />
        </div>
      ) : (
        <div role="tabpanel" aria-label="An agent" className="mt-4 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={32} aria-invalid={badName} aria-label="Agent name" aria-describedby={badName ? "invite-name-error" : undefined} />
            <TextField value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" maxLength={60} list="kiwi-roles" aria-label="Role" />
          </div>
          <TextField value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Rules, e.g. only web/; ask before changing APIs" maxLength={200} aria-label="Rules" />
          {badName && (
            <p id="invite-name-error" role="alert" className="text-meta text-ink-2">
              Names are letters, digits, dot, dash or underscore, up to 32.
            </p>
          )}
          <CopyBox text={command} label="Copy command" done={n && !badName ? "Join command copied" : "Copied. Replace <name> with the agent’s name."} />
          <p className="text-meta text-ink-3">
            Run it on a computer set up with <span className="font-mono">kiwi setup</span>.
          </p>
        </div>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-ui font-medium text-ink">
          New members can <span className="font-normal text-ink-3">· you confirm it when you approve each one</span>
        </p>
        <ScopePicker value={newScopes} onChange={(s) => (setNewScopes(s), p.roomId && saveDefaultScopes(p.roomId, s))} />
      </div>
      <datalist id="kiwi-roles">
        {ROLES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

// ---------- join requests ----------

/** The quiet line above the conversation when someone's waiting to be let in. Owner only. */
export function RequestsBanner() {
  const { p, openRequests } = useControls()
  const auth = useAuth()
  if (!p.isOwner || p.requests.length === 0) return null
  const first = p.requests[0]!
  return (
    <div className="flex shrink-0 items-center gap-3 bg-accent-wash px-5 py-2 text-ui">
      <span className="min-w-0 flex-1 truncate">
        {p.requests.length > 1 ? (
          `${p.requests.length} people and agents want to join this channel.`
        ) : first.reclaims ? (
          <>
            A new key wants to take back <span className="font-medium">{first.reclaims.name}</span>’s seat.
          </>
        ) : (
          <>
            <span className="font-medium">{first.name}</span> wants to join this channel.
          </>
        )}
      </span>
      {auth.status === "signed-out" ? (
        <button type="button" onClick={auth.signIn} className="shrink-0 font-medium hover:underline">
          Sign in to review
        </button>
      ) : (
        <button type="button" onClick={openRequests} className="shrink-0 font-medium hover:underline">
          Review
        </button>
      )}
    </div>
  )
}

function Requests({ onDone }: { onDone: () => void }) {
  const { p, busy, run, ask, lastSeenOf, onlineNow } = useControls()
  const requests = p.requests
  // Close once the last request is handled, rather than leave "Nobody's waiting" up.
  const empty = requests.length === 0
  useEffect(() => {
    if (empty) onDone()
  }, [empty, onDone])
  return (
    <div className="p-5">
      <h2 className="text-title font-semibold tracking-[-0.01em]">{requests.length > 1 ? `${requests.length} want to join` : "Wants to join"}</h2>
      <p className="mt-1 text-ui leading-normal text-ink-2">Show the code, compare it with theirs, then approve.</p>
      {/* 'unchecked' on a plain join means this device's daily signing budget is spent: say so even for one. Reclaims are never checked on their own. */}
      {requests.some((r) => r.check === "unchecked" && !r.reclaims) && <p className="mt-3 rounded-card bg-wash p-3 text-ui leading-normal text-ink-2">{TOO_MANY_REQUESTS}</p>}
      {requests.some((r) => r.check === "unchecked" && r.reclaims) && <p className="mt-3 text-ui leading-normal text-ink-3">A reclaim’s code is shown only when you ask for it.</p>}
      <div className="mt-4 grid gap-4">
        {requests.length === 0 && <p className="text-ui text-ink-3">Nobody’s waiting.</p>}
        {requests.map((r) => (
          <div key={r.id} className="flex items-start gap-3">
            <Monogram name={r.name} agent={r.kind !== "human"} size={28} />
            <div className="min-w-0 flex-1">
              {r.reclaims ? (
                <>
                  <p className="truncate text-ui font-medium">Takes back {r.reclaims.name}’s seat</p>
                  <p className="text-meta leading-snug text-ink-2">
                    Old key {r.reclaims.pk.slice(0, 8)}
                    {lastSeenOf(r.reclaims.name) ? `, last seen ${formatAgo(lastSeenOf(r.reclaims.name)!, p.now)}` : ""} · new key {r.pk.slice(0, 8)}
                  </p>
                  {onlineNow(r.reclaims.name) && <p className="text-meta leading-snug font-medium text-alert">{r.reclaims.name} is online now with its current key</p>}
                </>
              ) : (
                <p className="truncate text-ui font-medium">
                  {r.name}
                  {r.role && <span className="font-normal text-ink-2">, {r.role}</span>}
                </p>
              )}
              <p className="text-meta leading-snug text-ink-2">
                {r.kind === "human" ? `Signed in as ${r.sponsoredBy?.name ?? "someone"}` : r.sponsoredBy ? `Agent for ${r.sponsoredBy.name}, from their computer` : "Agent"}
                {r.sponsoredBy?.email && ` · ${r.sponsoredBy.email}`} · asked {formatAgo(r.ts, p.now)}
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => run(() => p.onDeny(r), `Declined ${r.name}`)}>
                  Decline
                </Button>
                {r.check === "ready" ? (
                  <Button size="sm" onClick={() => ask(r.reclaims ? { kind: "reclaim", req: r, online: onlineNow(r.reclaims.name) } : { kind: "approve", req: r })}>
                    Review and approve
                  </Button>
                ) : r.check === "unchecked" ? (
                  <Button size="sm" disabled={busy} onClick={() => run(() => p.onCheck(r), `Asked ${r.name} for its code`)}>
                    Show code
                  </Button>
                ) : (
                  <span className="self-center text-meta text-ink-3">Waiting for {r.kind === "human" ? "their" : "its"} code…</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

// ---------- the ⋯ menu ----------

/** Things you do to the channel itself, the dangerous ones last and in red. */
export function ChannelMenu() {
  const { p, ask, openInvite, openRequests, openMode } = useControls()
  const auth = useAuth()
  const [iconOpen, setIconOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [charterOpen, setCharterOpen] = useState(false)
  const [holding, setHolding] = useState(false)
  return (
    <>
      <Menu
        align="end"
        className="w-56"
        trigger={
          <IconButton label="Channel menu" round>
            <Icon icon={MoreHorizontalIcon} size={18} />
          </IconButton>
        }
      >
        {/* Inviting is the owner's, as it was in the old panel: they approve everyone who asks. */}
        {p.isOwner && <MenuItem icon={Link01Icon} onClick={() => navigator.clipboard.writeText(inviteLink(p.code)).then(() => toast("Invite link copied"))}>Copy invite link</MenuItem>}
        {p.isOwner && <MenuItem icon={UserAdd01Icon} onClick={openInvite}>Invite…</MenuItem>}
        {p.isOwner && p.requests.length > 0 && (
          <MenuItem icon={UserMultipleIcon} onClick={auth.status === "signed-out" ? auth.signIn : openRequests}>
            {auth.status === "signed-out" ? "Sign in to review join requests" : `Join requests (${p.requests.length})`}
          </MenuItem>
        )}
        {p.isOwner && p.onRename && <MenuItem icon={PencilEdit01Icon} onClick={() => setRenaming(true)}>Rename channel…</MenuItem>}
        {p.isOwner && p.onSetIcon && <MenuItem icon={Image01Icon} onClick={() => setIconOpen(true)}>Channel icon…</MenuItem>}
        {p.isOwner && p.onMode && <MenuItem icon={UserStar01Icon} onClick={openMode}>{p.state.mode.coordinatorOnly ? "Coordinator-only: on…" : "Coordinator-only…"}</MenuItem>}
        {(p.isOwner || p.state.charter) && <MenuItem icon={BookOpen01Icon} onClick={() => setCharterOpen(true)}>{p.isOwner ? "Charter…" : "Charter"}</MenuItem>}
        {p.isOwner && p.onHold && (p.state.hold ? (
          <MenuItem icon={PlayIcon} onClick={() => void p.onHold!(false).then(() => toast("Agents may carry on"), (err) => toast(errorText(err), "error"))}>Lift the hold</MenuItem>
        ) : (
          <MenuItem icon={PauseIcon} onClick={() => setHolding(true)}>Hold all agents…</MenuItem>
        ))}
        {p.terminalCommand && (
          <MenuItem
            icon={ComputerTerminal01Icon}
            onClick={() => navigator.clipboard.writeText(p.terminalCommand!()).then(() => toast("Copied. It carries your key: paste it only into a terminal on your own computer."))}
          >
            Use in a terminal
          </MenuItem>
        )}
        <MenuSeparator />
        {p.isOwner ? (
          <MenuItem tone="danger" icon={Delete02Icon} onClick={() => ask({ kind: "close" })}>
            Close channel…
          </MenuItem>
        ) : (
          <MenuItem tone="danger" icon={Logout01Icon} onClick={() => ask({ kind: "leave" })}>
            Leave channel…
          </MenuItem>
        )}
      </Menu>
      {p.onSetIcon && <IconDialog open={iconOpen} onClose={() => setIconOpen(false)} icon={cachedIcon(p.roomId ?? "")} onSave={p.onSetIcon} />}
      {p.onRename && renaming && <RenameDialog title={p.title ?? ""} onClose={() => setRenaming(false)} onSave={p.onRename} />}
      {charterOpen && <CharterDialog text={p.state.charter?.text ?? ""} onClose={() => setCharterOpen(false)} onSave={p.isOwner ? p.onCharter : undefined} />}
      {holding && p.onHold && <HoldDialog onClose={() => setHolding(false)} onSave={(note) => p.onHold!(true, note)} />}
    </>
  )
}

/**
 * While the owner holds the channel: everyone sees it, agents' work is refused by every client, and
 * the owner lifts it from here.
 */
export function HoldBanner() {
  const { p } = useControls()
  const hold = p.state.hold
  if (!hold) return null
  return (
    <div role="status" className="flex shrink-0 items-center gap-3 bg-alert/10 px-5 py-2 text-ui text-ink">
      <Icon icon={PauseIcon} size={16} className="shrink-0 text-alert" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">Agents are on hold.</span> {hold.note ? hold.note : "Their work is refused until the owner lifts it; they may still answer people."}
      </span>
      {p.isOwner && p.onHold && (
        <button type="button" onClick={() => void p.onHold!(false).then(() => toast("Agents may carry on"), (err) => toast(errorText(err), "error"))} className="shrink-0 font-medium hover:underline">
          Lift the hold
        </button>
      )}
    </div>
  )
}

/** The owner stops every agent at once, saying why. */
function HoldDialog({ onClose, onSave }: { onClose: () => void; onSave: (note?: string) => Promise<void> }) {
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await onSave(note.trim() || undefined)
      toast("Every agent is on hold")
      onClose()
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose}>
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Hold all agents</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">
          Every agent is told to stop at once. Until you lift the hold, every member’s client refuses an agent’s tasks, claims, facts and messages to other agents. Agents may still answer people.
        </Dialog.Description>
        <TextField className="mt-4" autoFocus value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional): agents and people see it" aria-label="Why" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Hold all agents
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** The charter: what the channel is for and where its limits are. Agents escalate what falls outside it. */
function CharterDialog({ text, onClose, onSave }: { text: string; onClose: () => void; onSave?: (text: string | null) => Promise<void> }) {
  const [draft, setDraft] = useState(text)
  const [busy, setBusy] = useState(false)
  const next = draft.trim()
  const save = async () => {
    setBusy(true)
    try {
      await onSave!(next || null)
      toast(next ? "Charter saved" : "Charter cleared")
      onClose()
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose}>
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (onSave && next !== text) void save()
        }}
      >
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Charter</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">
          What this channel is for, and where its limits are. Every agent is shown it, and escalates a request that falls outside it to its person and you instead of doing it.
        </Dialog.Description>
        {onSave ? (
          <textarea
            autoFocus
            value={draft}
            maxLength={MAX_CHARTER}
            rows={6}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ship the Windows input driver. Only this repo; nothing in production; no new dependencies without asking."
            aria-label="Charter"
            className="mt-4 w-full resize-y rounded-ctl border border-edge bg-raised px-3 py-2 text-body outline-none placeholder:text-ink-3 focus:border-edge-strong"
          />
        ) : (
          <p className="mt-4 whitespace-pre-wrap text-body text-ink">{text}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {onSave ? "Cancel" : "Close"}
          </Button>
          {onSave && (
            <Button type="submit" disabled={busy || next === text.trim()}>
              {next || !text ? "Save" : "Clear"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

/** The owner turns coordinator-only on or off: people talk only with the coordinator, who relays. */
function ModeDialog({ state, onClose, onSave }: { state: ChannelState; onClose: () => void; onSave: (on: boolean, strict: boolean) => Promise<void> }) {
  const on = state.mode.coordinatorOnly
  const [strict, setStrict] = useState(on ? state.mode.strict : true)
  const [busy, setBusy] = useState(false)
  const save = async (next: boolean) => {
    setBusy(true)
    try {
      await onSave(next, strict)
      toast(next ? "Coordinator-only is on" : "Coordinator-only is off")
      onClose()
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose}>
      <div className="p-5">
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Coordinator-only</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">
          People talk only with the coordinator, who passes things on to the agents and back. Everyone still sees the whole channel under Everything.
        </Dialog.Description>
        <p className="mt-3 text-ui leading-normal text-ink">
          {state.coordinator ? (
            <>
              The coordinator is <span className="font-medium">{memberName(state.members.get(state.coordinator))}</span>.
            </>
          ) : (
            <span className="text-ink-2">There’s no coordinator yet: give someone the role “coordinator” in People. Until then, nothing changes.</span>
          )}
        </p>
        <label className="mt-4 flex items-start gap-2 text-ui leading-normal">
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            Strict
            <span className="block text-meta text-ink-3">Every member’s client refuses another agent’s message to a person.</span>
          </span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {on && (
            <Button variant="secondary" disabled={busy} onClick={() => void save(false)}>
              Turn off
            </Button>
          )}
          <Button disabled={busy || (on && strict === state.mode.strict)} onClick={() => void save(true)}>
            {on ? "Save" : "Turn on"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** The owner renames the channel. Every member sees the new name; the relay never can. */
function RenameDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = name.trim()
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave(next)
      toast(`Renamed to ${next}`)
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose}>
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (next && next !== title) void save()
        }}
      >
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Rename channel</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">Everyone in the channel sees the new name. It’s encrypted, so the relay can’t read it.</Dialog.Description>
        <TextField className="mt-4" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Channel name" aria-invalid={!!error} aria-describedby={error ? "rename-error" : undefined} onFocus={(e) => e.currentTarget.select()} />
        {error && (
          <p id="rename-error" role="alert" className="mt-2 text-ui text-alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !next || next === title}>
            Rename
          </Button>
        </div>
      </form>
    </Modal>
  )
}
