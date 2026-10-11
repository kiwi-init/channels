import { ArrowDown01Icon, ArrowLeft01Icon, Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { GENERAL_ROOM, ignored, type Color, type Message } from "@mc/protocol.ts"
import { describeScopes, wireScopes } from "@mc/scopes.ts"
import { newRoomId, colorOf, keptFromPeople, taskId, type Room } from "@mc/state.ts"
import { useAuth } from "@/lib/auth"
import { channelTitle, forgetChannel, LEFT_CHANNEL, loadMember, loadRecent, saveMember, saveRecent, useChannel, useClock, useKnownChannels, type StoredMember } from "@/lib/channel"
import { markSeen, setOpenNews } from "@/lib/news"
import { refreshIcon, useIcons, useLiveIcon } from "@/lib/icons"
import { excerpt, memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { Composer } from "./composer"
import { RoomDialog, RoomMenu, RoomRail, roomOfMessage, useRooms, useRoomsSlot } from "./rooms"
import { ChannelControls, ChannelMenu, HoldBanner, InviteButton, People, RequestsBanner, type Filter } from "./controls"
import { Icon } from "./icon"
import { Button, IconButton, Spinner, Tabs, TextField } from "./kit"
import { DayMark, EventGroup, EventRow, MessageRow, isAgent, standsAlone, type ThreadSummary } from "./message"
import { TaskPage } from "./task-page"
import { WorkOverview } from "./work"
import { Tasks } from "./tasks"
import { ThreadPanel } from "./thread"

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
  // Leaving: the list takes over (and may refresh what it knows of the others).
  useEffect(
    () => () => {
      setOpenNews(null)
      window.dispatchEvent(new Event(LEFT_CHANNEL))
    },
    [room]
  )
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

export function Conversation({ member, onBack, onGone }: { member: StoredMember; onBack: () => void; onGone: () => void }) {
  const me = member.identity.name
  const auth = useAuth()
  const { ch, connection, gone, messages, roster, state, online, isOwner, requests, send, refreshRequests, refreshRoster, head } = useChannel(
    member,
    auth.status === "loading" ? null : auth.token,
  )
  useLiveIcon(member)
  const icon = useIcons().get(member.access.roomId) ?? null
  const now = useNow()
  const [tab, setTabState] = useState<"chat" | "tasks">("chat")
  // Once someone picks a tab, it stays theirs; until then, coordinator-only mode opens on Work for people.
  const picked = useRef(false)
  const setTab = useCallback((t: "chat" | "tasks") => ((picked.current = true), setTabState(t)), [])
  // undefined: the default view (the coordinator's, in coordinator-only mode for people); null: Everything.
  const [chosen, setFilter] = useState<Filter | null | undefined>(undefined)
  const [search, setSearch] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  /** The thread open on the right, by its first message. */
  const [threadRoot, setThreadRoot] = useState<number | null>(null)
  const [openTask, setOpenTask] = useState<number | null>(null)
  const [highlight, setHighlight] = useState<number | null>(null)

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
  // Strict coordinator-only: nothing another agent sends counts as reaching a person (Everything still shows it).
  const iAmPerson = !isAgent(state.members.get(me))
  const reaches = useCallback((m: Message) => !(iAmPerson && keptFromPeople(state, m)), [iAmPerson, state])
  const forMe = useMemo(() => messages.filter((m) => m.from !== me && m.to?.includes(me) && reaches(m)), [messages, me, reaches])

  // Rooms: the conversation shows one at a time; the inboxes (To you, Unanswered, the coordinator's
  // view) and search reach across them, and say which room each message is in.
  const rooms = useRooms(member.access.roomId, state, messages, me, reaches)
  const manyRooms = state.rooms.size > 1
  const roomsSlot = useRoomsSlot()
  const [roomDialog, setRoomDialog] = useState<{ room: Room | null } | null>(null)
  const openAsks = useMemo(() => state.openAsks.filter(reaches), [state.openAsks, reaches])

  // Coordinator-only: a person talks with the coordinator, and sees that exchange by default.
  const meM = state.members.get(me)
  const coordinator = state.mode.coordinatorOnly && meM && !isAgent(meM) && state.coordinator !== me ? state.coordinator : null
  useEffect(() => {
    if (coordinator && !picked.current) setTabState("tasks")
  }, [coordinator])
  const filter = useMemo<Filter | null>(
    () => (chosen === undefined ? (coordinator ? { kind: "coordinator" } : null) : chosen?.kind === "coordinator" && !coordinator ? null : chosen),
    [chosen, coordinator]
  )
  const withCoordinator = useMemo(() => {
    if (!coordinator) return []
    return messages.filter((m) => {
      if (m.kind === "event") return m.ev?.op === "mode.set"
      if (m.from === me) return true
      // The coordinator's words to you or to everyone; an agent's broadcast isn't a way around it.
      if (m.from === coordinator) return !m.to?.length || m.to.includes(me) || m.to.includes("*")
      // Anyone else, only when it names you (people, or an agent the owner didn't make strict).
      return !!m.to?.includes(me) && reaches(m)
    })
  }, [coordinator, messages, me, reaches])
  const openTasks = useMemo(() => [...state.tasks.values()].filter((t) => t.state !== "done" && t.state !== "cancelled").length, [state.tasks])
  const arrivals = useMemo(() => messages.filter((m) => m.from !== me && reaches(m)).length, [messages, me, reaches])
  const inOtherRooms = useMemo(() => [...rooms.unread].reduce((n, [id, c]) => (id === rooms.active ? n : n + c), 0), [rooms.unread, rooms.active])
  // Needs you: a question to you (or to everyone) that nobody else has answered yet.
  const needs = useMemo(() => openAsks.filter((m) => m.from !== me && (m.to?.includes(me) || m.to?.includes("*"))).length, [openAsks, me])
  useChannelNews(member.access.roomId, Math.max(head, messages.at(-1)?.seq ?? 0), arrivals, inOtherRooms, needs)

  // Remember the latest message and who's here, for the channel list.
  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.kind !== "event" && !ignored(state.trust.get(m.seq)))
    const prior = loadRecent(member.code)
    if (!last && !others.length) return
    saveRecent(member.code, {
      from: last ? (last.from === me ? "You" : nameOf(last.from)) : (prior?.from ?? ""),
      text: last ? (last.imgs?.length && last.body === last.imgs.map((i) => i.name).join(", ") ? "Image" : excerpt(last.body, 120)) : (prior?.text ?? ""),
      ts: last?.ts ?? prior?.ts ?? member.at,
      people: others.length ? others.map((m) => memberName(m)) : (prior?.people ?? []),
    })
  }, [messages, others, state.trust, member.code, member.at, nameOf, me])

  // Replies live in their thread. A reply whose first message isn't loaded stays in the timeline, with its quote line.
  const bySeqAll = useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])
  const rootOf = useCallback(
    (seq: number) => {
      const root = state.threadOf.get(seq)
      return root !== undefined && root !== seq && bySeqAll.has(root) ? root : null
    },
    [state.threadOf, bySeqAll]
  )
  const threads = useMemo(() => {
    const out = new Map<number, Message[]>()
    for (const m of messages) {
      if (m.kind === "event") continue
      const root = rootOf(m.seq)
      if (root === null) continue
      const list = out.get(root)
      if (list) list.push(m)
      else out.set(root, [m])
    }
    return out
  }, [messages, rootOf])

  const visible = useMemo(() => {
    // Filters and search show every match flat, threads or not.
    const flat = !!filter || !!search?.trim()
    let list =
      filter?.kind === "open"
        ? openAsks
        : filter?.kind === "mine"
          ? forMe
          : filter?.kind === "coordinator"
            ? withCoordinator
            : filter?.kind === "from"
              ? messages.filter((m) => m.from === filter.name)
              : messages
    if (!filter) list = list.filter((m) => roomOfMessage(state, m) === rooms.active)
    if (!flat) list = list.filter((m) => m.kind === "event" || rootOf(m.seq) === null)
    // Joins are noise; the member list already shows who's here.
    list = list.filter((m) => m.ev?.op !== "hello")
    const q = search?.trim().toLowerCase()
    if (q) list = list.filter((m) => m.body.toLowerCase().includes(q) || nameOf(m.from).toLowerCase().includes(q))
    return list
  }, [filter, openAsks, forMe, withCoordinator, messages, search, nameOf, rootOf, state, rooms.active])

  const bySeq = useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])
  const quoted = useCallback((seq: number) => bySeq.get(seq), [bySeq])

  // ---------- scrolling: stick to the bottom unless the reader scrolled up ----------
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [behind, setBehind] = useState(0)
  const lastCount = useRef(0)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const added = visible.length - lastCount.current
    lastCount.current = visible.length
    if (atBottom.current) el.scrollTop = el.scrollHeight
    else if (added > 0) setBehind((b) => b + added)
  }, [visible, tab])

  const toBottom = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setBehind(0)
  }

  const jump = useCallback(
    (seq: number) => {
      setHighlight(seq)
      setTimeout(() => setHighlight((h) => (h === seq ? null : h)), 1600)
      const inThread = rootOf(seq)
      if (inThread !== null) setThreadRoot(inThread)
      const go = (left: number) => {
        const el = document.getElementById(`${inThread !== null ? "t" : "m"}${seq}`)
        if (!el) {
          if (left > 0) requestAnimationFrame(() => go(left - 1))
          return
        }
        el.scrollIntoView({ block: "center", behavior: "smooth" })
      }
      // Two frames so a collapsed run can open before we look for the row.
      const start = () => requestAnimationFrame(() => requestAnimationFrame(() => go(1)))
      if (inThread === null && !visible.some((m) => m.seq === seq)) {
        setFilter(null)
        setSearch(null)
        start()
      } else start()
    },
    [visible, rootOf]
  )

  // Replying opens the message's thread, so the answer doesn't land in the main timeline.
  const onReply = useCallback((m: Message) => setThreadRoot(rootOf(m.seq) ?? m.seq), [rootOf])
  const peopleOf = useCallback(
    (list: Message[]) => {
      const seen = new Map<string, { name: string; label: string; agent: boolean; color: Color | null }>()
      for (const r of list) if (!seen.has(r.from)) seen.set(r.from, { name: r.from, label: nameOf(r.from), agent: isAgent(state.members.get(r.from)), color: colorOf(state, r.from) })
      return [...seen.values()]
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

  // The transcript: day marks, events as muted timeline rows, and each run of messages from one
  // sender as one card (the Linear activity feed, T1126).
  const rows: ReactNode[] = []
  let run: ReactNode[] = []
  let runKey = 0
  const flushRun = () => {
    if (!run.length) return
    rows.push(
      <div key={`r${runKey}`} className="my-2 rounded-card border border-edge bg-raised px-4 py-1.5">
        {run}
      </div>
    )
    run = []
  }
  for (let i = 0; i < visible.length; i++) {
    const m = visible[i]!
    const prev = visible[i - 1]
    const newDay = !prev || !sameDay(prev.ts, m.ts)
    if (newDay) {
      flushRun()
      rows.push(<DayMark key={`d${m.seq}`} ts={m.ts} />)
    }
    if (m.kind === "event") {
      const batch: Message[] = [m]
      let j = i + 1
      while (j < visible.length && visible[j]!.kind === "event" && sameDay(m.ts, visible[j]!.ts)) {
        batch.push(visible[j]!)
        j++
      }
      i = j - 1
      flushRun()
      let fold: Message[] = []
      const flush = () => {
        if (!fold.length) return
        rows.push(<EventGroup key={`e${fold[0]!.seq}`} messages={fold} state={state} now={now} onOpenTask={setOpenTask} highlight={highlight} />)
        fold = []
      }
      for (const ev of batch) {
        if (standsAlone(ev, state, me)) {
          flush()
          rows.push(<EventRow key={ev.seq} m={ev} state={state} now={now} onOpenTask={setOpenTask} />)
        } else fold.push(ev)
      }
      flush()
      continue
    }
    const adjacentReply = m.re?.length === 1 && prev?.seq === m.re[0]
    // A question, a blocker or an update says so in its own meta line, so it starts a row of its own.
    const head = newDay || !prev || prev.kind === "event" || prev.from !== m.from || m.ts - prev.ts > RUN_GAP || (!!m.re?.length && !adjacentReply) || m.kind !== "msg"
    // A new sender, a new day, or a gap starts a new card; a question from the same sender stays in its card.
    if (newDay || !prev || prev.kind === "event" || prev.from !== m.from || m.ts - prev.ts > RUN_GAP) {
      flushRun()
      runKey = m.seq
    }
    run.push(
      <MessageRow
        key={m.seq}
        now={now}
        m={m}
        me={me}
        author={(m.pk && byKey.get(m.pk)) || state.members.get(m.from)}
        trust={state.trust.get(m.seq)}
        online={online.has(m.from)}
        color={colorOf(state, m.from)}
        direct={state.direct.has(m.seq) ? (state.coordinator ?? undefined) : undefined}
        room={manyRooms && filter ? state.rooms.get(roomOfMessage(state, m))?.name : undefined}
        head={head}
        adjacentReply={adjacentReply}
        highlighted={highlight === m.seq}
        quoted={quoted}
        nameOf={nameOf}
        onReply={onReply}
        onJump={jump}
        thread={search || filter ? undefined : summaryOf(m.seq)}
        onOpenThread={setThreadRoot}
      />
    )
  }

  flushRun()

  // The open thread: its first message, then every reply, grouped the same way.
  const root = threadRoot === null ? undefined : bySeqAll.get(threadRoot)
  const replies = threadRoot === null ? [] : (threads.get(threadRoot) ?? [])
  const threadRows: ReactNode[] = []
  if (root) {
    const list = [root, ...replies]
    list.forEach((m, i) => {
      const prev = list[i - 1]
      const head = !prev || prev.from !== m.from || m.ts - prev.ts > RUN_GAP
      threadRows.push(
        <MessageRow
          key={m.seq}
          now={now}
          anchor="t"
          m={m}
          me={me}
          author={(m.pk && byKey.get(m.pk)) || state.members.get(m.from)}
          trust={state.trust.get(m.seq)}
          online={online.has(m.from)}
          color={colorOf(state, m.from)}
          head={head}
          // Inside a thread, answering the root needs no quote; a reply to a reply still shows what it answers.
          adjacentReply={i > 0 && (m.re?.length ?? 0) === 1 && (m.re![0] === root.seq || m.re![0] === prev?.seq)}
          highlighted={highlight === m.seq}
          quoted={quoted}
          nameOf={nameOf}
          onReply={() => undefined}
          onJump={jump}
        />
      )
      if (i === 0 && replies.length) threadRows.push(<div key="split" className="my-3 h-px bg-line" />)
    })
  }

  const filterLabel = filter?.kind === "from" ? `Only ${nameOf(filter.name)}` : filter?.kind === "open" ? "Unanswered questions" : filter?.kind === "mine" ? "Messages to you" : null
  const subtitle =
    connection === "connecting"
      ? "Connecting…"
      : connection === "reconnecting"
        ? "Reconnecting…"
        : (online.size ? `${memberCount} members, ${online.size} online` : `${memberCount} ${memberCount === 1 ? "member" : "members"}`) +
          (state.mode.coordinatorOnly ? (state.coordinator ? " · coordinator-only" : " · coordinator-only, no coordinator yet") : "")
  // Who's here right now, people first: a glance at the header says who's working.
  const here = active.filter((m) => online.has(m.name)).sort((a, b) => Number(isAgent(a)) - Number(isAgent(b)))

  const chips: { label: string; f: Filter | null; n?: number }[] = [
    ...(coordinator ? [{ label: `With ${nameOf(coordinator)}`, f: { kind: "coordinator" } as Filter }] : []),
    { label: "Everything", f: null },
    { label: "To you", f: { kind: "mine" }, n: forMe.length },
    { label: "Unanswered", f: { kind: "open" }, n: openAsks.length },
  ]

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
      onFilter={(f) => {
        setFilter(f)
        setTab("chat")
      }}
      onApprove={async (r, scopes) => {
        await ch.approve(r, wireScopes(scopes) ? { scopes } : undefined)
        await Promise.all([refreshRequests(), refreshRoster()])
      }}
      onReclaim={async (r, opts) => {
        // The seat keeps what it may do now, scope.set events included (they name the old key).
        await ch.reclaim(r, { ...opts, scopes: r.reclaims ? state.members.get(r.reclaims.name)?.scopes : undefined })
        await Promise.all([refreshRequests(), refreshRoster()])
      }}
      onColor={async (color) => {
        await send(color ? `took ${color}` : "cleared their colour", { kind: "event", ev: { op: "color.set", member: me, color } })
      }}
      onScopes={async (m, scopes) => {
        const wire = wireScopes(scopes)
        const seq = await send(`set what ${m.name} may do: ${wire ? describeScopes(wire) : "full"}`, { kind: "event", ev: { op: "scope.set", member: m.name, pk: m.pk, scopes: wire } })
        // Then their record says it too, with the relay's bit (the reconcile puts both right if this fails).
        await ch.updateScopes(m, scopes, seq)
        await refreshRoster()
      }}
      onRole={async (ev) => {
        const seq = await send(ev.op === "role.set" ? `made ${ev.member} ${ev.role ?? "unassigned"}` : `kept ${ev.member}'s role`, { kind: "event", ev })
        // Then the member's record says it too, for views holding only the log's tail (T885).
        const target = ev.op === "role.set" ? roster.find((m) => m.active && m.name === ev.member && !m.owner) : undefined
        if (ev.op === "role.set" && target) await ch.updateRole(target, ev.role, ev.about, seq).catch(() => {})
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
      onHold={
        isOwner
          ? async (on, note) => {
              const ev = { op: "hold.set" as const, on, ...(note ? { note } : {}) }
              const since = await send(on ? `on hold${note ? `: ${note}` : ""}` : "hold lifted", { kind: "event", ev })
              // Then the channel's settings say it too, for clients holding only the log's tail.
              await ch.setHold({ on, ...(note ? { note } : {}), since })
            }
          : undefined
      }
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
              if (stored) saveMember({ ...stored, name: name.trim().slice(0, 80) })
            }
          : undefined
      }
      onSetIcon={
        isOwner
          ? async (next) => {
              await ch.setIcon(next)
              await refreshIcon(member)
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
        {(manyRooms || isOwner) &&
          roomsSlot &&
          createPortal(
          <RoomRail
            state={state}
            active={rooms.active}
            unread={rooms.unread}
            onOpen={(id) => (rooms.open(id), setFilter(undefined), setThreadRoot(null))}
            isOwner={isOwner}
            onCreate={() => setRoomDialog({ room: null })}
            onRename={(room) => setRoomDialog({ room })}
          />,
            roomsSlot
          )}
        <div className={cx("relative flex min-w-0 flex-1 flex-col", root && "hidden md:flex")}>
          <header className="flex h-12 shrink-0 items-center gap-2 px-3 shadow-[inset_0_-1px_0_var(--line)] md:px-4">
            <IconButton label="Channels" className="md:hidden" onClick={onBack}>
              <Icon icon={ArrowLeft01Icon} size={20} />
            </IconButton>
            <ChannelIconTile icon={icon} title={title} size={20} />
            {/* One line: the channel, the room you're in (rooms are the chat's; tasks are channel-wide), who's here. */}
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <h1 className="min-w-0 truncate text-title font-semibold tracking-[-0.015em]">
                {title}
                {manyRooms && tab === "chat" && !filter && <span className="font-normal text-ink-3"> / #{state.rooms.get(rooms.active)?.name}</span>}
              </h1>
              <span className="hidden shrink-0 sm:flex">
                <People here={here} subtitle={subtitle} live={connection === "live"} />
              </span>
            </div>
            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                { value: "chat", label: "Chat" },
                { value: "tasks", label: <>Work{openTasks > 0 && <span className="text-ink-3 tabular-nums">{openTasks}</span>}</> },
              ]}
            />
            <span className="mx-1 hidden h-4 w-px bg-line md:block" />
            <InviteButton />
            <IconButton label="Search" round active={search !== null} onClick={() => setSearch((s) => (s === null ? "" : null))} disabled={tab !== "chat"}>
              <Icon icon={Search01Icon} size={17} />
            </IconButton>
            <ChannelMenu />
          </header>

          <HoldBanner />
          <RequestsBanner />

          {openTask !== null ? (
            <TaskPage
              id={openTask}
              state={state}
              messages={messages}
              me={me}
              now={now}
              onOpen={setOpenTask}
              onClose={() => setOpenTask(null)}
              noteBlocked={state.members.get(me)?.scopes.includes("tasks") === false ? "The owner hasn’t let you change tasks here, so you can’t comment on one." : null}
              onNote={async (note) => void (await send(`noted on ${taskId(openTask)}`, { kind: "event", ev: { op: "task.update", task: openTask, note } }))}
            />
          ) : tab === "tasks" ? (
            <Tasks
              top={
                <WorkOverview
                  state={state}
                  messages={messages}
                  me={me}
                  now={now}
                  online={online}
                  onOpenTask={setOpenTask}
                  onOpenMessage={(seq) => {
                    setTab("chat")
                    jump(seq)
                  }}
                />
              }
              state={state}
              now={now}
              onOpen={setOpenTask}
              onForgetFact={async (key) => void (await send(`cleared ${key}`, { kind: "event", ev: { op: "fact.del", key } }))}
            />
          ) : (
            <>
              {search !== null && (
                <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pt-3 md:px-8">
                  <TextField
                    autoFocus
                    value={search}
                    placeholder="Search messages"
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setSearch(null)}
                  />
                </div>
              )}
              {/* One row of quiet tabs, like the header's; on a phone it scrolls sideways instead of wrapping. */}
              <div className="mx-auto flex w-full max-w-[760px] shrink-0 flex-nowrap items-center gap-1 overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none] md:px-8">
                {manyRooms && <RoomMenu state={state} active={rooms.active} unread={rooms.unread} onOpen={(id) => (rooms.open(id), setFilter(undefined), setThreadRoot(null))} />}
                {chips.map((c) => {
                  const on = c.f === null ? filter === null : filter?.kind === c.f.kind
                  return (
                    <button
                      key={c.label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFilter(c.f)}
                      className={cx(
                        "flex h-7 shrink-0 items-center gap-1.5 rounded-ctl px-2.5 text-ui font-medium transition-colors",
                        on ? "bg-wash-2 text-ink" : "text-ink-3 hover:text-ink"
                      )}
                    >
                      {c.label}
                      {!!c.n && <span className="tabular-nums opacity-70">{c.n}</span>}
                    </button>
                  )
                })}
                {filter?.kind === "from" && (
                  <button
                    type="button"
                    onClick={() => setFilter(null)}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-ctl bg-wash-2 pr-2 pl-2.5 text-ui font-medium text-ink"
                    title="Show everything"
                  >
                    {filterLabel}
                    <Icon icon={Cancel01Icon} size={12} />
                  </button>
                )}
              </div>

              <div
                ref={scroller}
                className="flex-1 overflow-y-auto"
                onScroll={(e) => {
                  const el = e.currentTarget
                  atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
                  if (atBottom.current && behind) setBehind(0)
                }}
              >
                {connection === "connecting" && messages.length === 0 ? (
                  <Centered>
                    <Spinner />
                  </Centered>
                ) : visible.length === 0 ? (
                  <Centered>
                    <p className="text-body font-semibold">{search ? "No results" : filter ? "Nothing here" : "No messages yet"}</p>
                    <p className="mt-1 max-w-xs text-ui leading-normal text-ink-2">
                      {search
                        ? `No message mentions “${search}”.`
                        : filter
                          ? "Clear the filter to see the whole conversation."
                          : "Invite an agent with the Invite button above. What it says shows up here the moment it’s sent."}
                    </p>
                  </Centered>
                ) : (
                  <div className="mx-auto w-full max-w-[760px] px-4 pb-6 md:px-8">{rows}</div>
                )}
              </div>

              {behind > 0 && (
                <button
                  type="button"
                  onClick={toBottom}
                  className="animate-rise absolute bottom-[132px] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-raised py-1.5 pr-3.5 pl-2.5 text-ui font-medium shadow-pop"
                >
                  <Icon icon={ArrowDown01Icon} size={15} />
                  {behind === 1 ? "1 new message" : `${behind} new messages`}
                </button>
              )}

              <Composer
                me={me}
                people={people}
                replyTo={replyTo}
                nameOf={nameOf}
                onClearReply={() => setReplyTo(null)}
                disabled={connection === "connecting"}
                route={coordinator ? { coordinator, label: nameOf(coordinator), view: filter?.kind === "coordinator" ? "coordinator" : "everything" } : undefined}
                room={rooms.active}
                roomLabel={manyRooms ? state.rooms.get(rooms.active)?.name : undefined}
                send={async (body, opts) => {
                  atBottom.current = true
                  return send(body, opts)
                }}
              />
            </>
          )}
        </div>

        {root && (
          <ThreadPanel
            count={replies.length}
            onClose={() => setThreadRoot(null)}
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
                route={coordinator ? { coordinator, label: nameOf(coordinator), view: "everything" } : undefined}
                room={roomOfMessage(state, root)}
              />
            }
          >
            {threadRows}
          </ThreadPanel>
        )}

        {roomDialog && (
          <RoomDialog
            state={state}
            room={roomDialog.room}
            onClose={() => setRoomDialog(null)}
            onSave={async (name) => {
              const edit = roomDialog.room
              const id = edit?.id ?? newRoomId()
              const ev = edit ? ({ op: "room.rename", id, name } as const) : ({ op: "room.create", id, name } as const)
              const since = await send(edit ? `renamed #${edit.name} to #${name}` : `made the room #${name}`, { kind: "event", ev })
              // Then the channel's settings carry the list too, for views holding only the log's tail:
              // every room but general, and general only once it has a name of its own.
              const list = [...state.rooms.values()].map((r) => (r.id === id ? { id, name } : { id: r.id, name: r.name }))
              if (!edit) list.push({ id, name })
              await ch.setRooms({ list: list.filter((r) => r.id !== GENERAL_ROOM || r.name !== GENERAL_ROOM), since })
              if (!edit) {
                rooms.open(id)
                setFilter(undefined)
              }
            }}
          />
        )}
      </div>
    </ChannelControls>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-60 flex-1 flex-col items-center justify-center p-8 text-center">{children}</div>
}
