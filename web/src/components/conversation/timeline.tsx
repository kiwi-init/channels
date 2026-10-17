import type { ReactNode } from "react"

import type { ImageAttachment, Message } from "@mc/protocol.ts"
import { colorOf, type ChannelState } from "@mc/state.ts"
import type { ChannelHandle } from "@/lib/channel"
import { formatTime } from "@/lib/format"
import { chipsFor } from "@/lib/reactions"
import { receipt } from "@/lib/receipts"
import { foldTaskEvents, isTaskCard } from "@/lib/task-cards"
import { LiveTaskCard } from "../live-task-card"
import { Bubble, EventGroup, EventRow, TimeMark, standsAlone, type ThreadSummary } from "../message"

const RUN_GAP = 5 * 60_000

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
const STAMP_GAP = 15 * 60_000

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
  group: boolean
  hereKey: string
  search: string | null
  highlight: number | null
  bySeq: Map<number, Message>
  quoted: (seq: number) => Message | undefined
  nameOf: (name: string) => string
  isFresh: (seq: number) => boolean
  summaryOf: (seq: number) => ThreadSummary | undefined
  showsReceipt: (m: Message, anchor: string | undefined) => boolean
  onReply: (m: Message) => void
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
    onReact,
    onJump,
    openThread,
    openTask,
    onOpenImage,
  } = c
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
      onReact={anchor ? undefined : onReact}
      onJump={onJump}
      thread={search || anchor ? undefined : summaryOf(m.seq)}
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
      if (!prev || !sameDay(prev.ts, m.ts) || m.ts - prev.ts > STAMP_GAP) out.push(<TimeMark key={`s${m.seq}`} ts={m.ts} />)
      if (cards && isTaskCard(m, state.tasks)) {
        out.push(<LiveTaskCard key={`card${m.seq}`} id={m.seq} state={state} messages={messages} me={me} now={now} onOpen={openTask} />)
        continue
      }
      if (m.kind === "event") {
        const batch: Message[] = [m]
        let j = i + 1
        while (j < list.length && list[j]!.kind === "event" && !(cards && isTaskCard(list[j]!, state.tasks)) && sameDay(m.ts, list[j]!.ts) && list[j]!.ts - list[j - 1]!.ts <= STAMP_GAP)
          batch.push(list[j++]!)
        i = j - 1
        const alone = batch.filter((ev) => standsAlone(ev, state, me))
        const rest = batch.filter((ev) => !standsAlone(ev, state, me))
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
  return threadRows
}

export function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-60 flex-1 flex-col items-center justify-center p-8 text-center">{children}</div>
}
