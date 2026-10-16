import { ArrowDown01Icon, ArrowLeft01Icon, CheckListIcon, Search01Icon } from "@hugeicons/core-free-icons"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"

import { droppedCount } from "@mc/format.ts"
import { memberLoad } from "@mc/load.ts"
import { ignored, isReaction, type Color, type ImageAttachment, type Message } from "@mc/protocol.ts"
import { describeScopes, wireScopes } from "@mc/scopes.ts"
import { colorOf, keptFromPeople, openRound, taskId, type Task } from "@mc/state.ts"
import { recentPrs } from "@mc/work.ts"
import { secrets } from "@/lib/secrets"
import { channelTitle, forgetChannel, loadMember, loadRecent, renameChannel, saveRecent, useChannel, useClock, useKnownChannels, type StoredMember } from "@/lib/channel"
import { howHere } from "@/lib/presence"
import { lastPreview } from "@/lib/preview"
import { markSeen, setOpenNews } from "@/lib/news"
import { useIcons, useLiveIcon } from "@/lib/icons"
import { excerpt, formatShort, formatTime, memberName } from "@/lib/format"
import { coordinatorMood, ERROR_MS, moodInputs, SPEAKING_MS, type Mood } from "@/lib/coordinator-mood"
import { chipsFor } from "@/lib/reactions"
import { receipt } from "@/lib/receipts"
import { dmPlace, markSeenIn, MAIN, placeFromKey, placeKey, seenIn, sendFrom, useSeen, threadMembers, type Place, type PlaceSummary } from "@/lib/threads"
import { cx } from "@/lib/utils"
import { CoordinatorAvatar } from "./coordinator-head"
import { Composer } from "./composer"
import { AddAgent } from "./add-agent"
import { AgentStrip, type AgentNow } from "./agent-strip"
import { ChannelControls, HoldBanner, HoldDialog } from "./controls"
import { Icon } from "./icon"
import { Button, IconButton, Spinner } from "./kit"
import { Bubble, EventGroup, EventRow, TimeMark, isAgent, standsAlone, type ThreadSummary } from "./message"
import { NeedsYou } from "./needs-you"
import { FLOAT_GAP, FLOAT_W, Overview } from "./side-panel"
import { Notes, Tasks } from "./tasks"
import { Annotator, InfoPanel, TaskDetails, TasksPanel, ThreadPanel } from "./lazy"

/** Messages this close together from one sender read as one run. */
const RUN_GAP = 5 * 60_000

function useNow(intervalMs = 30_000): number {
  return useClock(intervalMs)
}

/**
 * What's new in the open channel, for the channel list and the tab: what arrived while the tab was
 * in the background, or in a room not in view. While it's in view the channel is read up to `top`.
 */
function useChannelNews(room: string, top: number, arrivals: number, inOtherRooms: number, needs: number) {
  const [mark, setMark] = useState(arrivals)
  const [hidden, setHidden] = useState(() => document.hidden)
  useEffect(() => {
    const onChange = () => {
      if (document.hidden) setMark(arrivals)
      setHidden(document.hidden)
    }
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [arrivals])
  const unread = hidden ? arrivals - mark : inOtherRooms
  useEffect(() => {
    if (!hidden && top > 0) markSeen(room, top, needs)
  }, [room, top, needs, hidden])
  useEffect(() => setOpenNews({ room, unread, needs }), [room, unread, needs])
  // Leaving: the list takes over (polled heads mark the other rows).
  useEffect(() => () => setOpenNews(null), [room])
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
/** A stamp goes between messages this far apart, as Messages does. */
const STAMP_GAP = 15 * 60_000

/** The places a task's own events go, summed up in main as one line each: made, and a change of state. */
const summarised = (m: Message) => m.ev?.op === "task.add" || (m.ev?.op === "task.update" && !!m.ev.state)

/** What the main column shows: the main conversation or a direct one. A task's opens in the Tasks panel. */
type Here = Exclude<Place, { kind: "task" }>

/** What's open on the right, one at a time: a thread (by its first message), the details, or the tasks (the list, or one of them). */
type Side = { kind: "thread"; root: number } | { kind: "info" } | { kind: "tasks"; task: number | null; via?: "overview" } | null

const CLEAR = "xl:pr-[min(var(--float),max(0px,calc(792px_+_2*var(--float)_-_100%)))]"

function roundOf(t: Task): { round: number; at?: string } | Record<string, never> {
  const open = openRound(t)
  return open ? { round: open.n, ...(open.at ? { at: open.at } : {}) } : {}
}

export function Conversation({ member, onBack, onGone }: { member: StoredMember; onBack: () => void; onGone: () => void }) {
  const me = member.identity.name
  const { ch, connection, gone, messages, roster, state, online, isOwner, requests, send, refreshRequests, refreshRoster, head, marks, pkOf } = useChannel(member)
  useLiveIcon(member)
  const roomId = member.access.roomId
  const icon = useIcons().get(roomId) ?? null
  const now = useNow()
  // Where you are in the channel: its main conversation, or a direct one.
  const [here, setHere] = useState<string>("main")
  const [side, setSide] = useState<Side>(null)
  const floating = side === null
  const sideRoot = side?.kind === "thread" ? side.root : null
  const info = side?.kind === "info"
  /** The task open in the Tasks panel, if one is (else the panel lists them, if it's open). */
  const shownTask = side?.kind === "tasks" ? side.task : null
  const openThread = useCallback((root: number) => setSide({ kind: "thread", root }), [])
  const openTask = useCallback((task: number) => setSide({ kind: "tasks", task }), [])
  const [pausing, setPausing] = useState(false)
  const [search, setSearch] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [picture, setPicture] = useState<{ m: Message; img: ImageAttachment; src: string } | null>(null)
  const [highlight, setHighlight] = useState<number | null>(null)
  /** New messages below while scrolled up. */
  const [behind, setBehind] = useState(0)
  // The floating header and composer: their heights pad the conversation, so its ends clear them.
  const [headRef, headH] = useHeight()
  const [footRef, footH] = useHeight()

  const nameOf = useCallback((name: string) => memberName(state.members.get(name), name), [state.members])
  // Members by key: names are what people type, keys are who they are.
  const byKey = useMemo(() => new Map(roster.map((r) => [r.pk, r])), [roster])
  const memberCount = roster.filter((r) => r.active).length || state.members.size
  const active = useMemo(() => [...state.members.values()].filter((m) => m.active), [state.members])
  const others = useMemo(() => active.filter((m) => m.name !== me), [active, me])
  const people = useMemo(() => active.map((m) => ({ name: m.name, label: memberName(m), agent: isAgent(m), color: colorOf(state, m.name) })), [active, state])
  // The channel's name can arrive after this view opens (members decrypt it), so follow the list.
  const known = useKnownChannels()
  const title = channelTitle(
    // The list has the latest name (a rename lands there); the member record this view opened with may be older.
    { name: known.find((c) => c.code === member.code)?.name ?? member.name },
    others.length ? { from: "", text: "", ts: 0, people: others.map((m) => memberName(m)) } : loadRecent(member.code)
  )
  // Strict coordinator-only: nothing another agent sends counts as reaching a person.
  const iAmPerson = !isAgent(state.members.get(me))
  const reaches = useCallback((m: Message) => !(iAmPerson && keptFromPeople(state, m)), [iAmPerson, state])
  const openAsks = useMemo(() => state.openAsks.filter(reaches), [state.openAsks, reaches])

  // Coordinator-only: a person's main conversation is with the coordinator.
  const meM = state.members.get(me)
  const coordinator = state.mode.coordinatorOnly && meM && !isAgent(meM) && state.coordinator !== me ? state.coordinator : null
  // A reaction isn't news.
  const arrivals = useMemo(() => messages.filter((m) => m.from !== me && !isReaction(m) && reaches(m)).length, [messages, me, reaches])
  // Needs you: a question to you (or to everyone) that nobody else has answered yet.
  const needs = useMemo(() => openAsks.filter((m) => m.from !== me && (m.to?.includes(me) || m.to?.includes("*"))).length, [openAsks, me])
  useChannelNews(roomId, Math.max(head, messages.at(-1)?.seq ?? 0), arrivals, 0, needs)

  // Needs you: escalations to this person nobody answered, and work waiting on their review.
  const escalations = useMemo(() => openAsks.filter((m) => m.esc && m.from !== me && m.to?.includes(me)), [openAsks, me])
  const reviews = useMemo(
    () => (iAmPerson ? [...state.tasks.values()].filter((t) => t.state === "review" && !!t.review && (t.review === me || (t.review === "*" && t.owner !== me && !t.workedBy.includes(me)))) : []),
    [state.tasks, me, iAmPerson]
  )
  // Nobody to talk to yet: the conversation opens on how to add an agent.
  const noAgents = !active.some((m) => isAgent(m))
  // A brand-new channel: nothing said and nobody to say it. The stop button waits for agents.
  const quiet = noAgents && !messages.some((m) => m.kind !== "event")

  // Remember the latest message and who's here, for the channel list. Same filter as the
  // transcript: not events, not a self-note, not ignored, and what this person actually sees.
  useEffect(() => {
    const last = lastPreview(messages, reaches, (seq) => state.trust.get(seq))
    const prior = loadRecent(member.code)
    if (!last && !others.length) return
    saveRecent(member.code, {
      from: last ? (last.from === me ? "You" : nameOf(last.from)) : (prior?.from ?? ""),
      text: last ? (last.imgs?.length && last.body === last.imgs.map((i) => i.name).join(", ") ? "Image" : excerpt(last.body, 120)) : (prior?.text ?? ""),
      ts: last?.ts ?? prior?.ts ?? member.at,
      people: others.length ? others.map((m) => memberName(m)) : (prior?.people ?? []),
      ...(last && state.coordinator && last.from === state.coordinator ? { byCoordinator: true } : {}),
    })
  }, [messages, others, state.trust, state.coordinator, member.code, member.at, nameOf, me, reaches])

  // ---------- the coordinator's face: what it's doing right now ----------
  const coord = state.coordinator
  const said = useMemo(() => (coord ? moodInputs(state, messages, online, coord) : null), [coord, state, messages, online])
  // A fresh message or refusal shows for a few seconds: wake the clock when that window closes.
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    // Read the clock as soon as something new is said, and again when its moment is over.
    const now = Date.now()
    const ends = [said?.saidAt != null ? said.saidAt + SPEAKING_MS : 0, said?.failedAt != null ? said.failedAt + ERROR_MS : 0].filter((t) => t > now)
    const timers = [setTimeout(() => setClock(Date.now()), 0), ...(ends.length ? [setTimeout(() => setClock(Date.now()), Math.min(...ends) - now + 50)] : [])]
    return () => timers.forEach(clearTimeout)
  }, [said])
  const mood: Mood | undefined = coord && said ? coordinatorMood({ ...said, online: online.has(coord), hold: !!state.hold, now: clock }) : undefined

  // ---------- places: main, each task's conversation, direct ones ----------
  const { placeOf, places } = state
  const place: Here = useMemo(() => {
    const p = placeFromKey(here)
    // A direct conversation can be opened before anything's been said in it.
    return p?.kind === "dm" ? p : { kind: "main" }
  }, [here])
  const hereKey = placeKey(place)
  const go = useCallback(
    (p: Place) => {
      // A task's conversation is beside this one, in the Tasks panel.
      if (p.kind === "task") return openTask(p.task)
      setHere(placeKey(p))
      setBehind(0)
      // A thread belongs to the conversation it's in, and the details make way; the tasks stay open beside.
      setSide((s) => (s?.kind === "tasks" ? s : null))
      setReplyTo(null)
      setSearch(null)
    },
    [openTask]
  )

  // What's new where: the newest message seen in each place, kept by this browser.
  const seen = useSeen(roomId)
  const firstVisit = useRef(Object.keys(seenIn(roomId)).length === 0)
  useEffect(() => {
    // The first time this browser opens the channel, everything already said counts as read.
    if (!firstVisit.current || !messages.length) return
    firstVisit.current = false
    markSeenIn(roomId, Object.fromEntries([...places].map(([k, v]) => [k, v.last])))
  }, [messages.length, places, roomId])
  /**
   * What's new in a place since this browser looked: a count when it's for me (main, a direct
   * conversation I'm in, a task I belong to, or a message that names me), else just that there's news.
   */
  const unreadIn = useCallback(
    (key: string): { n: number; forMe: boolean } => {
      const since = seen[key] ?? 0
      const p = placeFromKey(key) ?? MAIN
      const mine = p.kind === "main" || (p.kind === "dm" ? p.with.includes(me) : threadMembers(state, p).includes(me))
      let n = 0
      let named = 0
      for (const m of messages) {
        if (m.seq <= since || m.kind === "event" || m.from === me || placeKey(placeOf.get(m.seq) ?? MAIN) !== key || ignored(state.trust.get(m.seq))) continue
        if (key === "main" && !reaches(m)) continue
        n++
        if (m.to?.includes(me)) named++
      }
      return mine ? { n, forMe: n > 0 } : { n: named || n, forMe: named > 0 }
    },
    [seen, messages, me, placeOf, reaches, state]
  )
  const lastHere = places.get(hereKey)?.last ?? 0
  useEffect(() => {
    if (!document.hidden && lastHere) markSeenIn(roomId, { [hereKey]: lastHere })
  }, [hereKey, lastHere, roomId])
  // The task open in the panel is read too.
  const taskKey = shownTask === null ? null : placeKey({ kind: "task", task: shownTask })
  const lastInTask = (taskKey && places.get(taskKey)?.last) || 0
  useEffect(() => {
    if (!document.hidden && taskKey && lastInTask) markSeenIn(roomId, { [taskKey]: lastInTask })
  }, [taskKey, lastInTask, roomId])

  // Replies to a message live in its thread on the right. A message answering a task's own event is just in that task's conversation.
  const bySeqAll = useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])
  const rootOf = useCallback(
    (seq: number) => {
      const root = state.threadOf.get(seq)
      if (root === undefined || root === seq) return null
      if (coordinator && (state.placeOf.get(seq) ?? MAIN).kind === "main") return null
      const r = bySeqAll.get(root)
      return r && r.kind !== "event" ? root : null
    },
    [state.threadOf, state.placeOf, bySeqAll, coordinator]
  )
  const threadRoot = sideRoot !== null && coordinator && (state.placeOf.get(sideRoot) ?? MAIN).kind === "main" ? null : sideRoot
  // The owner can look at what every view leaves out (forged, or not allowed), tagged; nobody else can.
  const [showDropped, setShowDropped] = useState(false)
  const revealed = isOwner && showDropped
  const threads = useMemo(() => {
    const out = new Map<number, Message[]>()
    for (const m of messages) {
      if (m.kind === "event" || (!revealed && ignored(state.trust.get(m.seq)))) continue
      const root = rootOf(m.seq)
      if (root === null) continue
      const list = out.get(root)
      if (list) list.push(m)
      else out.set(root, [m])
    }
    return out
  }, [messages, rootOf, state.trust, revealed])

  const visible = useMemo(() => {
    const q = search?.trim().toLowerCase()
    let list = messages.filter((m) => {
      const at = placeKey(placeOf.get(m.seq) ?? MAIN)
      // Main also tells, in one line each, that a task was made or changed state.
      const inHere = at === hereKey || (hereKey === "main" && at.startsWith("task:") && summarised(m))
      if (!inHere) return false
      // Joins and what an agent says it runs on are in the details; the conversation doesn't repeat them.
      // Nor reactions: they sit on their message, not in the conversation.
      if (m.ev?.op === "hello" || m.ev?.op === "card" || m.ev?.op === "react") return false
      if (!revealed && ignored(state.trust.get(m.seq))) return false
      // Strict coordinator mode keeps other agents out of the people's main conversation; their own
      // conversations (a task's, a direct one) show everything said there.
      if (hereKey === "main" && !reaches(m)) return false
      return true
    })
    // Search shows every match flat, replies included; otherwise replies live in their thread.
    if (q) list = list.filter((m) => m.body.toLowerCase().includes(q) || nameOf(m.from).toLowerCase().includes(q))
    else list = list.filter((m) => m.kind === "event" || rootOf(m.seq) === null)
    return list
  }, [messages, placeOf, hereKey, search, nameOf, rootOf, state, revealed, reaches])
  // The open task's conversation, in the panel: everything said there in order, replies too, as a thread reads.
  // Not the event that made it: its details at the top say that.
  const inTask = useMemo(
    () => (taskKey === null ? [] : messages.filter((m) => m.seq !== shownTask && placeKey(placeOf.get(m.seq) ?? MAIN) === taskKey && (revealed || !ignored(state.trust.get(m.seq))))),
    [messages, placeOf, taskKey, shownTask, state.trust, revealed]
  )

  const bySeq = useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])
  const quoted = useCallback((seq: number) => bySeq.get(seq), [bySeq])

  // ---------- motion: what arrives while you look lands with a little life; history doesn't ----------
  const newest = messages.at(-1)?.seq ?? 0
  // Where this conversation stood when it opened: only what comes after counts as arriving.
  const [baseline, setBaseline] = useState<{ key: string; seq: number } | null>(null)
  // Set while rendering (React's way to keep state in step with a prop), not in an effect.
  if (newest && baseline?.key !== hereKey) setBaseline({ key: hereKey, seq: newest })
  const isFresh = (seq: number) => baseline !== null && baseline.key === hereKey && seq > baseline.seq

  // ---------- scrolling: stick to the bottom unless the reader scrolled up ----------
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastCount = useRef(0)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const added = visible.length - lastCount.current
    lastCount.current = visible.length
    // A new message glides into view; the first paint just starts at the bottom.
    if (atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: added > 0 && added < 4 ? "smooth" : "instant" })
    else if (added > 0) setBehind((b) => b + added)
  }, [visible])
  // A new place opens at its latest message.
  useLayoutEffect(() => {
    atBottom.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [hereKey])

  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setBehind(0)
  }

  const jump = useCallback(
    (seq: number) => {
      setHighlight(seq)
      setTimeout(() => setHighlight((h) => (h === seq ? null : h)), 1600)
      // In a task's conversation: open it in the panel, where replies read in line. Elsewhere a reply is in its thread.
      const at = placeOf.get(seq)
      const inTask = at?.kind === "task" ? at.task : null
      const inThread = inTask === null ? rootOf(seq) : null
      if (inTask !== null) openTask(inTask)
      else {
        if (inThread !== null) openThread(inThread)
        // Somewhere else in the channel: go there first.
        if (at && placeKey(at) !== hereKey) setHere(placeKey(at))
      }
      setSearch(null)
      const find = (left: number) => {
        const el = document.getElementById(`${inTask !== null ? "k" : inThread !== null ? "t" : "m"}${seq}`)
        if (!el) {
          if (left > 0) requestAnimationFrame(() => find(left - 1))
          return
        }
        el.scrollIntoView({ block: "center", behavior: "smooth" })
      }
      // A few frames so a new place, or a collapsed run, can render before we look for the row.
      requestAnimationFrame(() => requestAnimationFrame(() => find(3)))
    },
    [rootOf, placeOf, hereKey, openTask, openThread]
  )

  // Replying opens the message's thread, so the answer doesn't land in the conversation.
  const onReply = useCallback(
    (m: Message) => {
      if (coordinator && (state.placeOf.get(m.seq) ?? MAIN).kind === "main") setReplyTo(m)
      else openThread(rootOf(m.seq) ?? m.seq)
    },
    [coordinator, state.placeOf, rootOf, openThread]
  )
  const peopleOf = useCallback(
    (list: Message[]) => {
      const seenNames = new Map<string, { name: string; label: string; agent: boolean; color: Color | null }>()
      for (const r of list) if (!seenNames.has(r.from)) seenNames.set(r.from, { name: r.from, label: nameOf(r.from), agent: isAgent(state.members.get(r.from)), color: colorOf(state, r.from) })
      return [...seenNames.values()]
    },
    [nameOf, state]
  )
  const summaryOf = (seq: number): ThreadSummary | undefined => {
    const list = threads.get(seq)
    if (!list?.length) return undefined
    return { count: list.length, last: list[list.length - 1]!.ts, people: peopleOf(list), forYou: list.some((r) => r.from !== me && r.to?.includes(me)) }
  }

  if (gone) {
    return (
      <Centered>
        <p className="text-title font-semibold">{gone === "closed" ? "This channel was closed" : "You’re no longer in this channel"}</p>
        <p className="mt-1 max-w-sm text-ui leading-normal text-ink-2">
          {gone === "closed" ? "Its owner deleted it, and nothing is left on the relay." : "The owner removed this browser, or it left."} This browser has forgotten it too.
        </p>
        <Button className="mt-4" onClick={onGone}>
          Back to channels
        </Button>
      </Centered>
    )
  }

  // ---------- the conversation: stamps, bubbles in runs, events as centred lines ----------
  const group = memberCount > 2
  // Your newest message here says whether the agents it went to have read it, as Messages does.
  const lastMine = visible.findLast((m) => m.from === me && m.kind !== "event")?.seq
  const lastMineReply = threadRoot === null ? undefined : (threads.get(threadRoot) ?? []).findLast((m) => m.from === me && m.kind !== "event")?.seq
  const showsReceipt = (m: Message, anchor: string | undefined): boolean => (anchor === undefined && m.seq === lastMine) || (anchor === "t" && m.seq === lastMineReply)
  const bubble = (m: Message, first: boolean, last: boolean, prev: Message | undefined, anchor?: string) => (
    <Bubble
      key={m.seq}
      anchor={anchor}
      m={m}
      me={me}
      author={(m.pk && byKey.get(m.pk)) || state.members.get(m.from)}
      trust={state.trust.get(m.seq)}
      online={online.has(m.from)}
      color={colorOf(state, m.from)}
      direct={state.direct.has(m.seq) ? (state.coordinator ?? undefined) : undefined}
      first={first}
      last={last}
      fresh={!anchor && isFresh(m.seq)}
      group={group}
      adjacentReply={(m.re?.length ?? 0) === 1 && (prev?.seq === m.re![0] || bySeq.get(m.re![0]!)?.kind === "event")}
      highlighted={highlight === m.seq}
      quoted={quoted}
      nameOf={nameOf}
      onReply={anchor ? undefined : onReply}
      onJump={jump}
      thread={search || anchor ? undefined : summaryOf(m.seq)}
      onOpenThread={openThread}
      receipt={showsReceipt(m, anchor) ? (receipt(m, state, marks, pkOf, formatTime) ?? undefined) : undefined}
      reactions={chipsFor(state, m.seq, me, nameOf)}
      image={ch.image}
      onOpenImage={(pm, img, src) => setPicture({ m: pm, img, src })}
      // The coordinator's runs end on its face; only the latest one moves.
      face={coord && m.from === coord ? <CoordinatorAvatar size={28} mood={mood} live={m.seq >= (said?.last ?? 0) && !anchor} seed={0.3} /> : undefined}
    />
  )
  // A run of messages as rows: the main column's, and (anchored "k") the open task's in the panel.
  const timeline = (list: Message[], anchor?: string) => {
    const out: ReactNode[] = []
    for (let i = 0; i < list.length; i++) {
      const m = list[i]!
      const prev = list[i - 1]
      if (!prev || !sameDay(prev.ts, m.ts) || m.ts - prev.ts > STAMP_GAP) out.push(<TimeMark key={`s${m.seq}`} ts={m.ts} />)
      if (m.kind === "event") {
        const batch: Message[] = [m]
        let j = i + 1
        while (j < list.length && list[j]!.kind === "event" && sameDay(m.ts, list[j]!.ts) && list[j]!.ts - list[j - 1]!.ts <= STAMP_GAP) batch.push(list[j++]!)
        i = j - 1
        const alone = batch.filter((ev) => standsAlone(ev, state, me))
        const rest = batch.filter((ev) => !standsAlone(ev, state, me))
        // Main's lines about a task open it beside; in the task's own conversation it's already open.
        const open = anchor ? undefined : openTask
        for (const ev of alone) out.push(<EventRow key={ev.seq} m={ev} state={state} now={now} onOpenTask={open} anchor={anchor} />)
        if (rest.length) out.push(<EventGroup key={`e${rest[0]!.seq}`} messages={rest} state={state} now={now} onOpenTask={open} highlight={highlight} anchor={anchor} />)
        continue
      }
      const next = list[i + 1]
      const runs = (a: Message | undefined, b: Message) => !!a && a.kind !== "event" && b.kind !== "event" && a.from === b.from && sameDay(a.ts, b.ts) && b.ts - a.ts <= RUN_GAP
      const first = !runs(prev, m) || m.ts - (prev?.ts ?? 0) > STAMP_GAP
      const last = !next || !runs(m, next) || next.ts - m.ts > STAMP_GAP
      out.push(bubble(m, first, last, prev, anchor))
    }
    return out
  }
  const rows: ReactNode[] = []
  const dropped = isOwner ? droppedCount(state) : 0
  if (dropped && hereKey === "main")
    rows.push(
      <p key="dropped" className="mt-3 text-center text-stamp text-ink-3">
        {dropped === 1 ? "1 message" : `${dropped} messages`} left out: forged, or not allowed by your settings.{" "}
        <button type="button" onClick={() => setShowDropped((v) => !v)} className="font-medium text-accent-text hover:underline">
          {showDropped ? "Hide them" : "Show them"}
        </button>
      </p>
    )
  rows.push(...timeline(visible))

  // The open thread: its first message, then every reply, in runs the same way.
  const root = threadRoot === null ? undefined : bySeqAll.get(threadRoot)
  const replies = threadRoot === null ? [] : (threads.get(threadRoot) ?? [])
  const threadRows: ReactNode[] = []
  if (root) {
    const list = [root, ...replies]
    list.forEach((m, i) => {
      const prev = list[i - 1]
      const next = list[i + 1]
      const first = !prev || prev.from !== m.from || m.ts - prev.ts > RUN_GAP
      const last = !next || next.from !== m.from || next.ts - m.ts > RUN_GAP
      threadRows.push(bubble(m, first, last, prev, "t"))
      if (i === 0 && replies.length)
        threadRows.push(
          <div key="split" className="my-3 text-center text-stamp text-ink-3">
            {replies.length === 1 ? "1 reply" : `${replies.length} replies`}
          </div>
        )
    })
  }
  // The open task's conversation, under its details the way replies sit under a thread's first message.
  const taskRows = shownTask === null ? [] : timeline(inTask, "k")
  const saidInTask = inTask.filter((m) => m.kind !== "event").length

  const subtitle =
    connection === "connecting"
      ? "Connecting…"
      : connection === "reconnecting"
        ? "Reconnecting…"
        : (online.size ? `${memberCount} members, ${online.size} online` : `${memberCount} ${memberCount === 1 ? "member" : "members"}`) +
          (state.mode.coordinatorOnly ? (state.coordinator ? " · coordinator mode" : " · coordinator mode, no coordinator yet") : "")
  // What's going on, in one live line under the name: who coordinates, who's working, what needs you.
  const working = active.filter((m) => isAgent(m) && memberLoad(state, m.name, now).current.length > 0).length
  // Every agent here, for the strip under the composer: what each is on, and when it last spoke.
  // (Computed each render, after the early return above: one pass over the messages.)
  const lastAt = new Map<string, number>()
  for (const m of messages) if (m.kind !== "event") lastAt.set(m.from, m.ts)
  const agentsNow: AgentNow[] = active
    .filter((m) => isAgent(m))
    .map((m) => ({
      name: m.name,
      label: memberName(m),
      color: colorOf(state, m.name),
      here: howHere(online.get(m.name)),
      coordinator: m.name === state.coordinator,
      model: online.get(m.name)?.activity?.model ?? m.card?.model,
      activity: online.get(m.name)?.activity,
      load: memberLoad(state, m.name, now),
      lastAt: lastAt.get(m.name),
    }))
  const prs = floating ? recentPrs(state, messages, me, 5) : []
  const needsMe = escalations.length + reviews.length + (isOwner ? requests.length : 0)
  // The header's capsule is the channel's, wherever you are in it, so this line is the channel's too.
  const headline =
    connection === "connecting" || connection === "reconnecting"
      ? subtitle
      : [
          state.coordinator && state.coordinator !== me ? `${nameOf(state.coordinator)} coordinating` : null,
          working ? `${working} working` : null,
          needsMe ? `${needsMe} ${needsMe === 1 ? "needs" : "need"} you` : null,
        ]
          .filter(Boolean)
          .join(" · ") || subtitle
  const hold = isOwner
    ? async (on: boolean, note?: string) => {
        const ev = { op: "hold.set" as const, on, ...(note ? { note } : {}) }
        const since = await send(on ? `on hold${note ? `: ${note}` : ""}` : "hold lifted", { kind: "event", ev })
        // Then the channel's settings say it too, for clients holding only the log's tail.
        await ch.setHold({ on, ...(note ? { note } : {}), since })
      }
    : undefined

  // A direct conversation you're in is named for the other one, as Messages names a chat.
  const placeTitle = place.kind === "main" ? title : place.with.includes(me) ? nameOf(place.with.find((n) => n !== me) ?? me) : place.with.map(nameOf).join(" & ")
  // A direct conversation is between its two; anyone else reads it.
  const mayWrite = place.kind !== "dm" || place.with.includes(me)
  // A direct one goes to the other one. A task's (in the panel) reaches whoever works it on its own
  // (state.ts threadMembers); only an @ names anyone.
  const extra = place.kind === "main" ? undefined : sendFrom(state, place, me)
  const task = shownTask === null ? undefined : state.tasks.get(shownTask)
  const openCount = [...state.tasks.values()].filter((t) => t.state !== "done").length

  return (
    <ChannelControls
      code={member.code}
      myKey={member.identity.pk}
      isOwner={isOwner}
      roster={roster}
      requests={requests}
      online={online}
      state={state}
      now={now}
      onApprove={async (r, scopes) => {
        const as = wireScopes(scopes) ? { scopes } : undefined
        try {
          await ch.approve(r, as, { person: secrets().person?.pk })
        } catch (err) {
          const joined = (await ch.members().catch(() => [])).find((m) => m.active && !m.unverified && m.pk === r.pk)
          if (!joined) throw err
          if (String(wireScopes(joined.later?.scopes ?? joined.scopes)) !== String(wireScopes(scopes)))
            throw new Error(`${r.name} already joined with other permissions: change them from its menu`, { cause: err })
        } finally {
          await Promise.all([refreshRequests(), refreshRoster()])
        }
      }}
      onScopes={async (m, scopes) => {
        const wire = wireScopes(scopes)
        const seq = await send(`set what ${m.name} may do: ${wire ? describeScopes(wire) : "full"}`, { kind: "event", ev: { op: "scope.set", member: m.name, pk: m.pk, scopes: wire } })
        // Then their record says it too, with the relay's bit (the reconcile puts both right if this fails).
        await ch.updateScopes(m, scopes, seq)
        await refreshRoster()
      }}
      onRole={async (ev) => {
        // Addressed to the member, so their own client tells them at once.
        const seq = await send(ev.op === "role.set" ? `made ${ev.member} ${ev.role ?? "unassigned"}` : `kept ${ev.member}'s role`, { kind: "event", ev, to: [ev.member] })
        // Then the member's record says it too, for views holding only the log's tail (T885).
        const target = ev.op === "role.set" ? roster.find((m) => m.active && m.name === ev.member && !m.owner) : undefined
        if (ev.op === "role.set" && target) await ch.updateRole(target, ev.role, ev.about, seq).catch(() => {})
      }}
      onNickname={async (m, nickname) => {
        await ch.updateNickname(m, nickname)
        await refreshRoster()
      }}
      onDeny={async (r) => {
        await ch.deny(r.id)
        await refreshRequests()
      }}
      onCheck={async (r) => {
        await ch.checkRequest(r)
        await refreshRequests()
      }}
      onRemove={async (m) => {
        await ch.remove(m.pk)
        await refreshRoster()
      }}
      roomId={member.access.roomId}
      title={title}
      onMode={
        isOwner
          ? async (coordinatorOnly, strict) => {
              const ev = { op: "mode.set" as const, coordinatorOnly, strict: coordinatorOnly && strict }
              const since = await send(coordinatorOnly ? `coordinator-only on${ev.strict ? " (strict)" : ""}` : "coordinator-only off", { kind: "event", ev })
              // Then the channel's settings say it too, for clients holding only the log's tail.
              await ch.setMode({ coordinatorOnly, strict: ev.strict, since })
            }
          : undefined
      }
      onHold={hold}
      onCharter={
        isOwner
          ? async (text) => {
              const since = await send(text ? `charter: ${text}` : "cleared the charter", { kind: "event", ev: { op: "charter.set", text } })
              await ch.setCharter({ text, since })
            }
          : undefined
      }
      onRename={
        isOwner
          ? async (name) => {
              await ch.setTitle(name)
              // Show it here at once; other members pick it up from the relay's info frame.
              const stored = loadMember(member.code)
              if (stored) void renameChannel(stored.code, name.trim().slice(0, 80))
            }
          : undefined
      }
      onCloseChannel={async () => {
        await ch.close()
        forgetChannel(member.code)
        onGone()
      }}
      onLeaveChannel={async () => {
        await ch.leave()
        forgetChannel(member.code)
        onGone()
      }}
    >
      <div className="flex h-full min-w-0 flex-1">
        <div
          className={cx("relative flex min-w-0 flex-1 flex-col bg-canvas", (root || info || side?.kind === "tasks") && "hidden md:flex")}
          style={{ "--head": `${headH}px`, "--foot": `${footH}px`, "--float": `${FLOAT_W + 2 * FLOAT_GAP}px` } as CSSProperties}
        >
          {/* The conversation's part of the window's one header row, floating over it as Grok's does:
              in the middle, one glass capsule with the channel's name; on the right, search and the
              tasks. Messages scroll under it. Pausing every agent is in the details (the name opens them). */}
          <header ref={headRef} className="absolute inset-x-0 top-0 z-20">
            <div aria-hidden className="scrim-top absolute inset-x-0 top-0 -bottom-6" />
            <div className="drag relative flex h-(--chrome-h) items-center gap-2 px-3">
              <IconButton label="Channels" round className="glass size-9 text-ink md:hidden" onClick={onBack}>
                <Icon icon={ArrowLeft01Icon} size={20} />
              </IconButton>
              <span className="flex-1" />
              {/* On, a glass button is ink with canvas on it: no ink colour of our own then. */}
              <IconButton label="Search" round className={cx("glass size-9", search === null && "text-ink")} active={search !== null} onClick={() => setSearch((s) => (s === null ? "" : null))}>
                <Icon icon={Search01Icon} size={18} />
              </IconButton>
              <TasksButton
                places={places}
                unreadIn={unreadIn}
                shown={taskKey}
                active={side?.kind === "tasks"}
                onClick={() => setSide((s) => (s?.kind === "tasks" ? null : { kind: "tasks", task: null }))}
              />
            </div>
            {/* After the row in the document and marked no-drag: the desktop app's drag region is worked
                out in document order, so it would otherwise swallow these clicks. */}
            <PlaceSwitch
              className="absolute top-0 left-1/2 h-(--chrome-h) -translate-x-1/2"
              current={hereKey}
              unreadIn={unreadIn}
              title={title}
              titleLabel={`Details: ${title}, ${subtitle}`}
              titleHint={headline}
              info={info}
              onTitle={() => setSide((s) => (s?.kind === "info" ? null : { kind: "info" }))}
              onPick={go}
            />
            {search !== null && (
              <div className="relative mx-auto w-full max-w-[792px] px-3 pb-2 md:px-4">
                <label className="glass flex h-9 items-center gap-2 rounded-full px-3.5 text-ink-3">
                  <Icon icon={Search01Icon} size={16} className="shrink-0" />
                  <input
                    autoFocus
                    value={search}
                    aria-label="Search messages"
                    placeholder={place.kind === "main" ? "Search this channel" : `Search ${placeTitle}`}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setSearch(null)}
                    className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
                  />
                </label>
              </div>
            )}
            <div className="relative">
              <HoldBanner />
            </div>
          </header>

          {pausing && hold && <HoldDialog onClose={() => setPausing(false)} onSave={(note) => hold(true, note)} />}

          <div
            ref={scroller}
            className={cx("absolute inset-0 overflow-y-auto", floating && CLEAR)}
            onScroll={(e) => {
              const el = e.currentTarget
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
              if (atBottom.current && behind) setBehind(0)
            }}
          >
            <div className="relative mx-auto w-full max-w-[792px] px-4 pt-[calc(var(--head)+8px)] pb-[calc(var(--foot)+16px)]">
              {/* What needs a person: at the top of the main conversation, as system cards. */}
              {hereKey === "main" && (
                <NeedsYou
                  now={now}
                  roomId={roomId}
                  escalations={escalations}
                  reviews={reviews}
                  nameOf={nameOf}
                  onReply={async (m, text) => void (await send(text, { to: [m.from], re: [m.seq], kind: "msg" }))}
                  onApproveTask={async (t: Task) =>
                    void (await send(`${taskId(t.id)} approved`, {
                      kind: "event",
                      ev: { op: "task.update", task: t.id, state: "done", verdict: "approved", note: "approved", ...roundOf(t) },
                      ...(t.owner ? { to: [t.owner] } : {}),
                    }))
                  }
                  onSendBack={async (t: Task, why: string) =>
                    void (await send(`${taskId(t.id)} rejected`, {
                      kind: "event",
                      ev: { op: "task.update", task: t.id, state: "doing", verdict: "rejected", note: why, ...roundOf(t) },
                      ...(t.owner ? { to: [t.owner] } : {}),
                    }))
                  }
                  onOpenTask={openTask}
                  onJump={jump}
                />
              )}
              {connection === "connecting" && messages.length === 0 ? (
                <Centered>
                  <Spinner />
                </Centered>
              ) : hereKey === "main" && noAgents && !search ? (
                <>
                  <AddAgent code={member.code} isOwner={isOwner} />
                  {/* A brand-new channel's own setup lines (coordinator mode on) aren't worth reading yet. */}
                  {!quiet && rows}
                </>
              ) : visible.length === 0 ? (
                <Centered>
                  <p className="text-body font-semibold">{search ? "No results" : "No messages yet"}</p>
                  <p className="mt-1 max-w-xs text-ui leading-normal text-ink-2">
                    {search ? `No message here mentions “${search}”.` : place.kind === "dm" ? "What these two say to each other shows up here." : "What’s said here shows up the moment it’s sent."}
                  </p>
                </Centered>
              ) : (
                rows
              )}
            </div>
          </div>

          {floating && (
            <Overview
              state={state}
              agents={agentsNow}
              prs={prs}
              now={now}
              nameOf={nameOf}
              onOpenTask={(task) => setSide({ kind: "tasks", task, via: "overview" })}
              onAllTasks={() => setSide({ kind: "tasks", task: null, via: "overview" })}
            />
          )}

          {behind > 0 && (
            <button
              type="button"
              onClick={toBottom}
              className="glass animate-rise absolute bottom-[calc(var(--foot)+10px)] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full py-1.5 pr-3.5 pl-2.5 text-ui font-medium text-accent-text"
            >
              <Icon icon={ArrowDown01Icon} size={15} />
              {behind === 1 ? "1 new message" : `${behind} new messages`}
            </button>
          )}

          {/* The composer floats on glass at the foot; messages scroll under it too. */}
          <div ref={footRef} className={cx("absolute inset-x-0 bottom-0 z-20", floating && CLEAR)}>
            <div aria-hidden className="scrim-bottom absolute inset-x-0 -top-6 bottom-0" />
            <div className="relative">
              {mayWrite ? (
                <Composer
                  key={hereKey}
                  me={me}
                  people={people}
                  replyTo={replyTo}
                  nameOf={nameOf}
                  onClearReply={() => setReplyTo(null)}
                  disabled={connection === "connecting"}
                  route={coordinator && place.kind === "main" ? { coordinator, label: nameOf(coordinator), view: "coordinator" } : undefined}
                  extra={extra}
                  placeholder={
                    place.kind === "main"
                      ? state.coordinator && state.coordinator !== me
                        ? `Message ${nameOf(state.coordinator)}`
                        : "Message everyone"
                      : `Message ${nameOf(place.with.find((n) => n !== me) ?? "")} privately`
                  }
                  send={async (body, opts) => {
                    atBottom.current = true
                    return send(body, opts)
                  }}
                  footer={
                    <div className="xl:hidden">
                      <AgentStrip agents={agentsNow} now={now} onOpenTask={openTask} />
                    </div>
                  }
                />
              ) : (
                <p className="shrink-0 px-6 pt-2 pb-4 text-center text-meta text-ink-3">
                  Between {place.kind === "dm" ? place.with.map(nameOf).join(" and ") : ""}. You can read along; talk with them in the main conversation.
                </p>
              )}
            </div>
          </div>
        </div>

        {root && (
          <ThreadPanel
            count={replies.length}
            onClose={() => setSide(null)}
            composer={
              <Composer
                key={root.seq}
                thread
                me={me}
                people={people}
                replyTo={root}
                nameOf={nameOf}
                onClearReply={() => undefined}
                disabled={connection === "connecting"}
                send={send}
                route={coordinator && place.kind === "main" ? { coordinator, label: nameOf(coordinator), view: "everything" } : undefined}
              />
            }
          >
            {threadRows}
          </ThreadPanel>
        )}

        {picture && (
          <Annotator
            picture={{ src: picture.src, name: picture.img.name, mime: picture.img.mime }}
            sender={nameOf(picture.m.from)}
            agent={isAgent(state.members.get(picture.m.from))}
            when={formatShort(picture.m.ts)}
            replyTo={mayWrite ? nameOf(picture.m.from) : undefined}
            onSend={
              mayWrite
                ? async (note, image) => {
                    const pm = picture.m
                    let to = pm.from !== me ? [pm.from] : extra?.to
                    if (coordinator && place.kind === "main" && to?.length && !to.includes(coordinator)) to = [...to, coordinator]
                    await send(note || image.name, {
                      to,
                      kind: "msg",
                      re: [pm.seq],
                      ...(extra?.task !== undefined ? { task: extra.task } : {}),
                      ...(extra?.dm ? { to: extra.to, dm: true } : {}),
                      imgs: [image],
                    })
                  }
                : undefined
            }
            onClose={() => setPicture(null)}
          />
        )}

        {info && (
          <InfoPanel
            title={title}
            icon={icon}
            subtitle={subtitle}
            onClose={() => setSide(null)}
            onPause={hold && !state.hold ? () => setPausing(true) : undefined}
            onMessage={(name) => go(dmPlace(me, name))}
            mood={mood}
            notes={<Notes state={state} now={now} onClear={async (key) => void (await send(`cleared ${key}`, { kind: "event", ev: { op: "fact.del", key } }))} />}
          />
        )}

        {side?.kind === "tasks" && (
          <TasksPanel
            title={
              shownTask === null ? (
                <>
                  Tasks <span className="font-normal text-ink-3 tabular-nums">{openCount} open</span>
                </>
              ) : (
                <>
                  <span className="tabular-nums">{taskId(shownTask)}</span> <span className="font-normal text-ink-3">{saidInTask === 1 ? "1 message" : `${saidInTask} messages`}</span>
                </>
              )
            }
            backLabel={side.task === null ? "Overview" : "All tasks"}
            onBack={side.task !== null ? () => setSide({ kind: "tasks", task: null, ...(side.via ? { via: side.via } : {}) }) : side.via ? () => setSide(null) : undefined}
            onClose={() => setSide(null)}
            follow={shownTask === null ? null : `${shownTask}:${inTask.length}`}
            composer={
              task && (
                <Composer
                  key={taskKey}
                  me={me}
                  people={people}
                  replyTo={null}
                  nameOf={nameOf}
                  onClearReply={() => undefined}
                  disabled={connection === "connecting"}
                  extra={sendFrom(state, { kind: "task", task: task.id }, me)}
                  placeholder={`Message in ${taskId(task.id)}`}
                  send={send}
                />
              )
            }
          >
            {shownTask === null ? (
              <Tasks
                state={state}
                now={now}
                nameOf={nameOf}
                unreadIn={(id) => unreadIn(placeKey({ kind: "task", task: id }))}
                onOpen={(task) => setSide((s) => ({ kind: "tasks", task, ...(s?.kind === "tasks" && s.via ? { via: s.via } : {}) }))}
              />
            ) : (
              <div className="px-3 pt-1 pb-4">
                <TaskDetails
                  id={shownTask}
                  state={state}
                  messages={messages}
                  me={me}
                  now={now}
                  highlighted={highlight === shownTask}
                  noteBlocked={state.members.get(me)?.scopes.includes("tasks") === false ? "The owner hasn’t let you change tasks here, so you can’t comment on one." : null}
                  onNote={async (note) => void (await send(`noted on ${taskId(shownTask)}`, { kind: "event", ev: { op: "task.update", task: shownTask, note } }))}
                />
                {task && !saidInTask && <p className="mt-4 text-center text-meta text-ink-3">What the agents on it say to each other shows up here.</p>}
                {taskRows}
              </div>
            )}
          </TasksPanel>
        )}
      </div>
    </ChannelControls>
  )
}

/**
 * The middle of the header row: the channel's name in one glass capsule (it opens the details). Away
 * from the main chat, the capsule leads with the way back to it, which carries main's news.
 */
function PlaceSwitch({
  className,
  current,
  unreadIn,
  title,
  titleLabel,
  titleHint,
  info,
  onTitle,
  onPick,
}: {
  className?: string
  current: string
  unreadIn: (key: string) => { n: number; forMe: boolean }
  title: string
  titleLabel: string
  titleHint: string
  info: boolean
  onTitle: () => void
  onPick: (p: Place) => void
}) {
  return (
    <nav aria-label="Conversations" className={cx("no-drag flex items-center gap-2", className)}>
      <div className="glass flex h-9 items-center gap-0.5 rounded-full p-0.5">
        {current !== "main" && (
          <button
            type="button"
            aria-label="Back to chat"
            title="Back to the channel’s chat"
            onClick={() => onPick(MAIN)}
            className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-wash-2 hover:text-ink"
          >
            <Icon icon={ArrowLeft01Icon} size={17} />
            <Badge u={unreadIn("main")} />
          </button>
        )}
        <button
          type="button"
          aria-label={titleLabel}
          aria-expanded={info}
          title={titleHint}
          onClick={onTitle}
          className="flex h-8 max-w-[min(46vw,360px)] min-w-0 items-center rounded-full px-3 text-ui font-semibold transition-colors hover:bg-wash-2"
        >
          <span className="truncate">{title}</span>
        </button>
      </div>
    </nav>
  )
}

/** The header's Tasks button: it opens the panel, and says what's new across the tasks' conversations. */
function TasksButton({
  places,
  unreadIn,
  shown,
  active,
  onClick,
}: {
  places: Map<string, PlaceSummary>
  unreadIn: (key: string) => { n: number; forMe: boolean }
  /** The task open in the panel, by its place's key: it's being read. */
  shown: string | null
  active: boolean
  onClick: () => void
}) {
  // A count of what's for you, else a quiet dot.
  let forMe = 0
  let news = false
  for (const [k, i] of places) {
    if (i.place.kind !== "task" || i.done || k === shown) continue
    const u = unreadIn(k)
    if (u.forMe) forMe += u.n
    else if (u.n) news = true
  }
  return (
    <IconButton label="Tasks" round className={cx("glass size-9 xl:hidden", !active && "text-ink")} active={active} aria-expanded={active} onClick={onClick}>
      <Icon icon={CheckListIcon} size={18} />
      <Badge u={forMe ? { n: forMe, forMe: true } : { n: news ? 1 : 0, forMe: false }} />
    </IconButton>
  )
}

/** On an icon: a count when it's for you, else a quiet dot. */
function Badge({ u }: { u: { n: number; forMe: boolean } }) {
  if (u.n <= 0) return null
  return u.forMe ? (
    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-stamp leading-none font-semibold text-accent-ink tabular-nums">{u.n}</span>
  ) : (
    <span aria-label="New messages" className="absolute top-0 right-0 size-2 rounded-full bg-accent" />
  )
}

/** An element's height, kept current as it changes (a header that wraps, a composer that grows). */
function useHeight(): [(el: HTMLElement | null) => void, number] {
  const [height, setHeight] = useState(0)
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!el) return
    // An observer reports once as soon as it starts watching, then on every change.
    const watch = new ResizeObserver(() => setHeight(el.offsetHeight))
    watch.observe(el)
    return () => watch.disconnect()
  }, [el])
  return [setEl, height]
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-60 flex-1 flex-col items-center justify-center p-8 text-center">{children}</div>
}
