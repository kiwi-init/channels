import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"

import type { SendOptions } from "@kiwi/core/client.ts"
import { permissionReply } from "@kiwi/core/permission.ts"
import { droppedCount } from "@kiwi/core/format.ts"
import { memberLoad } from "@kiwi/core/load.ts"
import { GENERAL_ROOM, PROTOCOL_VERSION, isReaction, type ImageAttachment, type Message } from "@kiwi/core/protocol.ts"
import { taskCards } from "@kiwi/core/standup.ts"
import { answersDecisions, colorOf, decidersOf, heldBy, outsideRepos, taskId, tasksAwaitingPeople, type Task, humanOf, ownerOf } from "@kiwi/core/state.ts"
import { channelTitle, loadRecent, useChannel, useClock, useKnownChannels, type StoredMember } from "@/lib/channel"
import { howHere } from "@/lib/presence"
import { sendsInTurn, withSentQuotes } from "@/lib/send-order"
import { asksFor, chosenOf, heldAsks } from "@/lib/asks"
import type { Command } from "@/lib/commands"
import { approveTask, closedDigest, reviewsFor, sendBackTask, type TaskSend } from "@/lib/task-actions"
import { useIcons, useLiveIcon } from "@/lib/icons"
import { memberName } from "@/lib/format"
import { MentionNames } from "@/lib/mentions"
import { dmPlace, MAIN, placeFromKey, placeKey, sendFrom, type Place } from "@/lib/threads"
import { mergedSince, startOfDay, viewCounts, VIEWS, type Tab, type View } from "@/lib/views"
import { cx } from "@/lib/utils"
import { useHeight } from "@/hooks/use-height"
import { Composer } from "../composer"
import { RoomChips } from "../room-chips"
import { AgentStrip, agentNow, type AgentNow } from "../agent-strip"
import { ChannelControls } from "../controls"
import { Icon } from "../icon"
import { Button, Harnesses, Pictures, Spinner, errorText, toast } from "../kit"
import { AddAgent, AgentLanes, CompactBlock, HoldDialog, NewAgent, Presence, ProposalCard, TasksView } from "../lazy"
import { canStartAgents } from "@/lib/launches"
import { markOnce } from "@/lib/marks"
import { ALLOW_ONCE, DENY, settledOf } from "@/lib/permission-settled"
import { isAgent } from "../message"
import { NeedsYou } from "../needs-you"
import { ChannelSidebar, ConversationMenu, type Conversation as ConversationRow } from "./channel-sidebar"
import { Header } from "./header"
import { InfoSide, PictureSide, TasksSide, ThreadSide } from "./side-panels"
import { Centered, rowMakers, threadRowsOf } from "./timeline"
import type { Side } from "./types"
import { useControlsHandlers } from "./use-controls-handlers"
import { useChannelNews, useRecentPreview } from "./use-news"
import { useHarnesses } from "./use-harnesses"
import { usePictures, usePublishPicture } from "./use-picture"
import { usePlaces } from "./use-places"
import { useScroll } from "./use-scroll"
import { useThreads } from "./use-threads"
import { useWindow } from "./use-window"
import { useLatest } from "@/lib/use-latest"
import { useLater } from "@/hooks/use-later"

function useNow(intervalMs = 30_000): number {
  return useClock(intervalMs)
}

export function Conversation({ member, onBack, onGone }: { member: StoredMember; onBack: () => void; onGone: () => void }) {
  const me = member.identity.name
  const live = useChannel(member)
  useEffect(() => {
    if (live.snapshotTooBig) toast("Too big to snapshot: this channel loads slowly. Tell the Kiwi team.", "error")
  }, [live.snapshotTooBig])
  const { ch, connection, gone, messages, roster, state, online, isOwner, requests, send, head, marks, pkOf, ready } = live
  const slowToConnect = useLater(connection === "connecting")
  const slowToOpen = useLater(!ready)
  const pictures = usePictures(state)
  const harnesses = useHarnesses(state, requests)
  usePublishPicture(state, me, connection !== "connecting", send)
  useLiveIcon(member)
  const roomId = member.access.roomId
  const icon = useIcons().get(roomId) ?? null
  const now = useNow()
  const [here, setHere] = useState<string>("main")
  const [cardRoom, setCardRoom] = useState<string>(GENERAL_ROOM)
  const [side, setSide] = useState<Side>(null)
  const [tab, setTab] = useState<Tab>("conversation")
  const [view, setView] = useState<View>("everything")
  const [earlier, setEarlier] = useState(false)
  const sideRoot = side?.kind === "thread" ? side.root : null
  const info = side?.kind === "info"
  const shownTask = side?.kind === "tasks" ? side.task : null
  const openThread = useCallback((root: number) => setSide({ kind: "thread", root }), [])
  const openTask = useCallback((task: number) => setSide({ kind: "tasks", task }), [])
  const [pausing, setPausing] = useState(false)
  const [search, setSearch] = useState<string | null>(null)
  const query = useDeferredValue(search?.trim() ? search : null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [sending, setSending] = useState<{ key: number; place: string; m: Message; after: number; seq?: number }[]>([])
  const [sendingBase] = useState(() => Date.now())
  const sendingKey = useRef(0)
  const [inTurn] = useState(sendsInTurn)
  const sendingSeq = useRef(new Map<number, Promise<number>>())
  const [picture, setPicture] = useState<{ m: Message; img: ImageAttachment; src: string } | null>(null)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [headRef, headH] = useHeight()
  const [footRef, footH] = useHeight()

  const names = useMemo(() => JSON.stringify([...state.members].map(([name, m]) => [name, memberName(m, name)])), [state.members])
  const nameOf = useMemo(() => {
    const byName = new Map(JSON.parse(names) as [string, string][])
    return (name: string) => byName.get(name) ?? name
  }, [names])
  const labelOf = useMemo(() => {
    const byName = new Map(JSON.parse(names) as [string, string][])
    return (name: string) => byName.get(name)
  }, [names])
  const byKey = useMemo(() => new Map(roster.map((r) => [r.pk, r])), [roster])
  const memberCount = roster.filter((r) => r.active).length || state.members.size
  const active = useMemo(() => [...state.members.values()].filter((m) => m.active), [state.members])
  const others = useMemo(() => active.filter((m) => m.name !== me), [active, me])
  const people = useMemo(() => active.map((m) => ({ name: m.name, label: memberName(m), agent: isAgent(m), color: colorOf(state, m.name) })), [active, state])
  const known = useKnownChannels()
  const title = channelTitle(
    { name: known.find((c) => c.code === member.code)?.name ?? member.name },
    others.length ? { from: "", text: "", ts: 0, people: others.map((m) => memberName(m)) } : loadRecent(member.code)
  )
  const iAmPerson = !isAgent(state.members.get(me))

  const arrivals = useMemo(() => messages.filter((m) => m.from !== me && !isReaction(m)).length, [messages, me])
  const cards = useMemo(() => taskCards(state, messages), [state, messages])
  const { decisions, escalations, questions } = useMemo(() => asksFor(heldAsks(state), me, answersDecisions(state.members, me)), [state, me])
  const reviews = useMemo(() => reviewsFor(state.tasks.values(), me, iAmPerson), [state.tasks, me, iAmPerson])
  const needsMe = decisions.length + escalations.length + questions.length + reviews.length + (isOwner ? requests.length : 0)
  useChannelNews(roomId, Math.max(head, messages.at(-1)?.seq ?? 0), arrivals, 0, needsMe)
  const sendTask = useCallback(
    async (...sends: TaskSend[]) => {
      for (const { body, opts } of sends) await send(body, opts)
    },
    [send]
  )
  const noAgents = ready && !active.some((m) => isAgent(m))
  const quiet = noAgents && !messages.some((m) => m.kind !== "event")

  useRecentPreview({ member, messages, others, state, me, nameOf })

  const { placeOf, places } = state
  const { place, hereKey, unreadIn, taskKey } = usePlaces({ here, roomId, messages, me, state, shownTask })
  const openRoom = hereKey === "main" && state.rooms.size > 1 ? cardRoom : null
  const sendRoom = openRoom !== null && openRoom !== GENERAL_ROOM ? openRoom : undefined
  const { bySeq, threadRoot, showDropped, setShowDropped, threads, visible, inTask, quoted, summaryOf } = useThreads({
    messages,
    state,
    me,
    sideRoot,
    isOwner,
    search: query,
    hereKey,
    room: openRoom,
    taskKey,
    shownTask,
    nameOf,
  })
  const { behind, setBehind, isFresh, scroller, stick, theirs, toBottom, onScroll } = useScroll({ messages, visible, hereKey })
  const anyShown = visible.length > 0
  useEffect(() => {
    if (anyShown) requestAnimationFrame(() => markOnce("kiwi:first-message"))
  }, [anyShown])
  const landed = useCallback(
    (s: { m: Message; after: number; seq?: number }) => (s.seq !== undefined ? bySeq.get(s.seq) : messages.findLast((x) => x.seq > s.after && x.from === me && x.body === s.m.body)),
    [bySeq, messages, me]
  )
  const sentNow = sending.map((s) => ({ s, real: landed(s) }))
  const replaced = new Set(sentNow.flatMap(({ real }) => (real ? [real.seq] : [])))
  const sendingHere = sentNow.filter(({ s, real }) => s.place === hereKey && !real).map(({ s }) => s.m)
  const quotedHere = useCallback((seq: number) => (seq < 0 ? sending.find((s) => s.key === -seq)?.m : quoted(seq)), [quoted, sending])

  const go = useCallback(
    (p: Place) => {
      if (p.kind === "task") return openTask(p.task)
      setTab("conversation")
      setHere(placeKey(p))
      setBehind(0)
      setSide((s) => (s?.kind === "tasks" ? s : null))
      setReplyTo(null)
      setSearch(null)
    },
    [openTask, setBehind]
  )

  const jump = useCallback(
    (seq: number) => {
      setHighlight(seq)
      setTimeout(() => setHighlight((h) => (h === seq ? null : h)), 1600)
      if (state.compact && seq <= state.compact.through) setEarlier(true)
      const at = placeOf.get(seq)
      const inTask = at?.kind === "task" ? at.task : null
      if (inTask !== null) openTask(inTask)
      else if (at && placeKey(at) !== hereKey) setHere(placeKey(at))
      setSearch(null)
      const find = (left: number) => {
        const el = document.getElementById(`${inTask !== null ? "k" : "m"}${seq}`)
        if (!el) {
          if (left > 0) requestAnimationFrame(() => find(left - 1))
          return
        }
        theirs()
        el.scrollIntoView({ block: "center", behavior: "smooth" })
      }
      requestAnimationFrame(() => requestAnimationFrame(() => find(3)))
    },
    [placeOf, hereKey, openTask, state.compact, theirs]
  )

  const onReply = useCallback((m: Message) => setReplyTo(m), [])
  const decided = useMemo(() => new Set(decisions.map((m) => m.seq)), [decisions])
  const repliesTo = useMemo(() => {
    const out = new Map<number, Message[]>()
    for (const m of messages) for (const seq of m.re ?? []) out.set(seq, [...(out.get(seq) ?? []), m])
    return out
  }, [messages])
  const chosen = useCallback((m: Message) => (m.choices?.length ? chosenOf(m, repliesTo.get(m.seq) ?? [], decidersOf(state, m)) : undefined), [repliesTo, state])
  const composerAsks = useMemo(() => decisions.filter((m) => !m.permission), [decisions])
  const permissionSettled = useCallback((m: Message) => (m.permission ? settledOf(m, repliesTo.get(m.seq) ?? [], state, bySeq) : undefined), [repliesTo, state, bySeq])
  const answer = useCallback(
    (m: Message, text: string): Promise<boolean> =>
      send(text, { to: [m.from], re: [m.seq], kind: "msg" }).then(
        () => (toast(`Answered ${nameOf(m.from)}`), true),
        (err) => (toast(`Not sent: ${errorText(err)}`, "error"), false)
      ),
    [send, nameOf]
  )
  const onAnswer = useLatest(answer)
  const onJump = useLatest(jump)
  const onOpenImage = useLatest((pm: Message, img: ImageAttachment, src: string) => setPicture({ m: pm, img, src }))
  const roomsNow = useLatest(() => state.rooms)
  const handlers = useControlsHandlers({ live, member, onGone, rooms: roomsNow })
  const [newAgent, setNewAgent] = useState(false)
  const onNewAgent = isOwner && canStartAgents() ? () => setNewAgent(true) : undefined
  const addsAgents = !isOwner && !!roster.find((m) => m.active && m.pk === member.identity.pk)?.addsAgents
  const hold = handlers.onHold
  const commands = useMemo<Command[]>(
    () => [
      { name: "tasks", summary: "Open the tasks", run: () => setTab("tasks") },
      ...(hold && !state.hold ? [{ name: "pause", summary: "Pause the agents", args: "note", run: (note: string) => hold(true, note || undefined) }] : []),
      ...(hold && state.hold ? [{ name: "resume", summary: "Let the agents work again", run: () => hold(false) }] : []),
      {
        name: "compact",
        summary: "Ask for a summary to fold the history behind",
        run: async () => {
          const lead = state.lead && state.lead !== me ? state.lead : null
          try {
            await send(
              "Please draft a /compact summary of the history so far: name every open task (T7) and open question (#123) by its id, then run kiwi compact --file summary.md. I'll approve it here.",
              lead ? { to: [lead], kind: "ask" } : { kind: "ask" }
            )
            toast(lead ? `Asked ${nameOf(lead)} for a summary` : "Asked the agents for a summary")
          } catch (err) {
            toast(`Not sent: ${errorText(err)}`, "error")
          }
        },
      },
    ],
    [hold, state.hold, state.lead, me, send, nameOf]
  )

  const folded = hereKey === "main" && !search && state.compact ? state.compact : null
  const shown = folded && !earlier ? visible.filter((m) => m.seq > folded.through) : visible
  const { tail, hidden, more, onScrolled } = useWindow(shown, query ? `${hereKey}\u0000${query}` : hereKey, scroller, highlight, tab === "conversation")

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

  const lastMine = visible.findLast((m) => m.from === me && m.kind !== "event" && m.kind !== "done")?.seq
  const lastMineReply = threadRoot === null ? undefined : (threads.get(threadRoot) ?? []).findLast((m) => m.from === me && m.kind !== "event")?.seq
  const showsReceipt = (m: Message, anchor: string | undefined): boolean => (anchor === undefined && m.seq === lastMine) || (anchor === "t" && m.seq === lastMineReply)
  const { bubble, timeline } = rowMakers({
    me,
    state,
    byKey,
    online,
    marks,
    pkOf,
    image: ch.image,
    now,
    hereKey,
    cardRoom,
    cards,
    search: query,
    highlight,
    bySeq,
    quoted: quotedHere,
    chosen,
    nameOf,
    isFresh: (seq: number) => seq < 0 || (isFresh(seq) && !replaced.has(seq)),
    summaryOf,
    showsReceipt,
    onReply,
    decisions: decided,
    banner: place.kind === "main" ? (composerAsks[0]?.seq ?? null) : null,
    onAnswer,
    settledOf: permissionSettled,
    onJump,
    openThread,
    openTask,
    onOpenImage,
  })
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
  const proposal = hereKey === "main" && !search ? state.compactProposal : null
  if (folded) rows.push(<CompactBlock key="compact" compact={folded} byName={nameOf(folded.by)} earlier={earlier} onToggle={() => setEarlier((v) => !v)} />)
  const at = proposal ? tail.findIndex((m) => m.seq === proposal.seq) : -1
  const approve =
    proposal && isOwner
      ? () =>
          send(`compacted the history through #${proposal.through}`, { kind: "event", ev: { op: "compact", summary: proposal.summary, through: proposal.through, proposal: proposal.seq } }).then(
            () => undefined
          )
      : undefined
  const card = proposal ? <ProposalCard key="proposal" proposal={proposal} byName={nameOf(proposal.by)} approve={approve} /> : null
  if (hidden)
    rows.push(
      <div key="earlier" className="py-3 text-center">
        <button type="button" onClick={more} className="text-ui font-medium text-accent-text hover:underline">
          Earlier messages
        </button>
      </div>
    )
  if (tab === "conversation") {
    if (card && at >= 0) rows.push(...timeline(tail.slice(0, at)), card, ...timeline([...tail.slice(at + 1), ...sendingHere]))
    else rows.push(...timeline([...tail, ...sendingHere]), ...(card ? [card] : []))
  }

  const root = threadRoot === null ? undefined : bySeq.get(threadRoot)
  const replies = threadRoot === null ? [] : (threads.get(threadRoot) ?? [])
  const threadRows = threadRowsOf(root, replies, bubble)
  const taskRows = shownTask === null ? [] : timeline(inTask, "k")

  const subtitle =
    connection === "connecting" && slowToConnect
      ? "Connecting…"
      : connection === "reconnecting"
        ? "Reconnecting…"
        : !ready
          ? ""
          : online.size
            ? `${memberCount} members, ${online.size} online`
            : `${memberCount} ${memberCount === 1 ? "member" : "members"}`
  const lastAt = new Map<string, number>()
  for (const m of messages) if (m.kind !== "event") lastAt.set(m.from, m.ts)
  const agentsNow: AgentNow[] = active
    .filter((m) => isAgent(m))
    .map((m) => ({
      name: m.name,
      label: memberName(m),
      color: colorOf(state, m.name),
      here: howHere(online.get(m.name)),
      lead: m.name === state.lead,
      model: m.runs?.model ?? online.get(m.name)?.activity?.model ?? m.card?.model,
      activity: online.get(m.name)?.activity,
      load: memberLoad(state, m.name),
      lastAt: lastAt.get(m.name),
      card: m.card,
      outside: outsideRepos(state, m.card),
    }))
  const working = agentsNow.filter((a) => agentNow(a).busy).length
  const statusOf = (name: string) => {
    const a = agentsNow.find((x) => x.name === name)
    return a ? agentNow(a) : undefined
  }
  const placeTitle = place.kind === "main" ? title : place.with.includes(me) ? nameOf(place.with.find((n) => n !== me) ?? me) : place.with.map(nameOf).join(" & ")
  const mayWrite = place.kind !== "dm" || place.with.includes(me)
  const extra = place.kind === "main" ? undefined : sendFrom(state, place, me)
  const task = shownTask === null ? undefined : state.tasks.get(shownTask)
  const waiting = tasksAwaitingPeople(state)
  const counts = viewCounts(state, now, needsMe, waiting)
  const merged = mergedSince(state, startOfDay(now))
  const status =
    (connection === "connecting" && slowToConnect) || connection === "reconnecting"
      ? [subtitle]
      : !ready
        ? []
        : [working ? `${working} working` : null, merged ? `${merged} merged today` : null, needsMe ? `${needsMe} ${needsMe === 1 ? "needs" : "need"} you` : null].filter((x): x is string => !!x)
  const agentCount = active.filter((m) => isAgent(m)).length
  const personCount = active.length - agentCount
  const peopleLine = [agentCount ? `${agentCount} ${agentCount === 1 ? "agent" : "agents"}` : null, personCount ? `${personCount} ${personCount === 1 ? "person" : "people"}` : null]
    .filter(Boolean)
    .join(" · ")
  const rooms = [...state.rooms.values()]
  const roomKey = (id: string) => `room:${id}`
  const conversations: ConversationRow[] = [
    ...(rooms.length > 1
      ? rooms.map((r) => ({ key: roomKey(r.id), label: `# ${r.name}`, unread: r.id === GENERAL_ROOM ? unreadIn("main").n : 0, forMe: r.id === GENERAL_ROOM && unreadIn("main").forMe, withMe: true }))
      : [{ key: "main", label: `# ${GENERAL_ROOM}`, unread: unreadIn("main").n, forMe: unreadIn("main").forMe, withMe: true }]),
    ...[...places]
      .filter(([, p]) => p.place.kind === "dm")
      .map(([key, p]) => {
        const w = p.place.kind === "dm" ? p.place.with : ["", ""]
        const u = unreadIn(key)
        const withMe = w.includes(me)
        return { key, label: withMe ? nameOf(w.find((n) => n !== me) ?? me) : w.map(nameOf).join(" & "), unread: u.n, forMe: u.forMe, withMe }
      }),
  ]
  const currentConversation = tab !== "conversation" ? null : hereKey !== "main" ? hereKey : rooms.length > 1 ? roomKey(cardRoom) : "main"
  const leaveInfo = () => setSide((s) => (s?.kind === "info" ? null : s))
  const openConversation = (key: string) => {
    setTab("conversation")
    if (key.startsWith("room:")) {
      setCardRoom(key.slice(5))
      go(MAIN)
      return
    }
    go(placeFromKey(key) ?? MAIN)
  }
  const roomName = state.rooms.get(cardRoom)?.name ?? GENERAL_ROOM
  const needsYou = (
    <NeedsYou
      now={now}
      roomId={roomId}
      me={me}
      decisions={decisions}
      escalations={escalations}
      questions={questions}
      reviews={reviews}
      nameOf={nameOf}
      agentOf={(name) => isAgent(state.members.get(name))}
      heldOf={(m) => heldBy(state, m).map((id) => (state.tasks.has(id) ? taskId(id) : `#${id}`))}
      onReply={async (m, text) => void (await send(text, { to: [m.from], re: [m.seq], kind: "msg" }))}
      permissionOf={(m) => ({ human: humanOf(state, m.from), owner: ownerOf(state) })}
      onPermission={async (m, allow) => {
        const perm = permissionReply(m, allow, state)
        if (!perm) throw new Error("this one can only be answered in the terminal")
        await send(allow ? ALLOW_ONCE : DENY, { to: [m.from], re: [m.seq], kind: "msg", perm })
      }}
      onApproveTask={(t: Task) => sendTask(approveTask(t), closedDigest(state, messages, t, { by: me }))}
      onSendBack={(t: Task, why: string) => sendTask(sendBackTask(t, why))}
      onOpenTask={openTask}
      onJump={jump}
      titled={tab === "tasks" && view === "needs"}
    />
  )
  const heading = tab === "tasks" ? (VIEWS.find(([v]) => v === view)?.[1] ?? "Tasks") : tab === "agents" ? "Agents" : place.kind === "dm" ? placeTitle : rooms.length > 1 ? `# ${roomName}` : title

  return (
    <Pictures.Provider value={pictures}>
      <Harnesses.Provider value={harnesses}>
        <MentionNames.Provider value={labelOf}>
          <ChannelControls
            code={member.code}
            myKey={member.identity.pk}
            isOwner={isOwner}
            roster={roster}
            requests={requests}
            online={online}
            statusOf={statusOf}
            state={state}
            now={now}
            roomId={member.access.roomId}
            title={title}
            {...handlers}
          >
            {onNewAgent && <NewAgent open={newAgent} onClose={() => setNewAgent(false)} code={member.code} roomId={roomId} channel={title} lead={state.lead} onPin={handlers.onPin} roster={roster} />}
            <div className="relative flex h-full min-w-0 flex-1">
              <ChannelSidebar
                title={title}
                icon={icon}
                people={peopleLine}
                onTitle={() => setSide((s) => (s?.kind === "info" ? null : { kind: "info" }))}
                search={search}
                onSearch={(q) => {
                  if (q !== null) setTab("conversation")
                  if (q !== null) leaveInfo()
                  setSearch(q)
                }}
                onAgents={() => {
                  leaveInfo()
                  setTab("agents")
                  setSearch(null)
                }}
                onNewAgent={onNewAgent}
                view={tab === "tasks" ? view : null}
                counts={counts}
                onView={(v) => {
                  leaveInfo()
                  setView(v)
                  setTab("tasks")
                  setSearch(null)
                }}
                agents={agentsNow}
                onMessage={(name) => (leaveInfo(), go(dmPlace(me, name)))}
                onOpenTask={openTask}
                conversations={conversations}
                current={currentConversation}
                onConversation={(key) => (leaveInfo(), openConversation(key))}
              />
              <div className={cx("@container relative flex min-w-0 flex-1 md:sheet", info ? "hidden" : (root || side?.kind === "tasks") && "hidden md:flex")}>
                <div className="relative flex min-w-0 flex-1 flex-col bg-canvas" style={{ "--head": `${headH}px`, "--foot": `${footH}px` } as CSSProperties}>
                  <Header
                    headRef={headRef}
                    onBack={onBack}
                    search={search}
                    setSearch={setSearch}
                    tab={tab}
                    onTab={(t) => {
                      setTab(t)
                      if (t !== "conversation") setSearch(null)
                    }}
                    heading={heading}
                    wideHeading={place.kind === "dm" ? placeTitle : rooms.length > 1 ? `# ${roomName}` : title}
                    headingLabel={`Details: ${title}${subtitle ? `, ${subtitle}` : ""}`}
                    face={{ icon, title }}
                    status={status}
                    onTitle={() => setSide((s) => (s?.kind === "info" ? null : { kind: "info" }))}
                    searchHint={place.kind === "main" ? "Search this channel" : `Search ${placeTitle}`}
                    places={<ConversationMenu conversations={conversations} current={currentConversation} onConversation={(key) => (leaveInfo(), openConversation(key))} />}
                  />

                  {pausing && hold && <HoldDialog onClose={() => setPausing(false)} onSave={(note) => hold(true, note)} />}

                  {tab === "tasks" || tab === "agents" ? (
                    <div className="absolute inset-0 overflow-y-auto pt-[calc(var(--head)+8px)]">
                      <div className={cx("mx-auto w-full aside-room px-2 md:px-4", tab === "tasks" && "max-w-[960px] [--column:960px]")}>
                        {!ready ? (
                          slowToOpen && (
                            <Centered>
                              <Spinner />
                            </Centered>
                          )
                        ) : tab === "tasks" ? (
                          <TasksView
                            state={state}
                            now={now}
                            view={view}
                            agents={agentsNow}
                            needs={needsMe ? needsYou : null}
                            empty={noAgents ? <AddAgent code={member.code} isOwner={isOwner} addsAgents={addsAgents} onNewAgent={onNewAgent} /> : null}
                            open={shownTask}
                            onOpen={openTask}
                          />
                        ) : agentsNow.length ? (
                          <AgentLanes agents={agentsNow} state={state} messages={messages} now={now} nameOf={nameOf} onOpenTask={openTask} />
                        ) : (
                          <AddAgent code={member.code} isOwner={isOwner} addsAgents={addsAgents} onNewAgent={onNewAgent} />
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        ref={scroller}
                        className="absolute inset-0 overflow-y-auto"
                        onScroll={(e) => {
                          onScroll(e)
                          onScrolled(e.currentTarget)
                        }}
                      >
                        <div className="relative mx-auto w-full max-w-[792px] aside-room px-4 pt-[calc(var(--head)+8px)] pb-[calc(var(--foot)+16px)] [--column:792px]">
                          {hereKey === "main" && needsYou}
                          {hereKey === "main" && state.rooms.size > 1 && !search && <RoomChips rooms={[...state.rooms.values()]} value={cardRoom} onChange={setCardRoom} />}
                          {!ready && messages.length === 0 ? (
                            slowToOpen && (
                              <Centered>
                                <Spinner />
                              </Centered>
                            )
                          ) : hereKey === "main" && noAgents && !search ? (
                            <>
                              <AddAgent code={member.code} isOwner={isOwner} addsAgents={addsAgents} onNewAgent={onNewAgent} />
                              {!quiet && rows}
                            </>
                          ) : visible.length === 0 ? (
                            <Centered>
                              <p className="text-body font-semibold">{search ? "No results" : "No messages yet"}</p>
                              <p className="mt-1 max-w-xs text-ui leading-normal text-ink-2">
                                {search
                                  ? `No message here mentions “${search}”.`
                                  : place.kind === "dm"
                                    ? "What these two say to each other shows up here."
                                    : "What’s said here shows up the moment it’s sent."}
                              </p>
                            </Centered>
                          ) : (
                            rows
                          )}
                        </div>
                      </div>

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

                      <div ref={footRef} className="absolute inset-x-0 bottom-0 z-20">
                        <div aria-hidden className="scrim-bottom absolute inset-x-0 -top-6 bottom-0" />
                        <div className="relative aside-room [--column:792px]">
                          {mayWrite ? (
                            <Composer
                              key={`${hereKey}:${sendRoom ?? ""}`}
                              draftKey={`${roomId}:${hereKey}${sendRoom ? `:${sendRoom}` : ""}`}
                              me={me}
                              people={people}
                              replyTo={replyTo}
                              commands={commands}
                              asking={place.kind === "main" ? composerAsks[0] : undefined}
                              more={Math.max(composerAsks.length - 1, 0)}
                              onAnswer={answer}
                              nameOf={nameOf}
                              onClearReply={(answered) => setReplyTo((now) => (!answered || now === answered ? null : now))}
                              onRestoreReply={(answering) => setReplyTo((now) => now ?? answering)}
                              disabled={connection === "connecting"}
                              extra={extra}
                              placeholder={
                                place.kind === "main" ? (rooms.length > 1 ? `Message #${roomName}` : "Message everyone") : `Message ${nameOf(place.with.find((n) => n !== me) ?? "")} privately`
                              }
                              send={async (body, given) => {
                                stick()
                                const opts: SendOptions = sendRoom && given.task === undefined ? { ...given, room: sendRoom } : given
                                const answering = (o: SendOptions) => withSentQuotes(o, (k) => sendingSeq.current.get(k))
                                if (opts.imgs?.length || opts.task !== undefined) return inTurn(async () => send(body, await answering(opts)))
                                const key = sendingBase + ++sendingKey.current
                                const m: Message = {
                                  v: PROTOCOL_VERSION,
                                  id: `sending-${key}`,
                                  from: me,
                                  kind: opts.kind ?? "msg",
                                  body,
                                  ts: Date.now(),
                                  seq: -key,
                                  sigOk: true,
                                  ...(opts.to ? { to: opts.to } : {}),
                                  ...(opts.re ? { re: opts.re } : {}),
                                  ...(opts.dm ? { dm: true } : {}),
                                  ...(opts.room ? { room: opts.room } : {}),
                                }
                                setSending((all) => [...all, { key, place: hereKey, m, after: messages.at(-1)?.seq ?? 0 }].slice(-50))
                                const going = inTurn(async () => send(body, await answering(opts)))
                                sendingSeq.current.set(key, going)
                                sendingSeq.current.delete(key - 50)
                                try {
                                  const seq = await going
                                  setSending((all) => all.map((s) => (s.key === key ? { ...s, seq } : s)))
                                  return seq
                                } catch (err) {
                                  setSending((all) => all.filter((s) => s.key !== key))
                                  throw err
                                }
                              }}
                              footer={
                                <div className="md:hidden">
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
                    </>
                  )}
                </div>
              </div>

              {picture && <PictureSide picture={picture} nameOf={nameOf} state={state} mayWrite={mayWrite} me={me} extra={extra} send={send} onClose={() => setPicture(null)} />}

              {info && (
                <InfoSide
                  title={title}
                  icon={icon}
                  subtitle={subtitle}
                  onClose={() => setSide(null)}
                  onPause={hold && !state.hold ? () => setPausing(true) : undefined}
                  onMessage={(name) => go(dmPlace(me, name))}
                  onJoins={() => {
                    setSide(null)
                    setView("everything")
                    setTab("tasks")
                  }}
                  onNewAgent={onNewAgent}
                  state={state}
                  now={now}
                  send={send}
                />
              )}

              <Presence>
                {root && (
                  <ThreadSide
                    key="thread"
                    root={root}
                    count={replies.length}
                    rows={threadRows}
                    onClose={() => setSide(null)}
                    me={me}
                    people={people}
                    nameOf={nameOf}
                    connecting={connection === "connecting"}
                    send={send}
                  />
                )}
                {side?.kind === "tasks" && (
                  <TasksSide
                    key="tasks"
                    side={side}
                    setSide={setSide}
                    task={task}
                    taskKey={taskKey}
                    inTask={inTask}
                    rows={taskRows}
                    me={me}
                    people={people}
                    nameOf={nameOf}
                    connecting={connection === "connecting"}
                    send={send}
                    sendTask={sendTask}
                    githubDiff={ch.githubDiff}
                    state={state}
                    messages={messages}
                    now={now}
                    highlight={highlight}
                    iAmPerson={iAmPerson}
                  />
                )}
              </Presence>
            </div>
          </ChannelControls>
        </MentionNames.Provider>
      </Harnesses.Provider>
    </Pictures.Provider>
  )
}
