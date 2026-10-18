import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react"

import { droppedCount } from "@kiwi/core/format.ts"
import { memberLoad } from "@kiwi/core/load.ts"
import { isReaction, type ImageAttachment, type Message } from "@kiwi/core/protocol.ts"
import { colorOf, outsideRepos, type Task } from "@kiwi/core/state.ts"
import { recentPrs } from "@kiwi/core/work.ts"
import { channelTitle, loadRecent, useChannel, useClock, useKnownChannels, type StoredMember } from "@/lib/channel"
import { howHere } from "@/lib/presence"
import type { Gif } from "@/lib/gifs"
import { asksFor } from "@/lib/asks"
import { approveTask, reviewsFor, sendBackTask, type TaskSend } from "@/lib/task-actions"
import { useIcons, useLiveIcon } from "@/lib/icons"
import { memberName } from "@/lib/format"
import { dmPlace, placeKey, sendFrom, type Place } from "@/lib/threads"
import { cx } from "@/lib/utils"
import { useHeight } from "@/hooks/use-height"
import { Composer } from "../composer"
import { AddAgent } from "../add-agent"
import { AgentStrip, type AgentNow } from "../agent-strip"
import { ChannelControls, HoldDialog } from "../controls"
import { Icon } from "../icon"
import { Button, Spinner, errorText, toast } from "../kit"
import { GifPicker } from "../gif-picker"
import { isAgent } from "../message"
import { NeedsYou } from "../needs-you"
import { FLOAT_GAP, FLOAT_W, Overview } from "../side-panel"
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

const CLEAR = "xl:pr-[min(var(--float),max(0px,calc(792px_+_2*var(--float)_-_100%)))]"

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
  const [side, setSide] = useState<Side>(null)
  const floating = side === null
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
  const { escalations, questions } = useMemo(() => asksFor(state.openAsks, me), [state.openAsks, me])
  const needs = escalations.length + questions.length
  useChannelNews(roomId, Math.max(head, messages.at(-1)?.seq ?? 0), arrivals, 0, needs)

  const reviews = useMemo(() => reviewsFor(state.tasks.values(), me, iAmPerson), [state.tasks, me, iAmPerson])
  const sendTask = useCallback(async ({ body, opts }: TaskSend) => void (await send(body, opts)), [send])
  const noAgents = !active.some((m) => isAgent(m))
  const quiet = noAgents && !messages.some((m) => m.kind !== "event")

  useRecentPreview({ member, messages, others, state, me, nameOf })

  const { placeOf, places } = state
  const { place, hereKey, unreadIn, taskKey } = usePlaces({ here, roomId, messages, me, state, shownTask })
  const { bySeq, rootOf, threadRoot, showDropped, setShowDropped, threads, visible, inTask, quoted, summaryOf } = useThreads({
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
      const inThread = inTask === null ? rootOf(seq) : null
      if (inTask !== null) openTask(inTask)
      else {
        if (inThread !== null) openThread(inThread)
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
      requestAnimationFrame(() => requestAnimationFrame(() => find(3)))
    },
    [rootOf, placeOf, hereKey, openTask, openThread]
  )

  const onReply = useCallback((m: Message) => openThread(rootOf(m.seq) ?? m.seq), [rootOf, openThread])
  const react = useCallback(
    (g: Gif) => {
      const on = reacting
      setReacting(null)
      if (!on) return
      void send("reaction", { kind: "event", ev: { op: "react", seq: on.seq, emoji: `${g.reaction}/${g.name}` } }).catch((err) => toast(`Not sent: ${errorText(err)}`, "error"))
    },
    [reacting, send]
  )
  const handlers = useControlsHandlers({ live, member, onGone })
  const hold = handlers.onHold

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

  const group = memberCount > 2
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
    group,
    hereKey,
    search,
    highlight,
    bySeq,
    quoted,
    nameOf,
    isFresh,
    summaryOf,
    showsReceipt,
    onReply,
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
  rows.push(...timeline(visible))

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
  const prs = floating ? recentPrs(state, messages, 5) : []
  const needsMe = escalations.length + questions.length + reviews.length + (isOwner ? requests.length : 0)
  const headline =
    connection === "connecting" || connection === "reconnecting"
      ? subtitle
      : [state.lead && state.lead !== me ? `${nameOf(state.lead)} leads` : null, working ? `${working} working` : null, needsMe ? `${needsMe} ${needsMe === 1 ? "needs" : "need"} you` : null]
          .filter(Boolean)
          .join(" · ") || subtitle

  const placeTitle = place.kind === "main" ? title : place.with.includes(me) ? nameOf(place.with.find((n) => n !== me) ?? me) : place.with.map(nameOf).join(" & ")
  const mayWrite = place.kind !== "dm" || place.with.includes(me)
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
      roomId={member.access.roomId}
      title={title}
      {...handlers}
    >
      <div className="flex h-full min-w-0 flex-1">
        <div
          className={cx("relative flex min-w-0 flex-1 flex-col bg-canvas", (root || info || side?.kind === "tasks") && "hidden md:flex")}
          style={{ "--head": `${headH}px`, "--foot": `${footH}px`, "--float": `${FLOAT_W + 2 * FLOAT_GAP}px` } as CSSProperties}
        >
          <Header
            headRef={headRef}
            onBack={onBack}
            search={search}
            setSearch={setSearch}
            places={places}
            unreadIn={unreadIn}
            taskKey={taskKey}
            side={side}
            setSide={setSide}
            hereKey={hereKey}
            title={title}
            subtitle={subtitle}
            headline={headline}
            info={info}
            onPick={go}
            place={place}
            placeTitle={placeTitle}
          />

          {pausing && hold && <HoldDialog onClose={() => setPausing(false)} onSave={(note) => hold(true, note)} />}

          <div ref={scroller} className={cx("absolute inset-0 overflow-y-auto", floating && CLEAR)} onScroll={onScroll}>
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
                  onApproveTask={(t: Task) => sendTask(approveTask(t))}
                  onSendBack={(t: Task, why: string) => sendTask(sendBackTask(t, why))}
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

          <div ref={footRef} className={cx("absolute inset-x-0 bottom-0 z-20", floating && CLEAR)}>
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
                  nameOf={nameOf}
                  onClearReply={() => setReplyTo(null)}
                  disabled={connection === "connecting"}
                  extra={extra}
                  placeholder={place.kind === "main" ? "Message everyone" : `Message ${nameOf(place.with.find((n) => n !== me) ?? "")} privately`}
                  send={async (body, opts) => {
                    stick()
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
