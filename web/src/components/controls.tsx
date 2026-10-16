import { relayUrl } from "../lib/relay"
import { Dialog } from "@base-ui/react/dialog"
import { Copy01Icon, PauseIcon } from "@hugeicons/core-free-icons"
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"

import { memberLoad, showsLoad, type Load } from "@mc/load.ts"
import { NAME_RE, nameKey, type JoinRequest, type Member as RosterMember } from "@mc/membership.ts"
import { MAX_CHARTER, type ChannelIcon, type Color, type Event } from "@mc/protocol.ts"
import { TOO_MANY_REQUESTS } from "@mc/sas.ts"
import { SCOPES, type Scope } from "@mc/scopes.ts"
import { COORDINATOR, firstAgent, isPerson, taskId, type ChannelState } from "@mc/state.ts"
import { noteAgentWorked } from "@/lib/channel"
import { formatAgo, memberLine, memberName } from "@/lib/format"
import { defaultScopes, saveDefaultScopes, ScopePicker, scopesLine } from "./scopes"
import { Icon } from "./icon"
import { Alert, Button, IconButton, Modal, Monogram, Tabs, TextField, errorText, toast } from "./kit"
import { Menu, MenuItem, MenuSeparator } from "./ui/menu"
import { AgentFacts } from "./agent-facts"

// Everything about a channel that isn't the conversation, each where you'd
// look for it: people behind the faces in the header, Invite as a button,
// join requests behind the banner, and leaving or closing in the ⋯ menu.
// ChannelControls holds the shared state and every confirm dialog; the
// pieces below read it from context.

type Confirm =
  | { kind: "approve"; req: JoinRequest }
  | { kind: "remove"; member: RosterMember }
  | { kind: "role"; member: RosterMember }
  | { kind: "scopes"; member: RosterMember }
  | { kind: "nickname"; member: RosterMember }
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
  /** `scopes`: what they may do besides read; left out, everything. */
  onApprove: (r: JoinRequest, scopes?: Scope[]) => Promise<void>
  onDeny: (r: JoinRequest) => Promise<void>
  /** Sign this browser's half of a request's code check, at the person's click. */
  onCheck: (r: JoinRequest) => Promise<void>
  onRemove: (m: RosterMember) => Promise<void>
  /** Owner: change what a member may do besides read (a signed scope.set, then the relay's bit). */
  onScopes?: (m: RosterMember, scopes: Scope[]) => Promise<void>
  /** Owner: set a member's role (a signed event). role.refuse is an older owner's; nothing sends it now. */
  onRole: (ev: Extract<Event, { op: "role.set" | "role.refuse" }>) => Promise<void>
  onNickname?: (m: RosterMember, nickname: string | null) => Promise<void>
  onCloseChannel: () => Promise<void>
  onLeaveChannel: () => Promise<void>
  /** Unused: channel icons left the UI (T1389). Still accepted until conversation.tsx stops passing it. */
  onSetIcon?: (icon: ChannelIcon | null) => Promise<void>
  /** Owner: rename the channel (a title signed by the owner). Absent for everyone else. */
  onRename?: (name: string) => Promise<void>
  /** Unused: colours left the UI (T1389). Still accepted until conversation.tsx stops passing it. */
  onColor?: (color: Color | null) => Promise<void>
  /** Owner: coordinator-only on or off (an owner-signed mode.set). It follows the coordinator: on with one, off without. */
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
  /** Owner: make a member the coordinator, or not: coordinator-only follows, so nobody has a mode to learn. */
  setCoordinator: (m: RosterMember, on: boolean) => Promise<void>
  /** Owner: every role change goes through here, so coordinator-only always follows who holds the role. */
  setRole: (ev: Extract<Event, { op: "role.set" | "role.refuse" }>) => Promise<void>
  editRole: (m: RosterMember) => void
  editScopes: (m: RosterMember) => void
  editNickname: (m: RosterMember) => void
  lastSeenOf: (name: string) => number | null
  onlineNow: (name: string) => boolean
  /** The channel's own dialogs, from wherever they're offered (the info panel). */
  openDialog: (d: "rename" | "charter") => void
}

const Ctx = createContext<Api | null>(null)

const isCoordinator = (role: string | null | undefined) => role?.trim().toLowerCase() === COORDINATOR
/** The channel's controls, for views inside ChannelControls (the Needs you inbox approves with them). */
export const useControls = () => useContext(Ctx)!

const LEVEL = { free: "Free", busy: "Busy", overloaded: "Overloaded" } as const

/** Everything behind a member's load, one item per line, for the tooltip. */
function loadDetail(l: Load): string {
  const lines = [
    ...l.current.map((t) => `Doing ${taskId(t.id)} ${t.title}`),
    ...l.queued.map((t) => `Queued ${taskId(t.id)} ${t.title}`),
    ...l.waiting.map((t) => `In review ${taskId(t.id)} ${t.title}`),
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

const inviteLink = (code: string) => `${relayUrl()}/#${code}`

export function ChannelControls({ children, ...p }: ControlsProps & { children: ReactNode }) {
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [sheet, setSheet] = useState<"requests" | "invite" | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<"rename" | "charter" | null>(null)
  const [roleDraft, setRoleDraft] = useState({ role: "", about: "" })
  const [scopeDraft, setScopeDraft] = useState<Scope[]>([...SCOPES])
  const [nickDraft, setNickDraft] = useState("")
  const active = p.roster.filter((m) => m.active)
  // Someone else's seat: the joiner's own key landing in the roster mid-approve (the live join event beats
  // the approve call home) is this request going through, not a clash.
  const taken = confirm?.kind === "approve" && active.some((m) => m.pk !== confirm.req.pk && nameKey(m.name) === nameKey(confirm.req.name))
  // A seat in use: seen in the last ten minutes or listening right now (the same rule as kiwi approve).
  const lastSeenOf = (name: string) => p.state.members.get(name)?.lastSeen || null
  const onlineNow = (name: string) => p.online.has(name) || p.now - (lastSeenOf(name) ?? 0) < 10 * 60_000

  const admittedElsewhere = confirm?.kind === "approve" && !busy && active.some((m) => m.pk === confirm.req.pk)

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await fn()
      toast(done)
      setConfirm(null)
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }

  /**
   * A role change, then the mode it implies: coordinator-only is on exactly while someone holds the
   * coordinator role (one holder: giving it moves it). If the mode change fails, the reconciler below
   * puts it right the next time this owner's page sees the channel.
   */
  // While the owner changes a role (and the mode that follows it), the reconciler below keeps out of it.
  const changing = useRef(false)
  const setRole = async (ev: Extract<Event, { op: "role.set" | "role.refuse" }>) => {
    changing.current = true
    try {
      const becomes = ev.op === "role.set" && isCoordinator(ev.role)
      const was = ev.op === "role.set" && p.state.coordinator === ev.member
      // Taking the coordinator away: the mode goes first, so no moment has coordinator mode with nobody in
      // it (when any owner page or CLI would hand the role to the next agent).
      if (!becomes && was && p.onMode && p.state.mode.coordinatorOnly) await p.onMode(false, true)
      await p.onRole(ev)
      if (becomes && p.onMode && !p.state.mode.coordinatorOnly) await p.onMode(true, true)
    } finally {
      changing.current = false
    }
  }

  // An agent with a card in this channel has worked here, however old the history (the vault waits for this).
  const agentHere = [...p.state.members.values()].some((m) => m.active && !isPerson(m) && !!m.card)
  useEffect(() => {
    if (agentHere) noteAgentWorked()
  }, [agentHere])

  // Coordinator mode with nobody coordinating (a new channel, or the coordinator left): the owner's page
  // gives the role to the first agent in, the default unless the owner picks another. Once per agent, so a
  // refused change doesn't loop; with no agent yet, delivery is as usual until one arrives.
  const tried = useRef("")
  const next = p.state.mode.coordinatorOnly && !p.state.coordinator ? firstAgent(p.state) : undefined
  const { isOwner, onRole } = p
  useEffect(() => {
    if (!isOwner || !next || tried.current === next || changing.current) return
    tried.current = next
    void onRole({ op: "role.set", member: next, role: COORDINATOR }).catch(() => {})
  }, [isOwner, onRole, next])

  const api: Api = {
    p,
    busy,
    run,
    ask: (c) => {
      // Approving starts from what this browser picked for new members when inviting.
      if (c?.kind === "approve") {
        setScopeDraft(p.roomId ? defaultScopes(p.roomId) : [...SCOPES])
      }
      setConfirm(c)
    },
    openRequests: () => setSheet("requests"),
    openInvite: () => setSheet("invite"),
    setCoordinator: (m, on) =>
      run(() => setRole({ op: "role.set", member: m.name, role: on ? COORDINATOR : null }), on ? `${m.name} is the coordinator: people talk with them` : `${m.name} isn't the coordinator any more`),
    setRole,
    editRole: (m) => {
      const live = p.state.members.get(m.name)
      setRoleDraft({ role: live?.role ?? "", about: live?.about ?? "" })
      setConfirm({ kind: "role", member: m })
    },
    editScopes: (m) => {
      // Two levels: read-only stays read-only; a member, or an older limited grant, starts at everything.
      const now = p.state.members.get(m.name)?.scopes
      setScopeDraft(now && now.length === 0 ? [] : [...SCOPES])
      setConfirm({ kind: "scopes", member: m })
    },
    editNickname: (m) => {
      setNickDraft(m.display ?? "")
      setConfirm({ kind: "nickname", member: m })
    },
    lastSeenOf,
    onlineNow,
    openDialog: setDialog,
  }

  return (
    <Ctx.Provider value={api}>
      {children}

      {p.onRename && dialog === "rename" && <RenameDialog title={p.title ?? ""} onClose={() => setDialog(null)} onSave={p.onRename} />}
      {dialog === "charter" && <CharterDialog text={p.state.charter?.text ?? ""} onClose={() => setDialog(null)} onSave={p.isOwner ? p.onCharter : undefined} />}

      <Modal open={sheet === "requests" && confirm === null} onClose={() => setSheet(null)} wide>
        <Requests onDone={() => setSheet(null)} />
      </Modal>
      <Modal open={sheet === "invite"} onClose={() => setSheet(null)} wide>
        <Invite onDone={() => setSheet(null)} />
      </Modal>

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
            void run(() => setRole({ op: "role.set", member: name, role: roleDraft.role.trim() || null, about: roleDraft.about.trim() || null }), `Saved ${name}’s role`)
          }}
        >
          Save
        </Button>
      </Alert>

      <Alert
        open={confirm?.kind === "nickname"}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "nickname" ? `Nickname for @${confirm.member.name}` : ""}
        message={
          <span className="mt-3 grid gap-2">
            <TextField value={nickDraft} onChange={(e) => setNickDraft(e.target.value)} placeholder="Nickname, e.g. claude" maxLength={40} aria-label="Nickname" autoFocus />
            <span className="text-meta text-ink-3">What everyone sees. Others still reach it as @{confirm?.kind === "nickname" ? confirm.member.name : ""}, which never changes.</span>
          </span>
        }
      >
        <Button variant="secondary" onClick={() => setConfirm(null)}>
          Cancel
        </Button>
        <Button
          disabled={busy || !p.onNickname}
          onClick={() => {
            if (confirm?.kind !== "nickname" || !p.onNickname) return
            const m = confirm.member
            const nick = nickDraft.trim()
            void run(() => p.onNickname!(m, nick || null), nick ? `@${m.name} is now ${nick}` : `@${m.name} has no nickname now`)
          }}
        >
          Save
        </Button>
      </Alert>

      <Alert
        open={confirm?.kind === "approve" && !admittedElsewhere}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "approve" ? `Let ${confirm.req.name} in?` : ""}
        message={
          confirm?.kind === "approve" && (
            <>
              {confirm.req.kind !== "human" && <AgentFacts card={confirm.req.card} said className="mb-3" />}
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
        title={confirm?.kind === "scopes" ? `Can ${confirm.member.name} only read?` : ""}
        message={
          confirm?.kind === "scopes" && (
            <>
              <span className="mb-3 block">Every member’s client holds them to this from now on; what they sent before stands.</span>
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

/** The owner's actions on one member, behind whatever opens them (a member's tile in the info panel). */
export function MemberActions({ m, trigger, onMessage }: { m: RosterMember; trigger: Parameters<typeof Menu>[0]["trigger"]; onMessage?: () => void }) {
  const { p, ask, editRole, editScopes, editNickname, setCoordinator } = useControls()
  const now = p.state.members.get(m.name)
  return (
    <Menu align="center" trigger={trigger}>
      {onMessage && (
        <>
          <MenuItem onClick={onMessage}>Message privately</MenuItem>
          <MenuSeparator />
        </>
      )}
      {m.kind !== "human" && p.onNickname && <MenuItem onClick={() => editNickname(m)}>Change nickname…</MenuItem>}
      <MenuItem onClick={() => editRole(m)}>Set role…</MenuItem>
      {p.state.coordinator === m.name ? (
        <MenuItem onClick={() => void setCoordinator(m, false)}>No longer coordinator</MenuItem>
      ) : (
        m.kind !== "human" && <MenuItem onClick={() => void setCoordinator(m, true)}>Make coordinator</MenuItem>
      )}
      {p.onScopes && (
        <MenuItem onClick={() => editScopes(m)}>
          {now && scopesLine(now.scopes) === "read only" ? "Let them write…" : now && scopesLine(now.scopes) ? "Let them do everything…" : "Make read-only…"}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem tone="danger" onClick={() => ask({ kind: "remove", member: m })}>
        Remove from channel…
      </MenuItem>
    </Menu>
  )
}

/** One member's line under their face: their load when an agent is busy, else who they are. */
export function memberDetail(p: ControlsProps, m: RosterMember): string {
  const load = memberLoad(p.state, m.name, p.now)
  const now = p.state.members.get(m.name)
  if (showsLoad(m, load) && load.level !== "free") return LEVEL[load.level]
  if (p.state.coordinator === m.name) return "Coordinator"
  // An agent's model, as the owner signed it at approval, beside who it is.
  const runs = now?.runs ?? m.runs
  return runs ? `${memberLine(now ?? m)} · ${runs.model}` : memberLine(now ?? m)
}

export { loadDetail }

// ---------- invite ----------

/**
 * Single-quoted for the agent's shell. Apostrophes become ’ so the same line works in sh, bash, zsh
 * and PowerShell, which escape a quote inside quotes differently.
 */
const quoted = (s: string) => `'${s.replace(/'/g, "’")}'`

/** The CLI's default relay (DEFAULT_RELAY in src/config.ts, which the browser can't import). */
const PUBLIC_RELAY = "https://channels.kiwiinit.com"

const ROLES = ["designer", "frontend", "backend", "reviewer", "tester", "docs", "intern"]

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
    relayUrl() !== PUBLIC_RELAY && `--relay ${relayUrl()}`,
    // No name: the agent is called by what it runs in (claude, codex…), made unique when you approve it.
    n && !badName && `--as ${n}`,
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
          <p className="text-ui leading-normal text-ink-2">Send them this link. They open it and ask to join.</p>
          <CopyBox text={inviteLink(p.code)} label="Copy link" done="Invite link copied" />
        </div>
      ) : (
        <div role="tabpanel" aria-label="An agent" className="mt-4 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <TextField
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              maxLength={32}
              aria-invalid={badName}
              aria-label="Agent name"
              aria-describedby={badName ? "invite-name-error" : undefined}
            />
            <TextField value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" maxLength={60} list="kiwi-roles" aria-label="Role" />
          </div>
          <TextField value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Rules, e.g. only web/; ask before changing APIs" maxLength={200} aria-label="Rules" />
          {badName && (
            <p id="invite-name-error" role="alert" className="text-meta text-ink-2">
              Names are letters, digits, dot, dash or underscore, up to 32.
            </p>
          )}
          <CopyBox text={command} label="Copy command" done="Join command copied" />
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

function Requests({ onDone }: { onDone: () => void }) {
  const { p, busy, run, ask } = useControls()
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
      {/* 'unchecked' means this device's daily signing budget is spent: say so even for one. */}
      {requests.some((r) => r.check === "unchecked") && <p className="mt-3 rounded-card bg-wash p-3 text-ui leading-normal text-ink-2">{TOO_MANY_REQUESTS}</p>}
      <div className="mt-4 grid gap-4">
        {requests.length === 0 && <p className="text-ui text-ink-3">Nobody’s waiting.</p>}
        {requests.map((r) => (
          <div key={r.id} className="flex items-start gap-3">
            <Monogram name={r.display || r.name} hue={r.name} agent={r.kind !== "human"} size={28} />
            <div className="min-w-0 flex-1">
              {
                <p className="truncate text-ui font-medium">
                  {r.display || r.name}
                  {r.display && <span className="font-normal text-ink-3"> @{r.name}</span>}
                  {r.role && <span className="font-normal text-ink-2">, {r.role}</span>}
                  {r.askedAs && r.askedAs !== r.name && <span className="font-normal text-ink-2"> (asked as {r.askedAs}, which is taken)</span>}
                </p>
              }
              <p className="text-meta leading-snug text-ink-2">
                {r.kind === "human" ? "A person" : r.computer ? `Agent on ${r.computer.personName}’s ${r.computer.label}` : "Agent"} · asked {formatAgo(r.ts, p.now)}
              </p>
              {r.kind !== "human" && <AgentFacts card={r.card} said className="mt-1" />}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => run(() => p.onDeny(r), `Declined ${r.name}`)}>
                  Decline
                </Button>
                {r.check === "ready" ? (
                  <Button size="sm" onClick={() => ask({ kind: "approve", req: r })}>
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
        <button
          type="button"
          onClick={() =>
            void p.onHold!(false).then(
              () => toast("Agents may carry on"),
              (err) => toast(errorText(err), "error")
            )
          }
          className="shrink-0 font-medium hover:underline"
        >
          Lift the hold
        </button>
      )}
    </div>
  )
}

/** The owner stops every agent at once, saying why. */
export function HoldDialog({ onClose, onSave }: { onClose: () => void; onSave: (note?: string) => Promise<void> }) {
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
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Pause every agent</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">
          Every agent is told to stop at once. Until you lift the hold, every member’s client refuses an agent’s tasks, notes and messages to other agents. Agents may still answer people.
        </Dialog.Description>
        <TextField className="mt-4" autoFocus value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional): agents and people see it" aria-label="Why" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Pause agents
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
          <p className="mt-4 text-body whitespace-pre-wrap text-ink">{text}</p>
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
        <TextField
          className="mt-4"
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          aria-label="Channel name"
          aria-invalid={!!error}
          aria-describedby={error ? "rename-error" : undefined}
          onFocus={(e) => e.currentTarget.select()}
        />
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
