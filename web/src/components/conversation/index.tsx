import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react"

import { droppedCount } from "@kiwi/core/format.ts"
import { memberLoad } from "@kiwi/core/load.ts"
import { GENERAL_ROOM, isReaction, type ImageAttachment, type Message } from "@kiwi/core/protocol.ts"
import { colorOf, outsideRepos, tasksAwaitingPeople, type Task } from "@kiwi/core/state.ts"
import { channelTitle, loadRecent, useChannel, useClock, useKnownChannels, type StoredMember } from "@/lib/channel"
import { howHere } from "@/lib/presence"
import type { Gif } from "@/lib/gifs"
import { asksFor, chosenOf } from "@/lib/asks"
import type { Command } from "@/lib/commands"
import { approveTask, closedDigest, reviewsFor, sendBackTask, type TaskSend } from "@/lib/task-actions"
import { useIcons, useLiveIcon } from "@/lib/icons"
import { memberName } from "@/lib/format"
import { dmPlace, MAIN, placeFromKey, placeKey, sendFrom, type Place } from "@/lib/threads"
import { inView, mergedSince, startOfDay, viewCounts, VIEWS, type Tab, type View } from "@/lib/views"
import { cx } from "@/lib/utils"
import { useHeight } from "@/hooks/use-height"
import { Composer } from "../composer"
import { AddAgent } from "../add-agent"
import { RoomChips } from "../room-chips"
import { AgentLine, AgentStrip, byBusy, type AgentNow } from "../agent-strip"
import { ChannelControls, HoldDialog } from "../controls"
import { Icon } from "../icon"
import { Button, Spinner, errorText, toast } from "../kit"
import { CompactBlock, ProposalCard, TalkBar, TalkButton } from "../lazy"
import { bridge } from "@/lib/secrets"
import type { ToolCtx } from "@/lib/voice/tools"
import { defaultScopes } from "../scopes"
import { GifPicker } from "../gif-picker"
import { isAgent } from "../message"
import { NeedsYou } from "../needs-you"
import { Tasks } from "../tasks"
import { ChannelSidebar, type Conversation as ConversationRow } from "./channel-sidebar"
import { Header } from "./header"
import { InfoSide, PictureSide, TasksSide, ThreadSide } from "./side-panels"
import { Centered, rowMakers, threadRowsOf } from "./timeline"
import type { Side } from "./types"
import { useControlsHandlers } from "./use-controls-handlers"
import { useChannelNews, useRecentPreview } from "./use-news"
import { usePlaces } from "./use-places"
import { useScroll } from "./use-scroll"
import { useThreads } from "./use-threads"

function useNow(intervalMs = 30_000): number {
  return useClock(intervalMs)
}

export function Conversation({ member, onBack, onGone }: { member: StoredMember; onBack: () => void; onGone: () => void }) {
  const me = member.identity.name
  const live = useChannel(member)
  const { ch, connection, gone, messages, roster, state, online, isOwner, requests, send, head, marks, pkOf } = live
  useLiveIcon(member)
  const roomId = member.access.roomId
  const icon = useIcons().get(roomId) ?? null
  const now = useNow()
  const [reacting, setReacting] = useState<Message | null>(null)
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
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [picture, setPicture] = useState<{ m: Message; img: ImageAttachment; src: string } | null>(null)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [headRef, headH] = useHeight()
  const [footRef, footH] = useHeight()

  const nameOf = useCallback((name: string) => memberName(state.members.get(name), name), [state.members])
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
  const { decisions, escalations, questions } = useMemo(() => asksFor(state.openAsks, me), [state.openAsks, me])
  const needs = decisions.length + escalations.length + questions.length
  useChannelNews(roomId, Math.max(head, messages.at(-1)?.seq ?? 0), arrivals, 0, needs)

  const reviews = useMemo(() => reviewsFor(state.tasks.values(), me, iAmPerson), [state.tasks, me, iAmPerson])
  const sendTask = useCallback(
    async (...sends: TaskSend[]) => {
      for (const { body, opts } of sends) await send(body, opts)
    },
    [send]
  )
  const noAgents = !active.some((m) => isAgent(m))
  const quiet = noAgents && !messages.some((m) => m.kind !== "event")

  useRecentPreview({ member, messages, others, state, me, nameOf })

  const { placeOf, places } = state
  const { place, hereKey, unreadIn, taskKey } = usePlaces({ here, roomId, messages, me, state, shownTask })
  const { bySeq, threadRoot, showDropped, setShowDropped, threads, visible, inTask, quoted, summaryOf } = useThreads({
    messages,
    state,
    me,
    sideRoot,
    isOwner,
    search,
    hereKey,
    taskKey,
    shownTask,
    nameOf,
  })
  const { behind, setBehind, isFresh, scroller, stick, toBottom, onScroll } = useScroll({ messages, visible, hereKey })

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
        el.scrollIntoView({ block: "center", behavior: "smooth" })
      }
      requestAnimationFrame(() => requestAnimationFrame(() => find(3)))
    },
    [placeOf, hereKey, openTask]
  )

  const onReply = useCallback((m: Message) => setReplyTo(m), [])
  const react = useCallback(
    (g: Gif) => {
      const on = reacting
      setReacting(null)
      if (!on) return
      void send("reaction", { kind: "event", ev: { op: "react", seq: on.seq, emoji: `${g.reaction}/${g.name}` } }).catch((err) => toast(`Not sent: ${errorText(err)}`, "error"))
    },
    [reacting, send]
  )
  const decided = useMemo(() => new Set(decisions.map((m) => m.seq)), [decisions])
  const repliesTo = useMemo(() => {
    const out = new Map<number, Message[]>()
    for (const m of messages) for (const seq of m.re ?? []) out.set(seq, [...(out.get(seq) ?? []), m])
    return out
  }, [messages])
  const chosen = useCallback((m: Message) => (m.choices?.length ? chosenOf(m, repliesTo.get(m.seq) ?? []) : undefined), [repliesTo])
  const answer = useCallback(
    (m: Message, text: string) => {
      send(text, { to: [m.from], re: [m.seq], kind: "msg" }).then(
        () => toast(`Answered ${nameOf(m.from)}`),
        (err) => toast(`Not sent: ${errorText(err)}`, "error")
      )
    },
    [send, nameOf]
  )
  const handlers = useControlsHandlers({ live, member, onGone })
  const voiceTools = useMemo<ToolCtx>(
    () => ({
      state,
      me,
      channel: title,
      isOwner,
      online: new Set(online.keys()),
      requests: isOwner ? requests : [],
      nameOf,
      send,
      hold: handlers.onHold,
      letIn: isOwner
        ? async (id: string) => {
            const r = requests.find((x) => x.id === id)
            if (!r) throw new Error("That request is gone.")
            await handlers.onApprove(r, defaultScopes(roomId))
          }
        : undefined,
      approve: (t: Task) => sendTask(approveTask(t), closedDigest(state, messages, t, { by: me })),
    }),
    [state, me, title, isOwner, online, requests, nameOf, send, handlers, roomId, sendTask, messages]
  )
  const hold = handlers.onHold
  const commands = useMemo<Command[]>(
    () => [
      { name: "tasks", summary: "Open the tasks", run: () => setSide({ kind: "tasks", task: null }) },
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

  const lastMine = visible.findLast((m) => m.from === me && m.kind !== "event")?.seq
  const lastMineReply = threadRoot === null ? undefined : (threads.get(threadRoot) ?? []).findLast((m) => m.from === me && m.kind !== "event")?.seq
  const showsReceipt = (m: Message, anchor: string | undefined): boolean => (anchor === undefined && m.seq === lastMine) || (anchor === "t" && m.seq === lastMineReply)
  const { bubble, timeline } = rowMakers({
    me,
    state,
    messages,
    byKey,
    online,
    marks,
    pkOf,
    image: ch.image,
    now,
    hereKey,
    cardRoom,
    search,
    highlight,
    bySeq,
    quoted,
    chosen,
    nameOf,
    isFresh,
    summaryOf,
    showsReceipt,
    onReply,
    decisions: decided,
    onAnswer: answer,
    onReact: setReacting,
    onJump: jump,
    openThread,
    openTask,
    onOpenImage: (pm, img, src) => setPicture({ m: pm, img, src }),
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
  const folded = hereKey === "main" && !search && state.compact ? state.compact : null
  const proposal = hereKey === "main" && !search ? state.compactProposal : null
  if (folded) rows.push(<CompactBlock key="compact" compact={folded} byName={nameOf(folded.by)} earlier={earlier} onToggle={() => setEarlier((v) => !v)} />)
  const shown = folded && !earlier ? visible.filter((m) => m.seq > folded.through) : visible
  const at = proposal ? shown.findIndex((m) => m.seq === proposal.seq) : -1
  const approve =
    proposal && isOwner
      ? () =>
          send(`compacted the history through #${proposal.through}`, { kind: "event", ev: { op: "compact", summary: proposal.summary, through: proposal.through, proposal: proposal.seq } }).then(
            () => undefined
          )
      : undefined
  const card = proposal ? <ProposalCard key="proposal" proposal={proposal} byName={nameOf(proposal.by)} approve={approve} /> : null
  if (card && at >= 0) rows.push(...timeline(shown.slice(0, at)), card, ...timeline(shown.slice(at + 1)))
  else rows.push(...timeline(shown), ...(card ? [card] : []))

  const root = threadRoot === null ? undefined : bySeq.get(threadRoot)
  const replies = threadRoot === null ? [] : (threads.get(threadRoot) ?? [])
  const threadRows = threadRowsOf(root, replies, bubble)
  const taskRows = shownTask === null ? [] : timeline(inTask, "k")

  const subtitle =
    connection === "connecting"
      ? "Connecting…"
      : connection === "reconnecting"
        ? "Reconnecting…"
        : online.size
          ? `${memberCount} members, ${online.size} online`
          : `${memberCount} ${memberCount === 1 ? "member" : "members"}`
  const working = active.filter((m) => isAgent(m) && memberLoad(state, m.name).current.length > 0).length
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
      model: online.get(m.name)?.activity?.model ?? m.card?.model,
      activity: online.get(m.name)?.activity,
      load: memberLoad(state, m.name),
      lastAt: lastAt.get(m.name),
      card: m.card,
      outside: outsideRepos(state, m.card),
    }))
  const needsMe = decisions.length + escalations.length + questions.length + reviews.length + (isOwner ? requests.length : 0)
  const placeTitle = place.kind === "main" ? title : place.with.includes(me) ? nameOf(place.with.find((n) => n !== me) ?? me) : place.with.map(nameOf).join(" & ")
  const mayWrite = place.kind !== "dm" || place.with.includes(me)
  const extra = place.kind === "main" ? undefined : sendFrom(state, place, me)
  const task = shownTask === null ? undefined : state.tasks.get(shownTask)
  const openCount = [...state.tasks.values()].filter((t) => t.state !== "done").length
  const waiting = tasksAwaitingPeople(state)
  const counts = viewCounts(state, now, needsMe, waiting)
  const merged = mergedSince(state, startOfDay(now))
  const status =
    connection === "connecting" || connection === "reconnecting"
      ? [subtitle]
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
      ? rooms.map((r) => ({ key: roomKey(r.id), label: `# ${r.name}`, unread: r.id === GENERAL_ROOM ? unreadIn("main").n : 0, forMe: r.id === GENERAL_ROOM && unreadIn("main").forMe }))
      : [{ key: "main", label: `# ${GENERAL_ROOM}`, unread: unreadIn("main").n, forMe: unreadIn("main").forMe }]),
    ...[...places]
      .filter(([, p]) => p.place.kind === "dm")
      .map(([key, p]) => {
        const w = p.place.kind === "dm" ? p.place.with : ["", ""]
        const u = unreadIn(key)
        return { key, label: w.includes(me) ? nameOf(w.find((n) => n !== me) ?? me) : w.map(nameOf).join(" & "), unread: u.n, forMe: u.forMe }
      }),
  ]
  const currentConversation = tab !== "conversation" ? null : hereKey !== "main" ? hereKey : rooms.length > 1 ? roomKey(cardRoom) : "main"
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
  const heading = tab === "tasks" ? (VIEWS.find(([v]) => v === view)?.[1] ?? "Tasks") : tab === "agents" ? "Agents" : place.kind === "dm" ? placeTitle : rooms.length > 1 ? `# ${roomName}` : title

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
      roomId={member.access.roomId}
      title={title}
      {...handlers}
    >
      <div className="flex h-full min-w-0 flex-1">
        <ChannelSidebar
          title={title}
          icon={icon}
          people={peopleLine}
          onTitle={() => setSide((s) => (s?.kind === "info" ? null : { kind: "info" }))}
          onSearch={() => {
            setTab("conversation")
            setSearch((q) => q ?? "")
          }}
          view={tab === "tasks" ? view : null}
          counts={counts}
          onView={(v) => {
            setView(v)
            setTab("tasks")
            setSearch(null)
          }}
          agents={agentsNow}
          onOpenTask={openTask}
          conversations={conversations}
          current={currentConversation}
          onConversation={openConversation}
        />
        <div
          className={cx("relative flex min-w-0 flex-1 flex-col bg-canvas", (root || info || side?.kind === "tasks") && "hidden md:flex")}
          style={{ "--head": `${headH}px`, "--foot": `${footH}px` } as CSSProperties}
        >
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
            headingLabel={`Details: ${title}, ${subtitle}`}
            status={status}
            onTitle={() => setSide((s) => (s?.kind === "info" ? null : { kind: "info" }))}
            searchHint={place.kind === "main" ? "Search this channel" : `Search ${placeTitle}`}
          />

          {pausing && hold && <HoldDialog onClose={() => setPausing(false)} onSave={(note) => hold(true, note)} />}

          {tab === "tasks" || tab === "agents" ? (
            <div className="absolute inset-0 overflow-y-auto pt-[calc(var(--head)+8px)]">
              <div className="mx-auto w-full max-w-[960px] px-2 md:px-4">
                {tab === "tasks" ? (
                  <Tasks
                    key={view}
                    state={state}
                    now={now}
                    nameOf={nameOf}
                    only={(t) => inView(t, view, now, waiting)}
                    unreadIn={(id) => unreadIn(placeKey({ kind: "task", task: id }))}
                    onOpen={openTask}
                  />
                ) : agentsNow.length ? (
                  <ul aria-label="What the agents are doing" className="px-2 pb-6">
                    {byBusy(agentsNow).map((a) => (
                      <AgentLine key={a.name} a={a} now={now} onOpenTask={openTask} />
                    ))}
                  </ul>
                ) : (
                  <AddAgent code={member.code} isOwner={isOwner} />
                )}
              </div>
            </div>
          ) : (
            <>
              <div ref={scroller} className="absolute inset-0 overflow-y-auto" onScroll={onScroll}>
                <div className="relative mx-auto w-full max-w-[792px] px-4 pt-[calc(var(--head)+8px)] pb-[calc(var(--foot)+16px)]">
                  {hereKey === "main" && (
                    <NeedsYou
                      now={now}
                      roomId={roomId}
                      me={me}
                      escalations={escalations}
                      questions={questions}
                      reviews={reviews}
                      nameOf={nameOf}
                      agentOf={(name) => isAgent(state.members.get(name))}
                      onReply={async (m, text) => void (await send(text, { to: [m.from], re: [m.seq], kind: "msg" }))}
                      onApproveTask={(t: Task) => sendTask(approveTask(t), closedDigest(state, messages, t, { by: me }))}
                      onSendBack={(t: Task, why: string) => sendTask(sendBackTask(t, why))}
                      onOpenTask={openTask}
                      onJump={jump}
                    />
                  )}
                  {hereKey === "main" && state.rooms.size > 1 && !search && <RoomChips rooms={[...state.rooms.values()]} value={cardRoom} onChange={setCardRoom} />}
                  {connection === "connecting" && messages.length === 0 ? (
                    <Centered>
                      <Spinner />
                    </Centered>
                  ) : hereKey === "main" && noAgents && !search ? (
                    <>
                      <AddAgent code={member.code} isOwner={isOwner} />
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
                {reacting && (
                  <GifPicker onPick={react} onClose={() => setReacting(null)} className="absolute right-3 bottom-[calc(100%+4px)] left-3 md:right-auto md:left-1/2 md:w-[420px] md:-translate-x-1/2" />
                )}
                <div className="relative">
                  {mayWrite ? (
                    <Composer
                      key={hereKey}
                      me={me}
                      people={people}
                      replyTo={replyTo}
                      commands={commands}
                      asking={place.kind === "main" ? decisions[0] : undefined}
                      more={Math.max(decisions.length - 1, 0)}
                      onAnswer={answer}
                      nameOf={nameOf}
                      onClearReply={() => setReplyTo(null)}
                      disabled={connection === "connecting"}
                      extra={extra}
                      placeholder={place.kind === "main" ? "Message everyone" : `Message ${nameOf(place.with.find((n) => n !== me) ?? "")} privately`}
                      send={async (body, opts) => {
                        stick()
                        return send(body, opts)
                      }}
                      talk={
                        place.kind === "main" && state.voice && typeof bridge()?.voiceToken === "function"
                          ? {
                              button: <TalkButton channel={{ roomId, channel: title, me, nameOf, state, messages, tools: voiceTools }} disabled={connection === "connecting"} />,
                              bar: <TalkBar messages={messages} state={state} nameOf={nameOf} me={me} tools={voiceTools} />,
                            }
                          : undefined
                      }
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
            </>
          )}
        </div>

        {root && (
          <ThreadSide root={root} count={replies.length} rows={threadRows} onClose={() => setSide(null)} me={me} people={people} nameOf={nameOf} connecting={connection === "connecting"} send={send} />
        )}

        {picture && <PictureSide picture={picture} nameOf={nameOf} state={state} mayWrite={mayWrite} me={me} extra={extra} send={send} onClose={() => setPicture(null)} />}

        {info && (
          <InfoSide
            title={title}
            icon={icon}
            subtitle={subtitle}
            onClose={() => setSide(null)}
            onPause={hold && !state.hold ? () => setPausing(true) : undefined}
            onMessage={(name) => go(dmPlace(me, name))}
            state={state}
            now={now}
            send={send}
          />
        )}

        {side?.kind === "tasks" && (
          <TasksSide
            side={side}
            setSide={setSide}
            shownTask={shownTask}
            task={task}
            taskKey={taskKey}
            inTask={inTask}
            rows={taskRows}
            openCount={openCount}
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
            unreadIn={unreadIn}
          />
        )}
      </div>
    </ChannelControls>
  )
}
