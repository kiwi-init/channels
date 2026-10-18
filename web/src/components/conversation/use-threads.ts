import { useCallback, useMemo, useState } from "react"

import { ignored, type Color, type Message } from "@kiwi/core/protocol.ts"
import { colorOf, type ChannelState } from "@kiwi/core/state.ts"
import { MAIN, placeKey } from "@/lib/threads"
import { isAgent, type ThreadSummary } from "../message"

const summarised = (m: Message) => m.ev?.op === "task.add" || (m.ev?.op === "task.update" && !!m.ev.state)

export function useThreads({
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
}: {
  messages: Message[]
  state: ChannelState
  me: string
  sideRoot: number | null
  isOwner: boolean
  search: string | null
  hereKey: string
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

  const visible = useMemo(() => {
    const q = search?.trim().toLowerCase()
    let list = messages.filter((m) => {
      const at = placeKey(placeOf.get(m.seq) ?? MAIN)
      const inHere = at === hereKey || (hereKey === "main" && at.startsWith("task:") && summarised(m))
      if (!inHere) return false
      if (m.ev?.op === "hello" || m.ev?.op === "card" || m.ev?.op === "react") return false
      if (!revealed && ignored(state.trust.get(m.seq))) return false
      return true
    })
    if (q) list = list.filter((m) => m.body.toLowerCase().includes(q) || nameOf(m.from).toLowerCase().includes(q))
    else list = list.filter((m) => m.kind === "event" || rootOf(m.seq) === null)
    return list
  }, [messages, placeOf, hereKey, search, nameOf, rootOf, state, revealed])
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
    return { count: list.length, last: list[list.length - 1]!.ts, people: peopleOf(list), forYou: list.some((r) => r.from !== me && r.to?.includes(me)) }
  }

  return { bySeq, rootOf, threadRoot: sideRoot, showDropped, setShowDropped, threads, visible, inTask, quoted, summaryOf }
}
