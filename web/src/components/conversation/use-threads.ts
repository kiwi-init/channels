import { useCallback, useMemo, useState } from "react"

import { ignored, isQuiet, type Color, type Message } from "@kiwi/core/protocol.ts"
import type { TaskCards } from "@kiwi/core/standup.ts"
import { colorOf, type ChannelState } from "@kiwi/core/state.ts"
import { digestTask } from "@/lib/activity"
import { roomOfMessage } from "@/lib/rooms"
import { MAIN, placeKey } from "@/lib/threads"
import { isAgent, type ThreadSummary } from "../message"

const summarised = (m: Message) => digestTask(m) !== null || m.ev?.op === "task.add" || (m.ev?.op === "task.update" && !!m.ev.state)

export function useThreads({
  messages,
  state,
  me,
  sideRoot,
  isOwner,
  hereKey,
  room,
  cards,
  taskKey,
  shownTask,
  nameOf,
}: {
  messages: Message[]
  state: ChannelState
  me: string
  sideRoot: number | null
  isOwner: boolean
  hereKey: string
  room: string | null
  cards: Pick<TaskCards, "shown">
  taskKey: string | null
  shownTask: number | null
  nameOf: (name: string) => string
}) {
  const { placeOf } = state
  const bySeq = useMemo(() => new Map(messages.map((m) => [m.seq, m])), [messages])
  const rootOf = useCallback(
    (seq: number) => {
      const root = state.threadOf.get(seq)
      if (root === undefined || root === seq) return null
      const r = bySeq.get(root)
      return r && r.kind !== "event" ? root : null
    },
    [state.threadOf, bySeq]
  )
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

  const searchable = useMemo(
    () =>
      messages.filter((m) => {
        const p = placeOf.get(m.seq) ?? MAIN
        const inHere = placeKey(p) === hereKey || (hereKey === "main" && p.kind === "task" && summarised(m))
        return inHere && !isQuiet(m) && (revealed || !ignored(state.trust.get(m.seq)))
      }),
    [messages, placeOf, hereKey, state.trust, revealed]
  )
  const visible = useMemo(
    () =>
      room === null || hereKey !== "main"
        ? searchable
        : searchable.filter((m) => {
            const p = placeOf.get(m.seq) ?? MAIN
            return p.kind === "task" ? cards.shown(p.task, room) : roomOfMessage(state, m) === room
          }),
    [searchable, room, hereKey, placeOf, cards, state]
  )
  const inTask = useMemo(
    () => (taskKey === null ? [] : messages.filter((m) => m.seq !== shownTask && placeKey(placeOf.get(m.seq) ?? MAIN) === taskKey && (revealed || !ignored(state.trust.get(m.seq))))),
    [messages, placeOf, taskKey, shownTask, state.trust, revealed]
  )

  const quoted = useCallback((seq: number) => bySeq.get(seq), [bySeq])

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
    return { count: list.length, first: list[0]!.seq, last: list[list.length - 1]!.ts, people: peopleOf(list), forYou: list.some((r) => r.from !== me && r.to?.includes(me)) }
  }

  return { bySeq, threadRoot: sideRoot, showDropped, setShowDropped, threads, visible, searchable, inTask, quoted, summaryOf }
}
