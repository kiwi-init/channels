import type { ReactNode } from "react"

import type { ImageAttachment, Message } from "@kiwi/core/protocol.ts"
import { cardShown } from "@kiwi/core/standup.ts"
import { colorOf, isLeadRole, type ChannelState } from "@kiwi/core/state.ts"
import { prsIn } from "@kiwi/core/work.ts"
import type { ChannelHandle } from "@/lib/channel"
import { formatTime } from "@/lib/format"
import { chipsFor } from "@/lib/reactions"
import { receipt } from "@/lib/receipts"
import { foldTaskEvents, isTaskCard } from "@/lib/task-cards"
import { LiveTaskCard } from "../live-task-card"
import { DayMark, EventGroup, EventRow, GithubRow, MessageRow, standsAlone, type Chosen, type ThreadSummary } from "../message"

const RUN_GAP = 5 * 60_000

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
const EVENT_GAP = 15 * 60_000

export interface RowsContext {
  me: string
  state: ChannelState
  messages: Message[]
  byKey: Map<string, ChannelHandle["roster"][number]>
  online: ChannelHandle["online"]
  marks: ChannelHandle["marks"]
  pkOf: ChannelHandle["pkOf"]
  image: ChannelHandle["ch"]["image"]
  now: number
  hereKey: string
  cardRoom: string
  search: string | null
  highlight: number | null
  bySeq: Map<number, Message>
  quoted: (seq: number) => Message | undefined
  nameOf: (name: string) => string
  isFresh: (seq: number) => boolean
  summaryOf: (seq: number) => ThreadSummary | undefined
  showsReceipt: (m: Message, anchor: string | undefined) => boolean
  onReply: (m: Message) => void
  decisions: ReadonlySet<number>
  onAnswer: (m: Message, text: string) => void
  onReact: (m: Message) => void
  onJump: (seq: number) => void
  openThread: (root: number) => void
  openTask: (task: number) => void
  onOpenImage: (m: Message, img: ImageAttachment, src: string) => void
}

export function rowMakers(c: RowsContext) {
  const {
    me,
    state,
    messages,
    byKey,
    online,
    marks,
    pkOf,
    image,
    now,
    hereKey,
    cardRoom,
    search,
    highlight,
    bySeq,
    quoted,
    nameOf,
    isFresh,
    summaryOf,
    showsReceipt,
    onReply,
    decisions,
    onAnswer,
    onReact,
    onJump,
    openThread,
    openTask,
    onOpenImage,
  } = c
  const threadOf = (m: Message, next: Message | undefined) => {
    const s = summaryOf(m.seq)
    return s && !(s.count === 1 && next?.seq === s.first) ? s : undefined
  }
  const answers = new Map<number, Chosen>()
  for (const m of messages) {
    if (m.kind === "event" || !m.re?.length) continue
    for (const r of m.re) {
      const q = bySeq.get(r)
      const choice = m.body.trim()
      if (q?.esc && q.choices?.includes(choice) && !answers.has(r)) answers.set(r, { choice, by: m.from, at: m.ts })
    }
  }
  const tagOf = (name: string) => {
    const member = state.members.get(name)
    return member?.owner ? "owner" : member?.role && isLeadRole(member.role) ? "lead" : undefined
  }
  const prsOf = (m: Message) => {
    if (!m.body.includes("github.com/")) return undefined
    const prs = prsIn(state, [m], () => true)
    return prs.length ? prs : undefined
  }
  const bubble = (m: Message, first: boolean, prev: Message | undefined, anchor?: string, next?: Message) => (
    <MessageRow
      key={m.seq}
      anchor={anchor}
      m={m}
      me={me}
      author={(m.pk && byKey.get(m.pk)) || state.members.get(m.from)}
      tag={tagOf(m.from)}
      trust={state.trust.get(m.seq)}
      online={online.has(m.from)}
      color={colorOf(state, m.from)}
      first={first}
      fresh={!anchor && isFresh(m.seq)}
      adjacentReply={(m.re?.length ?? 0) === 1 && (prev?.seq === m.re![0] || bySeq.get(m.re![0]!)?.kind === "event")}
      highlighted={highlight === m.seq}
      quoted={quoted}
      nameOf={nameOf}
      onReply={anchor ? undefined : onReply}
      onChoose={!anchor && decisions.has(m.seq) ? (choice) => onAnswer(m, choice) : undefined}
      chosen={answers.get(m.seq)}
      prs={prsOf(m)}
      onReact={anchor ? undefined : onReact}
      onJump={onJump}
      thread={search || anchor ? undefined : threadOf(m, next)}
      onOpenThread={openThread}
      receipt={showsReceipt(m, anchor) ? (receipt(m, state, marks, pkOf, formatTime) ?? undefined) : undefined}
      reactions={chipsFor(state, m.seq, me, nameOf)}
      image={image}
      onOpenImage={onOpenImage}
    />
  )
  const timeline = (all: Message[], anchor?: string) => {
    const cards = !anchor && hereKey === "main"
    const list = cards ? foldTaskEvents(all, state.tasks) : all
    const out: ReactNode[] = []
    for (let i = 0; i < list.length; i++) {
      const m = list[i]!
      const prev = list[i - 1]
      if (cards && isTaskCard(m, state.tasks) && !cardShown(state, messages, m.seq, cardRoom)) continue
      if (!prev || !sameDay(prev.ts, m.ts)) out.push(<DayMark key={`s${m.seq}`} ts={m.ts} />)
      if (cards && isTaskCard(m, state.tasks)) {
        out.push(<LiveTaskCard key={`card${m.seq}`} id={m.seq} state={state} messages={messages} me={me} now={now} onOpen={openTask} />)
        continue
      }
      if (m.kind === "event") {
        const batch: Message[] = [m]
        let j = i + 1
        while (j < list.length && list[j]!.kind === "event" && !(cards && isTaskCard(list[j]!, state.tasks)) && sameDay(m.ts, list[j]!.ts) && list[j]!.ts - list[j - 1]!.ts <= EVENT_GAP)
          batch.push(list[j++]!)
        i = j - 1
        const alone = batch.filter((ev) => standsAlone(ev, state, me))
        const github = batch.filter((ev) => !standsAlone(ev, state, me) && ev.ev?.op === "github")
        const rest = batch.filter((ev) => !standsAlone(ev, state, me) && ev.ev?.op !== "github")
        const open = anchor ? undefined : openTask
        for (const ev of alone) out.push(<EventRow key={ev.seq} m={ev} state={state} now={now} onOpenTask={open} anchor={anchor} />)
        if (github.length) out.push(<GithubRow key={`g${github[0]!.seq}`} messages={github} anchor={anchor} />)
        if (rest.length) out.push(<EventGroup key={`e${rest[0]!.seq}`} messages={rest} state={state} now={now} onOpenTask={open} highlight={highlight} anchor={anchor} />)
        continue
      }
      const next = list[i + 1]
      const runs = (a: Message | undefined, b: Message) => !!a && a.kind !== "event" && b.kind !== "event" && a.from === b.from && sameDay(a.ts, b.ts) && b.ts - a.ts <= RUN_GAP
      out.push(bubble(m, !runs(prev, m), prev, anchor, next))
    }
    return out
  }
  return { bubble, timeline }
}

export function threadRowsOf(root: Message | undefined, replies: Message[], bubble: ReturnType<typeof rowMakers>["bubble"]): ReactNode[] {
  const threadRows: ReactNode[] = []
  if (root) {
    const list = [root, ...replies]
    list.forEach((m, i) => {
      const prev = list[i - 1]
      const next = list[i + 1]
      const first = !prev || prev.from !== m.from || m.ts - prev.ts > RUN_GAP
      threadRows.push(bubble(m, first, prev, "t", next))
      if (i === 0 && replies.length)
        threadRows.push(
          <div key="split" className="my-3 text-center text-stamp text-ink-3">
            {replies.length === 1 ? "1 reply" : `${replies.length} replies`}
          </div>
        )
    })
  }
  return threadRows
}

export function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-60 flex-1 flex-col items-center justify-center p-8 text-center">{children}</div>
}
