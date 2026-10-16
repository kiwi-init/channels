import { relayUrl } from "./relay"
import * as Effect from "effect/Effect"
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react"

import type { CachedRow } from "@mc/cache-row.ts"
import { ChannelGone, RelayError, type HumanSession, type ModeSetting, type RoomsSetting, type SendOptions } from "@mc/client.ts"
import { decodeJoinCode, ownerFingerprint } from "@mc/crypto.ts"
import type { JoinRequest, Member } from "@mc/membership.ts"
import { SNAPSHOT_EVERY, type Message } from "@mc/protocol.ts"
import { fold, type ChannelState, type GuardFloor, type Roster } from "@mc/state.ts"
import type { Activity } from "@mc/protocol.ts"
import type { PublicAccess } from "../../../desktop/src/bridge.ts"
import { errorOf, linkOf, ops, type ChannelLink, type FollowEvent } from "./channel-ops"
import { forgetHistory, readCached, rememberRow } from "./history"
import { migrateLegacy } from "./legacy-seats"
import { wholeLog } from "./history-plan"
import { ICON_LIVE } from "./icon-event"
import { addMarks, type Marks } from "./receipts"
import { fork } from "./runtime"
import { migrateChannels, saveChannels, secrets, useSecrets, type ChannelView } from "./secrets"
import { noteSignInGone } from "./session"
import { untilOpen } from "./until-open"
import { withHeads } from "./news"

/** How much history to load when the page opens. */
const HISTORY = 2_000

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

export function useClock(intervalMs: number): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const timer = setInterval(onChange, intervalMs)
      return () => clearInterval(timer)
    },
    [intervalMs]
  )
  return useSyncExternalStore(subscribe, clockNow)
}

type Connection = "connecting" | "live" | "reconnecting"

interface Online {
  client: string
  role?: string
  at: number
  /** The key that signed the announcement. */
  pk?: string
  /** What the agent is doing right now, as its harness tells its listener (working, waiting, idle). */
  activity?: Activity
}

// ---------- the URL fragment ----------

/** `#<join code>`: the channel to open. Fragments never reach the server. */
export function parseHash(hash: string): { code: string } {
  return { code: decodeURIComponent(hash.replace(/^#/, "")).trim() }
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

export interface StoredMember {
  code: string
  identity: { name: string; pk: string }
  access: PublicAccess
  at: number
  name?: string
}

export interface PendingJoin {
  code: string
  identity: { name: string; pk: string }
  requestId: string
}

const MEMBER_KEY = (code: string) => `mc.member.${code}`
const PENDING_KEY = (code: string) => `mc.pending.${code}`

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null
  } catch {
    return null
  }
}

const asMember = (e: ChannelView): StoredMember | null =>
  e.code && e.access ? { code: e.code, identity: { name: e.idName ?? e.label, pk: e.pk }, access: e.access, at: e.at ?? 0, ...(e.name ? { name: e.name } : {}) } : null
const asPending = (e: ChannelView): PendingJoin | null => (e.code && !e.access && e.requestId ? { code: e.code, identity: { name: e.idName ?? e.label, pk: e.pk }, requestId: e.requestId } : null)
const entries = (): ChannelView[] => secrets().channels

export async function migrateChannelsToStore(): Promise<number> {
  const n = await migrateLegacy(localStorage, migrateChannels)
  if (n) changed()
  return n
}

export function loadMember(code: string): StoredMember | null {
  const e = entries().find((x) => x.code === code && x.access)
  return e ? asMember(e) : null
}

export function renameChannel(code: string, name: string): Promise<void> {
  const done = saveChannels(entries().map((e) => (e.code === code && e.access ? { ...e, label: name, name } : e)))
  changed()
  return done
}

export function loadPending(code: string): PendingJoin | null {
  const e = entries().find((x) => x.code === code && !x.access)
  return e ? asPending(e) : null
}

export async function forgetPending(code: string): Promise<void> {
  if (loadMember(code)) return
  await ops().forget(code)
  changed()
}

function pendingChannels(): PendingJoin[] {
  return entries().flatMap((e) => asPending(e) ?? [])
}

export function allMembers(): StoredMember[] {
  return entries().flatMap((e) => asMember(e) ?? [])
}

export async function forgetChannel(code: string): Promise<void> {
  const member = loadMember(code)
  if (member) void forgetHistory(member.access.roomId, member.identity.pk).catch(() => {})
  localStorage.removeItem(MEMBER_KEY(code))
  localStorage.removeItem(PENDING_KEY(code))
  localStorage.removeItem(RECENT_KEY(code))
  changed()
  await ops().forget(code)
  changed()
}

// ---------- what the channel list shows ----------

/** Fired whenever the list of channels, or what they last said, changes. */
const CHANGED = "mc:channels"
function changed(): void {
  window.dispatchEvent(new Event(CHANGED))
}

const AGENT_WORKED = "mc.agent-worked"
const AGENT_WORKED_EVENT = "mc:agent-worked"

/**
 * Whether an agent has worked in a channel this browser had open (it said what it runs on, which every
 * agent does once it listens). Things worth setting up later, like the vault, wait for this.
 */
function agentWorked(): boolean {
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
type ListState = "member" | "pending" | "agents"

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

/** How often listed channels are asked for their head (GET /). Cheap: seq only. */
const HEADS_EVERY = 15_000

const untitled = (room: string) => `Channel ${room.slice(0, 4).toUpperCase()}`

/** Every channel to show in the list: the ones this app is in or waiting on. */
export function useChannelList(): ChannelRow[] {
  const local = useKnownChannels()
  const [pending, setPending] = useState(pendingChannels)

  useEffect(() => {
    const update = () => setPending(pendingChannels())
    window.addEventListener(CHANGED, update)
    return () => window.removeEventListener(CHANGED, update)
  }, [])

  const rows = useMemo(() => {
    const rows = new Map<string, ChannelRow>()
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
        agents: 0,
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
    return [...rows.values()].sort((a, b) => b.ts - a.ts)
  }, [local, pending])

  const [heads, setHeads] = useState<Record<string, number>>({})
  const memberKey = rows
    .filter((r) => r.state === "member")
    .map((r) => `${r.room}\t${r.code}`)
    .sort()
    .join("\n")
  useEffect(() => {
    if (!memberKey) return
    const members = memberKey.split("\n").map((s) => {
      const i = s.indexOf("\t")
      return { room: s.slice(0, i), code: s.slice(i + 1) }
    })
    let stop = false
    let gen = 0
    const tick = async () => {
      const my = ++gen
      const next: Record<string, number> = {}
      await Promise.all(
        members.map(async ({ room, code }) => {
          if (!loadMember(code)) return
          try {
            next[room] = await ops().call(code, "head")
          } catch {
            // Closed or unreachable: keep the last head we have.
          }
        })
      )
      if (stop || my !== gen) return
      setHeads((prev) => {
        const merged = { ...prev, ...next }
        const keys = Object.keys(merged)
        if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === merged[k])) return prev
        return merged
      })
    }
    void tick()
    const id = setInterval(tick, HEADS_EVERY)
    const onVis = () => {
      if (!document.hidden) void tick()
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      stop = true
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [memberKey])

  return useMemo(() => withHeads(rows, heads), [rows, heads])
}

/** The channels this browser is in, kept current as they change. */
export function useKnownChannels(): KnownChannel[] {
  useSecrets()
  const [, setTick] = useState(0)
  useEffect(() => {
    const update = () => setTick((n) => n + 1)
    window.addEventListener(CHANGED, update)
    window.addEventListener("storage", update)
    return () => {
      window.removeEventListener(CHANGED, update)
      window.removeEventListener("storage", update)
    }
  }, [])
  return knownChannels()
}

export interface KnownChannel {
  code: string
  at: number
  name?: string
}

/** Channels this browser is a member of, newest first. The keys, not a separate index. */
function knownChannels(): KnownChannel[] {
  return allMembers()
    .map((m) => ({ code: m.code, at: m.at, ...(m.name ? { name: m.name } : {}) }))
    .sort((a, b) => b.at - a.at)
}

function memberOf(v: ChannelView): StoredMember {
  const m = asMember(v)
  if (!m) throw new Error("the channel came back without its access")
  return m
}

export async function createChannel(name: string, token: string | null, me: { name: string } | null): Promise<StoredMember> {
  const m = memberOf(await ops().create(name, token, me))
  changed()
  return m
}

/**
 * What an invite can say before you join: who owns the channel, as the relay knows them from sign-in.
 * The channel's name stays sealed until you're in. Null: the channel doesn't exist (anymore).
 */
export async function inviteInfo(code: string): Promise<{ ownerName: string | null } | null> {
  const { roomId, ownerFp } = decodeJoinCode(code)
  const res = await fetch(`${relayUrl()}/v1/rooms/${roomId}/info?fp=${encodeURIComponent(ownerFp)}`)
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

export async function askToJoin(code: string, name: string, role?: string): Promise<PendingJoin> {
  const p = asPending(await ops().requestJoin(code, name, role))
  if (!p) throw new Error("the join request came back without its id")
  changed()
  return p
}

export async function checkJoin(p: PendingJoin): Promise<{ code: string | null } | "denied" | StoredMember> {
  const r = await ops().joinStatus(p.code)
  if (r.status === "denied") return "denied"
  if (r.status === "pending") return { code: r.code }
  changed()
  return memberOf(r.channel)
}

// ---------- the live channel ----------

export interface ChannelHandle {
  ch: ChannelLink
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
  const ch = useMemo(() => linkOf(member), [member])
  const [connection, setConnection] = useState<Connection>("connecting")
  const [start, setStart] = useState<{ head: number; whole: boolean } | null>(null)
  const [gone, setGone] = useState<"removed" | "closed" | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [roster, setRoster] = useState<Member[]>([])
  const [online, setOnline] = useState<Map<string, Online>>(new Map())
  const [marks, setMarks] = useState<Marks>(new Map())
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const now = useClock(15_000)
  const isOwner = ch.isOwner

  const [infoAt, setInfoAt] = useState(0)
  useEffect(() => {
    void ch
      .title()
      .then((name) => {
        const stored = loadMember(member.code)
        if (name && stored && stored.name !== name) void renameChannel(member.code, name)
      })
      .catch(() => {})
  }, [ch, member.code, infoAt])

  const [modeFloor, setModeFloor] = useState<ModeSetting | null>(null)
  useEffect(() => {
    void ch.mode().then(setModeFloor, () => {})
  }, [ch, infoAt])
  const [guardFloor, setGuardFloor] = useState<GuardFloor | null>(null)
  useEffect(() => {
    void ch.guard().then(setGuardFloor, () => {})
  }, [ch, infoAt])
  const [roomsFloor, setRoomsFloor] = useState<RoomsSetting | null>(null)
  useEffect(() => {
    void ch.rooms().then(setRoomsFloor, () => {})
  }, [ch, infoAt])

  const onGone = useCallback(
    (err: unknown) => {
      noteSignInGone(err)
      if (!(err instanceof ChannelGone)) return false
      void forgetChannel(member.code)
      setGone(err.why)
      return true
    },
    [member.code]
  )

  const refreshRoster = useCallback(async () => {
    try {
      setRoster(await ch.members())
      if (ch.isOwner && (await ch.rotateIfDue())) setRoster(await ch.members())
    } catch (err) {
      onGone(err)
    }
  }, [ch, onGone])
  const refreshRequests = useCallback(async () => {
    if (!ch.isOwner) return
    try {
      setRequests(await ch.requests())
    } catch (err) {
      onGone(err)
    }
  }, [ch, onGone])

  useEffect(() => {
    if (human === null) return
    let pending: { message: Message; row: CachedRow | null }[] = []
    let flush: number | undefined
    let stopLive: (() => void) | null = null
    let closed = false
    const enqueue = (message: Message, row: CachedRow | null) => {
      pending.push({ message, row })
      flush ??= window.setTimeout(() => {
        const batch = pending
        pending = []
        flush = undefined
        setMessages((prev) =>
          merged(
            prev,
            batch.map((b) => b.message)
          )
        )
        if (batch.some((b) => b.message.kind === "event" && b.message.ev?.op === "card")) noteAgentWorked()
        for (const b of batch) if (b.row) void rememberRow(ch.roomId, ch.pk, b.row, HISTORY).catch(() => {})
      }, 30)
    }
    const onEvent = (ev: FollowEvent) => {
      switch (ev._tag) {
        case "Open":
          setConnection("live")
          void refreshRequests()
          void refreshRoster()
          void ch.presence({ client: "probe", query: true }).catch(() => {})
          return
        case "Message":
          return enqueue(ev.message, ev.row)
        case "Presence": {
          const p = ev.presence
          if (p.client === "probe" || !p.sigOk) return
          setOnline((prev) => new Map(prev).set(p.from, { client: p.client, role: p.role, at: Date.now(), pk: p.pk, ...(p.activity ? { activity: p.activity } : {}) }))
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
        case "Status":
          setConnection("reconnecting")
          return
        case "Failed":
          if (!onGone(errorOf(ev.error))) setConnection("reconnecting")
          return
      }
    }
    const opening = untilOpen(
      Effect.tryPromise({
        try: async () => {
          await Promise.all([refreshRoster(), refreshRequests()])
          const head = await ch.head()
          const cached = await readCached(ch.roomId, ch.pk, ch.openRows, head, HISTORY).catch(() => null)
          const since = cached ? cached.since : Math.max(0, head - HISTORY)
          return { head, cached, since, firstSeq: cached?.messages[0]?.seq }
        },
        catch: (err) => err,
      }),
      () => Effect.sync(() => setConnection("reconnecting"))
    )
    const stop = fork(
      opening.pipe(
        Effect.flatMap((opened) =>
          Effect.sync(() => {
            if (closed) return
            if (opened.cached?.messages.length) {
              const cached = opened.cached.messages
              setMessages((prev) => merged(prev, cached))
              if (cached.some((m) => m.kind === "event" && m.ev?.op === "card")) noteAgentWorked()
            }
            setStart({ head: opened.head, whole: wholeLog(opened.head, HISTORY, opened.firstSeq) })
            stopLive = ch.follow(opened.since, onEvent)
          })
        ),
        Effect.catch((err) => Effect.sync(() => void onGone(err)))
      )
    )
    return () => {
      closed = true
      stop()
      stopLive?.()
      clearTimeout(flush)
    }
  }, [ch, refreshRoster, refreshRequests, onGone, human, member.code])

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
    ch.reconcilePosting(state, roster).then(
      (changed) => {
        if (changed.length) void refreshRoster()
      },
      () => {}
    )
  })
  useEffect(() => reconcile(), [scopesKey, bitsKey, caughtUp])
  const snapshotStep = ch.isOwner ? Math.floor(state.head / SNAPSHOT_EVERY) : 0
  useEffect(() => {
    if (snapshotStep > 0) ch.snapshotIfDue().catch(() => {})
  }, [ch, snapshotStep])
  // Online only if signed by the very key the owner admitted under that name.
  const live = useMemo(() => new Map([...online].filter(([name, o]) => !!o.pk && keyOf.get(name) === o.pk && now - o.at < PRESENCE_TTL)), [online, keyOf, now])

  const chRef = useRef(ch)
  useEffect(() => {
    chRef.current = ch
  }, [ch])
  const send = useCallback(
    (body: string, opts: SendOptions) =>
      chRef.current.send(body, opts).catch((err: unknown) => {
        if (onGone(err)) throw new Error("you no longer have access to this channel", { cause: err })
        throw err
      }),
    [onGone]
  )

  const pkOf = useCallback((name: string) => keyOf.get(name), [keyOf])

  return { ch, connection, gone, messages, roster, state, online: live, isOwner, requests, send, refreshRequests, refreshRoster, head: start?.head ?? 0, marks, pkOf }
}
