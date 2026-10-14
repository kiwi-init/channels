import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react"

import {
  Channel,
  ChannelGone,
  RelayError,
  eachLive,
  fx as relayFx,
  keepRecordsIn,
  ownerStatement,
  type HumanSession,
  type Live,
  type Relay,
  type ModeSetting,
  type MyChannel,
  type RoomsSetting,
  type SendOptions,
} from "@mc/client.ts"
import { decodeJoinCode, fromB64url, newRoomId, ownerFingerprint, type ChannelAccess } from "@mc/crypto.ts"
import { generateIdentity, withExchangeKey, type Identity } from "@mc/identity.ts"
import { handleFor, type JoinRequest, type Member } from "@mc/membership.ts"
import type { Message } from "@mc/protocol.ts"
import type { Signed, SigningBudget } from "@mc/sas.ts"
import { fold, type ChannelState, type GuardFloor, type Roster } from "@mc/state.ts"
import { forgetHistory, readCached, rememberMessage } from "./history"
import { wholeLog } from "./history-plan"
import { ICON_LIVE } from "./icon-event"
import { addMarks, type Marks } from "./receipts"
import { fork, run } from "./runtime"
import { noteSignInGone } from "./session"
import { Storage } from "./storage"

/** How much history to load when the page opens. */
const HISTORY = 2_000

// Member records: the newest this browser has seen per key wins, so a relay can't hand back an older,
// broader one after the owner narrowed what that member may do.
keepRecordsIn({
  get: (room, pk) => {
    try {
      return JSON.parse(localStorage.getItem(`mc.rec.${room}.${pk}`) ?? "null") as Member | null
    } catch {
      return null
    }
  },
  set: (room, pk, m) => localStorage.setItem(`mc.rec.${room}.${pk}`, JSON.stringify(m)),
})
/** Presence beacons arrive every 60s; treat 2.5 missed beats as offline. */
const PRESENCE_TTL = 150_000

/**
 * A clock the render path can read without calling `Date.now()` (the compiler
 * treats that as impure). The value moves once a second; hooks subscribe at
 * their own pace. `unref` so a test import doesn't keep the process alive.
 */
let latest = Date.now()
const clockTimer = setInterval(() => {
  latest = Date.now()
}, 1000) as unknown as { unref?: () => void }
clockTimer.unref?.()

export function clockNow(): number {
  return latest
}

/** Latest signed-in session for a channel, so the client can stay put while the token refreshes. */
const humanSessions = new Map<string, HumanSession | undefined>()

export function useClock(intervalMs: number): number {
  const subscribe = useCallback((onChange: () => void) => {
    const timer = setInterval(onChange, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return useSyncExternalStore(subscribe, clockNow)
}

export type Connection = "connecting" | "live" | "reconnecting"

export interface Online {
  client: string
  role?: string
  at: number
  /** The key that signed the announcement. */
  pk?: string
}

// ---------- the URL fragment ----------

/**
 * `#<join code>` or `#<join code>&id=<identity>`: the second form comes from
 * `kiwi web` on the owner's machine (or `--sign-in`) and carries a member key.
 * Fragments never reach the server.
 */
export function parseHash(hash: string): { code: string; identity: Identity | null } {
  const raw = hash.replace(/^#/, "")
  if (raw.startsWith("link=") || raw.startsWith("device")) return { code: "", identity: null }
  const [codePart, ...rest] = raw.split("&id=")
  let identity: Identity | null = null
  if (rest.length) {
    try {
      identity = JSON.parse(new TextDecoder().decode(fromB64url(rest.join("&id=")))) as Identity
    } catch {
      identity = null
    }
  }
  return { code: decodeURIComponent(codePart ?? "").trim(), identity }
}

export function isJoinCode(code: string): boolean {
  try {
    decodeJoinCode(code)
    return true
  } catch {
    return false
  }
}

// ---------- membership stored in this browser ----------

/** This browser's membership in one channel: who it is there, and the keys it holds. */
export interface StoredMember {
  code: string
  identity: Identity
  access: ChannelAccess
  at: number
  /** A label for the channel, known to whoever created it here. */
  name?: string
}

/** A join request this browser is waiting on. */
export interface PendingJoin {
  code: string
  identity: Identity
  requestId: string
}

const MEMBER_KEY = (code: string) => `mc.member.${code}`
const PENDING_KEY = (code: string) => `mc.pending.${code}`
const REGISTRY_KEY = "mc.channels"

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null
  } catch {
    return null
  }
}

export function loadMember(code: string): StoredMember | null {
  return read<StoredMember>(MEMBER_KEY(code))
}

export function saveMember(m: StoredMember): void {
  // This browser's key for a channel is never swapped for another one: losing an owner key
  // would leave the channel impossible to manage or close.
  const prior = loadMember(m.code)
  if (prior && prior.identity.pk !== m.identity.pk) throw new Error(`this browser is already in this channel as ${prior.identity.name}`)
  localStorage.setItem(MEMBER_KEY(m.code), JSON.stringify(m))
  localStorage.removeItem(PENDING_KEY(m.code))
  rememberChannel(m.code)
  changed()
}

export function loadPending(code: string): PendingJoin | null {
  return read<PendingJoin>(PENDING_KEY(code))
}

/** Drop a join request this browser was waiting on, and nothing else. */
export function forgetPending(code: string): void {
  localStorage.removeItem(PENDING_KEY(code))
  changed()
}

export function savePending(p: PendingJoin): void {
  localStorage.setItem(PENDING_KEY(p.code), JSON.stringify(p))
  changed()
}

/** Join requests this browser is waiting on. */
export function pendingChannels(): PendingJoin[] {
  const out: PendingJoin[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith("mc.pending.")) continue
    const p = read<PendingJoin>(k)
    if (p?.code && p.identity) out.push(p)
  }
  return out
}

/** Every channel this browser holds keys for. */
export function allMembers(): StoredMember[] {
  const out: StoredMember[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith("mc.member.")) continue
    const m = read<StoredMember>(k)
    if (m?.code && m.identity && m.access) out.push(m)
  }
  return out
}

/** Forget a channel in this browser: identity, keys, pending request, registry entry, cached history. */
export function forgetChannel(code: string): void {
  const member = loadMember(code)
  if (member) void forgetHistory(member.access.roomId, member.identity.pk).catch(() => {})
  localStorage.removeItem(MEMBER_KEY(code))
  localStorage.removeItem(PENDING_KEY(code))
  localStorage.removeItem(RECENT_KEY(code))
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(knownChannels().filter((c) => c.code !== code)))
  } catch {
    // Private mode and a full disk both refuse the write. The in-memory list still updates.
  }
  changed()
}

// ---------- what the channel list shows ----------

/** Fired whenever the list of channels, or what they last said, changes. */
export const CHANGED = "mc:channels"
function changed(): void {
  window.dispatchEvent(new Event(CHANGED))
}

const AGENT_WORKED = "mc.agent-worked"
const AGENT_WORKED_EVENT = "mc:agent-worked"

/**
 * Whether an agent has worked in a channel this browser had open (it said what it runs on, which every
 * agent does once it listens). Things worth setting up later, like the vault, wait for this.
 */
export function agentWorked(): boolean {
  try {
    return localStorage.getItem(AGENT_WORKED) === "1"
  } catch {
    return false
  }
}

export function noteAgentWorked(): void {
  if (agentWorked()) return
  try {
    localStorage.setItem(AGENT_WORKED, "1")
  } catch {
    return
  }
  window.dispatchEvent(new Event(AGENT_WORKED_EVENT))
}

/** agentWorked, as state that turns true the moment it happens. */
export function useAgentWorked(): boolean {
  const [worked, setWorked] = useState(agentWorked)
  useEffect(() => {
    if (worked) return
    const on = () => setWorked(true)
    window.addEventListener(AGENT_WORKED_EVENT, on)
    return () => window.removeEventListener(AGENT_WORKED_EVENT, on)
  }, [worked])
  return worked
}

/** The last thing said in a channel, and who's in it, as of the last time this browser had it open. */
export interface Recent {
  from: string
  text: string
  ts: number
  people: string[]
  /** The last message was the coordinator's: the list shows its head. */
  byCoordinator?: boolean
}

const RECENT_KEY = (code: string) => `mc.recent.${code}`

export function loadRecent(code: string): Recent | null {
  return read<Recent>(RECENT_KEY(code))
}

export function saveRecent(code: string, r: Recent): void {
  const next = JSON.stringify(r)
  if (localStorage.getItem(RECENT_KEY(code)) === next) return
  try {
    localStorage.setItem(RECENT_KEY(code), next)
  } catch {
    // A full disk drops the preview cache. The channel itself is unaffected.
  }
  changed()
}

/** A channel's title: its name if this browser created it, else who's in it, like a group chat. */
export function channelTitle(c: { name?: string }, recent: Recent | null): string {
  if (c.name) return c.name
  const p = recent?.people ?? []
  if (!p.length) return "New channel"
  if (p.length === 1) return p[0]!
  if (p.length <= 3) return `${p.slice(0, -1).join(", ")} & ${p[p.length - 1]}`
  return `${p.slice(0, 2).join(", ")} & ${p.length - 2} more`
}

/** How this browser relates to a channel in the list. */
export type ListState = "member" | "pending" | "elsewhere" | "agents"

export interface ChannelRow {
  code: string
  room: string
  title: string
  recent: Recent | null
  ts: number
  state: ListState
  owner: boolean
  /** Agents the signed-in person vouched for that are in it. */
  agents: number
  /** The channel's newest seq, from the signed-in listing (what marks a closed channel "new"). */
  head?: number
}

/** The signed-in listing, kept so a reload (or another tab) within LISTING_EVERY doesn't ask again. */
const LISTING_KEY = "mc.listing"
const LISTING_EVERY = 5 * 60_000
/** Sent when the person leaves a channel: a moment to refresh the list (within LISTING_EVERY). */
export const LEFT_CHANNEL = "mc:left-channel"

function readListing(): { at: number; rows: MyChannel[] } | null {
  const v = read<{ at: number; rows: MyChannel[] }>(LISTING_KEY)
  return v && typeof v.at === "number" && Array.isArray(v.rows) && v.at <= Date.now() ? v : null
}

/** Ask the relay for the signed-in listing, and keep it for the next reload (or another tab). */
const fetchListing = (token: string) =>
  Effect.gen(function* () {
    const rows = yield* relayFx.myChannels(location.origin, token)
    const storage = yield* Storage
    // A full disk asks again next time.
    yield* Effect.ignore(storage.set(LISTING_KEY, JSON.stringify({ at: Date.now(), rows })))
    return rows
  })

const untitled = (room: string) => `Channel ${room.slice(0, 4).toUpperCase()}`

/**
 * Every channel to show in the list: the ones this browser is in or waiting
 * on, plus (when signed in) every channel the person owns, is in, or has
 * agents in, from any device.
 */
export function useChannelList(signedIn: boolean, token: () => Promise<string | null>): ChannelRow[] {
  const local = useKnownChannels()
  const [pending, setPending] = useState(pendingChannels)
  const [remote, setRemote] = useState<MyChannel[]>(() => (signedIn ? (readListing()?.rows ?? []) : []))
  // Signed out: nothing remote is ours. Clearing as `signedIn` flips keeps the
  // next sign-in from flashing the previous account's channels.
  if (!signedIn && remote.length > 0) setRemote([])
  const readToken = useEffectEvent(token)

  useEffect(() => {
    const update = () => setPending(pendingChannels())
    window.addEventListener(CHANGED, update)
    return () => window.removeEventListener(CHANGED, update)
  }, [])

  useEffect(() => {
    if (!signedIn) {
      localStorage.removeItem(LISTING_KEY)
      return
    }
    let timer: number | undefined
    let cancelled = false
    // Each listing wakes every listed channel on the relay, so it's asked for on load, focus and
    // leaving a channel, never on a timer, and at most once per LISTING_EVERY (other tabs included).
    const load = async () => {
      const last = readListing()
      if (last && Date.now() - last.at < LISTING_EVERY) return
      const t = await readToken()
      if (!t || cancelled) return
      try {
        const rows = await run(fetchListing(t))
        if (!cancelled) setRemote(rows)
      } catch (err) {
        // The relay didn't answer: keep the last list. (Unless the sign-in is gone: then say so.)
        noteSignInGone(err)
      }
    }
    const soon = () => {
      clearTimeout(timer)
      timer = window.setTimeout(load, 600)
    }
    // Another tab fetched it: use theirs.
    const onStorage = (e: StorageEvent) => {
      if (e.key === LISTING_KEY) setRemote(readListing()?.rows ?? [])
    }
    void load()
    window.addEventListener("focus", soon)
    window.addEventListener(CHANGED, soon)
    window.addEventListener(LEFT_CHANNEL, soon)
    window.addEventListener("storage", onStorage)
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener("focus", soon)
      window.removeEventListener(CHANGED, soon)
      window.removeEventListener(LEFT_CHANNEL, soon)
      window.removeEventListener("storage", onStorage)
    }
  }, [signedIn])

  return useMemo(() => {
    const rows = new Map<string, ChannelRow>()
    const theirs = new Map(remote.map((r) => [r.room, r]))
    for (const c of local) {
      const m = loadMember(c.code)
      if (!m) continue
      const recent = loadRecent(c.code)
      const room = m.access.roomId
      rows.set(room, {
        code: c.code,
        room,
        title: channelTitle({ name: m.name ?? c.name }, recent),
        recent,
        ts: recent?.ts ?? c.at,
        state: "member",
        owner: m.identity.pk === m.access.ownerPk,
        agents: theirs.get(room)?.agents ?? 0,
        head: theirs.get(room)?.head,
      })
    }
    for (const p of pending) {
      let room: string
      try {
        room = decodeJoinCode(p.code).roomId
      } catch {
        continue
      }
      if (rows.has(room)) continue
      rows.set(room, { code: p.code, room, title: untitled(room), recent: null, ts: clockNow(), state: "pending", owner: false, agents: 0 })
    }
    for (const r of remote) {
      if (rows.has(r.room)) continue
      rows.set(r.room, {
        code: r.code,
        room: r.room,
        title: untitled(r.room),
        recent: null,
        ts: r.at,
        state: r.owner || r.member ? "elsewhere" : "agents",
        owner: r.owner,
        agents: r.agents,
        head: r.head,
      })
    }
    return [...rows.values()].sort((a, b) => b.ts - a.ts)
  }, [local, pending, remote])
}

/** The channels this browser is in, kept current as they change. */
export function useKnownChannels(): KnownChannel[] {
  const [list, setList] = useState(knownChannels)
  useEffect(() => {
    const update = () => setList(knownChannels())
    window.addEventListener(CHANGED, update)
    window.addEventListener("storage", update)
    return () => {
      window.removeEventListener(CHANGED, update)
      window.removeEventListener("storage", update)
    }
  }, [])
  return list
}

export interface KnownChannel {
  code: string
  at: number
  name?: string
}

/** Channels this browser is a member of, newest first. */
export function knownChannels(): KnownChannel[] {
  const raw = read<KnownChannel[]>(REGISTRY_KEY)
  return Array.isArray(raw) ? raw.filter((c) => c && typeof c.code === "string" && loadMember(c.code)) : []
}

function rememberChannel(code: string): void {
  const name = loadMember(code)?.name
  const next = [{ code, at: Date.now(), ...(name ? { name } : {}) }, ...knownChannels().filter((c) => c.code !== code)].slice(0, 200)
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(next))
  } catch {
    // Private mode and a full disk both refuse the write. The channel is still open in this tab.
  }
}

/**
 * Become a member from a link that carries a member key (the owner's, from
 * `kiwi web`): fetch and unwrap this key's channel keys.
 */
export async function memberFromLink(code: string, identity: Identity): Promise<StoredMember> {
  const { roomId, ownerFp } = decodeJoinCode(code)
  const prior = loadMember(code)
  if (prior) {
    if (prior.identity.pk === identity.pk) return prior
    throw new Error(`This browser is already in this channel as ${prior.identity.name}. A link can’t replace that key.`)
  }
  const id = await withExchangeKey(identity)
  const probe = new Channel({ roomId, ownerPk: "", ownerXpk: "", epoch: 0, keys: {} }, location.origin, id)
  const info = await probe.info(ownerFp)
  // The link's channel must be the one the code names: same owner, properly signed.
  if ((await ownerFingerprint(info.ownerPk)) !== ownerFp) throw new Error("The relay is serving a different owner than this code names.")
  const statement = await ownerStatement(roomId, info)
  if (!statement) throw new Error("This channel’s owner keys aren’t signed.")
  const ch = new Channel({ roomId, ownerPk: info.ownerPk, ownerXpk: info.ownerXpk, epoch: info.epoch, keys: {}, signedKeys: statement === "signed-keys" }, location.origin, id)
  try {
    await ch.refreshKeys()
  } catch {
    // Never let a bad link touch what this browser already holds.
    throw new Error("The key in this link isn’t a member of this channel.")
  }
  const m: StoredMember = { code, identity: id, access: ch.access, at: Date.now() }
  saveMember(m)
  return m
}

/**
 * Create a channel owned by this browser's human. The owner key is generated
 * here and leaves only for the same person's other devices (lib/devices.ts);
 * on relays that require sign-in, `token` proves who the human is.
 */
/** A signed-in person, as the browser knows them from AuthKit. */
export interface Person {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
}

export function personName(p: Person): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email
}

export async function createChannel(name: string, token: string | null, me: Person | null): Promise<StoredMember> {
  const roomId = newRoomId()
  // The owner appears under their real name, not as "human".
  const handle = me ? handleFor(personName(me), me.email) : "human"
  const owner = await generateIdentity(handle)
  const info = me
    ? { name: handle, role: "owner", kind: "human" as const, display: personName(me), sponsor: { user: me.id, name: personName(me), handle } }
    : { name: "human", role: "owner" }
  const { code, access } = await Channel.create(location.origin, owner, info, [], roomId, token, name)
  const m: StoredMember = { code, identity: owner, access, at: Date.now(), name }
  saveMember(m)
  // A new channel starts in coordinator mode: people talk with the coordinator, agents in their tasks'
  // conversations. Best effort: the channel is made either way, and the owner can turn it on later.
  await new Channel(access, location.origin, owner, (a) => saveMember({ ...m, access: a }), async () => token)
    .startCoordinated()
    .catch(() => {})
  return m
}

/**
 * What an invite can say before you join: who owns the channel, as the relay knows them from sign-in.
 * The channel's name stays sealed until you're in. Null: the channel doesn't exist (anymore).
 */
export async function inviteInfo(code: string): Promise<{ ownerName: string | null } | null> {
  const { roomId, ownerFp } = decodeJoinCode(code)
  const res = await fetch(`${location.origin}/v1/rooms/${roomId}/info?fp=${encodeURIComponent(ownerFp)}`)
  const body = (await res.json().catch(() => ({}))) as { ownerPk: string; ownerName?: string | null; error?: string; tag?: string }
  if (!res.ok) {
    const err = new RelayError(res.status, body.error ?? `the relay returned ${res.status}`, body.tag)
    // Closed, or never was: both are "this code leads nowhere".
    if (err.tag === "ChannelGone") return null
    throw err
  }
  const info = body
  // Only name the owner the code itself names.
  if ((await ownerFingerprint(info.ownerPk)) !== ownerFp) throw new Error("The relay is serving a different owner than this code names.")
  return { ownerName: info.ownerName ?? null }
}

/** Ask to join from this browser (as a signed-in person); resumes an earlier request for the same code. */
export async function askToJoin(code: string, name: string, role?: string, token?: string | null): Promise<PendingJoin> {
  const prior = loadPending(code)
  const identity = prior && prior.identity.name === name ? prior.identity : await generateIdentity(name)
  const r = await Channel.requestJoin(location.origin, code, identity, { name, ...(role ? { role } : {}) }, token)
  const p: PendingJoin = { code, identity, requestId: r.requestId }
  savePending(p)
  return p
}

/** Where a request stands: still pending (with its code once the owner has opened it), declined, or in. */
export async function checkJoin(p: PendingJoin): Promise<{ code: string | null } | "denied" | StoredMember> {
  const st = await Channel.joinStatus(location.origin, p.code, p.identity, p.requestId)
  if (st.status === "denied") return "denied"
  if (st.status === "pending") return { code: st.code }
  // The owner may have admitted this person under a handle from their account: speak under that one.
  const record = (await new Channel(st.access, location.origin, p.identity).members().catch(() => [])).find((x) => x.pk === p.identity.pk)
  const identity = record && record.name !== p.identity.name ? { ...p.identity, name: record.name } : p.identity
  const m: StoredMember = { code: p.code, identity, access: st.access, at: Date.now() }
  saveMember(m)
  return m
}

/** The join checks this browser signed as a channel's owner (see sas.ts). */
const browserBudget: SigningBudget = {
  load: (roomId) => {
    const t = read<unknown>(`mc.checks.${roomId}`)
    return Array.isArray(t) ? (t as Signed[]) : []
  },
  save: (roomId, signed) => {
    try {
      localStorage.setItem(`mc.checks.${roomId}`, JSON.stringify(signed))
    } catch {
      // Remembering the budget is a convenience. Signing still works without it.
    }
  },
}

// ---------- the live channel ----------

export interface ChannelHandle {
  ch: Channel
  connection: Connection
  /** Set when this browser was removed or the owner closed the channel. */
  gone: "removed" | "closed" | null
  messages: Message[]
  roster: Member[]
  state: ChannelState
  online: Map<string, Online>
  isOwner: boolean
  requests: JoinRequest[]
  send: (body: string, opts: SendOptions) => Promise<number>
  refreshRequests: () => Promise<void>
  refreshRoster: () => Promise<void>
  /** The channel's newest seq when this view opened (0 until the relay says). */
  head: number
  /** How far each member's key has read, as this view heard it (receipts.ts). */
  marks: Marks
  /** A current member's key, by name. */
  pkOf: (name: string) => string | undefined
}

/** What a channel view does with each step of opening and following a channel. */
interface Viewer {
  /** Read the member list and the join requests (each handles its own failure). */
  refresh: Effect.Effect<void, never, Relay>
  /** Messages from this browser's sealed cache, to paint before the relay answers. */
  cached: (messages: Message[]) => void
  /** Where this view starts: the relay's head, and whether the whole log fits in what it loads. */
  started: (start: { head: number; whole: boolean }) => void
  /** What the channel says live (ch.fx.live), in order. */
  live: (ev: Live) => Effect.Effect<void>
  /** A line about the connection (an outage, a dropped frame). */
  status: (line: string) => Effect.Effect<void>
}

/**
 * Open a channel and follow it: the member list and requests, then the sealed
 * cache, then the relay's Stream from where the cache ends, for as long as it
 * runs. It ends only by failing (ChannelGone: this member is out) or being
 * interrupted, which closes the socket.
 */
const follow = (ch: Channel, view: Viewer) =>
  Effect.gen(function* () {
    yield* view.refresh
    const head = yield* ch.fx.head()
    // Paint the sealed cache, then ask the relay only for seqs after it.
    // Anything unusable (private mode, a broken cache) falls back to the usual window.
    const cached = yield* Effect.promise(() => readCached(ch.roomId, ch.identity.pk, ch.access.keys, head, HISTORY).catch(() => null))
    const since = cached ? cached.since : Math.max(0, head - HISTORY)
    const firstSeq = cached?.messages[0]?.seq
    if (cached?.messages.length) view.cached(cached.messages)
    view.started({ head, whole: wholeLog(head, HISTORY, firstSeq) })
    yield* eachLive(ch.fx.live(since, { presence: true }), view.live, view.status)
  })

/** Merge messages into a view's list: each seq once, in order. */
const merged = (prev: Message[], more: Message[]) => {
  const seen = new Set(prev.map((p) => p.seq))
  return [...prev, ...more.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq)
}

/**
 * Stream a channel as a member: messages, presence, member list, and (for the owner) join requests.
 * Pass `null` while sign-in is still loading. Opening before that sends the owner's request list
 * with no session, the relay answers 401, and this browser signs itself out.
 */
export function useChannel(member: StoredMember, human?: HumanSession | null): ChannelHandle {
  useEffect(() => {
    if (human === null) return
    humanSessions.set(member.code, human)
    return () => {
      if (humanSessions.get(member.code) === human) humanSessions.delete(member.code)
    }
  }, [human, member.code])
  const ch = useMemo(
    () =>
      new Channel(
        member.access,
        location.origin,
        member.identity,
        (access) => saveMember({ ...(loadMember(member.code) ?? member), access }),
        async () => {
          const session = humanSessions.get(member.code)
          return session ? await session() : null
        }
      ),
    [member]
  )
  const [connection, setConnection] = useState<Connection>("connecting")
  /** The head when this view started, and whether the whole log fits in what it loads. */
  const [start, setStart] = useState<{ head: number; whole: boolean } | null>(null)
  const [gone, setGone] = useState<"removed" | "closed" | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [roster, setRoster] = useState<Member[]>([])
  const [online, setOnline] = useState<Map<string, Online>>(new Map())
  const [marks, setMarks] = useState<Marks>(new Map())
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const now = useClock(15_000)
  const isOwner = ch.isOwner

  // Members can read the channel's sealed name; remember it for the channel list. Read it again
  // whenever the relay says the channel's info changed, so a rename reaches every member.
  const [infoAt, setInfoAt] = useState(0)
  useEffect(() => {
    void run(ch.fx.title())
      .then((name) => {
        const stored = loadMember(member.code)
        if (name && stored && stored.name !== name) saveMember({ ...stored, name })
      })
      .catch(() => {})
  }, [ch, member.code, infoAt])

  // The channel's mode as the owner signed it: this view holds only the log's tail, and the mode.set
  // may be older than that. Read again whenever the info changes, like the name.
  const [modeFloor, setModeFloor] = useState<ModeSetting | null>(null)
  useEffect(() => {
    void run(ch.fx.mode()).then(setModeFloor, () => {})
  }, [ch, infoAt])
  // The charter and the hold the same way: a hold set before this view's tail still stops every agent.
  const [guardFloor, setGuardFloor] = useState<GuardFloor | null>(null)
  useEffect(() => {
    void run(ch.fx.guard()).then(setGuardFloor, () => {})
  }, [ch, infoAt])
  // The rooms the same way: a room.create older than this view's tail is still a room here.
  const [roomsFloor, setRoomsFloor] = useState<RoomsSetting | null>(null)
  useEffect(() => {
    void run(ch.fx.rooms()).then(setRoomsFloor, () => {})
  }, [ch, infoAt])

  const onGone = useCallback(
    (err: unknown) => {
      noteSignInGone(err)
      if (!(err instanceof ChannelGone)) return false
      forgetChannel(member.code)
      setGone(err.why)
      return true
    },
    [member.code]
  )

  /** A step that failed is reported to onGone; one that was stopped (the view closed) isn't. */
  const orGone = useCallback(
    <A, E, R>(step: Effect.Effect<A, E, R>) => step.pipe(Effect.asVoid, Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => void onGone(Cause.squash(cause)))))),
    [onGone]
  )

  const rosterStep = useMemo(
    () =>
      orGone(
        Effect.gen(function* () {
          // A linked computer's seat only lets its agents in: it isn't someone in this channel's lists.
          const people = (all: Member[]) => all.filter((m) => m.kind !== "computer")
          setRoster(people(yield* ch.fx.members()))
          if (ch.isOwner && (yield* ch.fx.rotateIfDue())) setRoster(people(yield* ch.fx.members()))
        })
      ),
    [ch, orGone]
  )
  const requestsStep = useMemo(
    () =>
      orGone(
        Effect.gen(function* () {
          if (!ch.isOwner) return
          setRequests(yield* ch.fx.requests({ budget: browserBudget }))
        })
      ),
    [ch, orGone]
  )
  const refreshRoster = useCallback(() => run(rosterStep), [rosterStep])
  const refreshRequests = useCallback(() => run(requestsStep), [requestsStep])

  // The channel, followed while this view is open: one subscription to its Stream, stopped on close.
  useEffect(() => {
    if (human === null) return
    // Batch incoming messages so a history replay renders once, not thousands of times.
    let pending: Message[] = []
    let flush: number | undefined
    const enqueue = (m: Message) => {
      pending.push(m)
      flush ??= window.setTimeout(() => {
        const batch = pending
        pending = []
        flush = undefined
        setMessages((prev) => merged(prev, batch))
        if (batch.some((m) => m.kind === "event" && m.ev?.op === "card")) noteAgentWorked()
        // Seal after paint. A cache failure must not stop the stream.
        const key = ch.access.keys[String(ch.access.epoch)]
        if (key) {
          for (const m of batch) void rememberMessage(ch.roomId, ch.identity.pk, ch.access.epoch, key, m, HISTORY).catch(() => {})
        }
      }, 30)
    }
    const live = (ev: Live): Effect.Effect<void> =>
      Effect.sync(() => {
        switch (ev._tag) {
          case "Open":
            setConnection("live")
            // Anything that happened while the stream was closed (its first open included) sent its frame
            // to nobody: a join request in that gap would sit unseen. Read both again now that it's open.
            void refreshRequests()
            void refreshRoster()
            // Ask every listening agent to announce itself right away.
            void Effect.runFork(ev.presence({ client: "probe", query: true }))
            return
          case "Message":
            return enqueue(ev.message)
          case "Presence": {
            const p = ev.presence
            if (p.client === "probe" || !p.sigOk) return
            setOnline((prev) => new Map(prev).set(p.from, { client: p.client, role: p.role, at: Date.now(), pk: p.pk }))
            return
          }
          case "Roster":
            return void refreshRoster()
          case "Request":
            return void refreshRequests()
          case "Read":
            setMarks((prev) => addMarks(prev, ev.reads, ev.snapshot))
            return
          case "Info":
            setInfoAt(Date.now())
            window.dispatchEvent(new CustomEvent(ICON_LIVE, { detail: member.code }))
            return
        }
      })
    const stop = fork(
      orGone(
        follow(ch, {
          refresh: Effect.all([rosterStep, requestsStep], { concurrency: "unbounded", discard: true }),
          cached: (cached) => {
            setMessages((prev) => merged(prev, cached))
            if (cached.some((m) => m.kind === "event" && m.ev?.op === "card")) noteAgentWorked()
          },
          started: setStart,
          live,
          status: () => Effect.sync(() => setConnection("reconnecting")),
        })
      )
    )
    return () => {
      stop()
      clearTimeout(flush)
    }
  }, [ch, rosterStep, requestsStep, refreshRoster, refreshRequests, orGone, human, member.code])

  // Presence can only be trusted when it's signed by the key the owner admitted under that name.
  const keyOf = useMemo(() => new Map(roster.filter((r) => r.active).map((r) => [r.name, r.pk])), [roster])
  const rosterForFold: Roster = useMemo(
    () =>
      roster.map((m) => ({
        name: m.name,
        pk: m.pk,
        role: m.role,
        about: m.about,
        owner: m.owner,
        at: m.at,
        active: m.active,
        kind: m.kind,
        display: m.display,
        sponsor: m.sponsor,
        ...(m.scopes ? { scopes: m.scopes } : {}),
        ...(m.later ? { later: m.later } : {}),
        ...(m.laterRole ? { laterRole: m.laterRole } : {}),
        ...(m.runs ? { runs: m.runs } : {}),
      })),
    [roster]
  )
  const state = useMemo(() => fold(messages, rosterForFold, now, modeFloor, roomsFloor, guardFloor), [messages, rosterForFold, now, modeFloor, roomsFloor, guardFloor])

  // Owner: the relay's "can post" bit follows the scopes in the log, put right whenever either side
  // changes (a scope.set whose second step failed, here or on another device). Only with the whole
  // log loaded: a window that misses an old scope.set would read that member as allowed everything.
  const scopesKey = useMemo(() => [...state.members.values()].map((m) => `${m.pk}:${m.scopes.join(",")}`).join("|"), [state])
  const bitsKey = useMemo(() => roster.map((m) => `${m.pk}:${m.readOnly ? 0 : 1}`).join("|"), [roster])
  // The whole log, replayed up to where it stood when this view opened.
  const caughtUp = !!start?.whole && (messages.at(-1)?.seq ?? 0) >= start.head
  const reconcile = useEffectEvent(() => {
    if (!ch.isOwner || !caughtUp || roster.length === 0) return
    run(ch.fx.reconcilePosting(state, roster)).then(
      (changed) => {
        if (changed.length) void refreshRoster()
      },
      () => {}
    )
  })
  useEffect(() => reconcile(), [scopesKey, bitsKey, caughtUp])
  // Online only if signed by the very key the owner admitted under that name.
  const live = useMemo(() => new Map([...online].filter(([name, o]) => !!o.pk && keyOf.get(name) === o.pk && now - o.at < PRESENCE_TTL)), [online, keyOf, now])

  const chRef = useRef(ch)
  useEffect(() => {
    chRef.current = ch
  }, [ch])
  const send = useCallback(
    (body: string, opts: SendOptions) =>
      run(chRef.current.fx.send(body, opts)).catch((err: unknown) => {
        if (onGone(err)) throw new Error("you no longer have access to this channel", { cause: err })
        throw err
      }),
    [onGone]
  )

  const pkOf = useCallback((name: string) => keyOf.get(name), [keyOf])

  return { ch, connection, gone, messages, roster, state, online: live, isOwner, requests, send, refreshRequests, refreshRoster, head: start?.head ?? 0, marks, pkOf }
}

