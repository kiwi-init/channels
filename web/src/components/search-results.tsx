import { useEffect } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import { marks, snippet } from "@kiwi/core/search-rank.ts"
import { taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"

import { formatShort } from "@/lib/format"
import { roomOfMessage } from "@/lib/rooms"
import { labelOf } from "@/lib/task-labels"
import { cx } from "@/lib/utils"

export type SearchHit = { kind: "task"; task: Task } | { kind: "message"; m: Message }

export const SEARCH_LIST = "search-results"
export const hitId = (hit: SearchHit) => (hit.kind === "task" ? `search-task-${hit.task.id}` : `search-message-${hit.m.seq}`)

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return marks(text, terms).map((s, i) =>
    s.hit ? (
      <mark key={i} className="bg-accent-wash text-ink">
        {s.text}
      </mark>
    ) : (
      s.text
    )
  )
}

export function SearchResults({
  state,
  hits,
  terms,
  active,
  onActive,
  onPick,
  nameOf,
}: {
  state: ChannelState
  hits: SearchHit[]
  terms: string[]
  active: number
  onActive: (i: number) => void
  onPick: (hit: SearchHit) => void
  nameOf: (name: string) => string
}) {
  const activeId = hits[active] ? hitId(hits[active]) : null
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" })
  }, [activeId])
  const firstMessage = hits.findIndex((h) => h.kind === "message")
  const row = (hit: SearchHit, i: number) => (
    <li
      key={hitId(hit)}
      id={hitId(hit)}
      role="option"
      aria-selected={i === active}
      onMouseMove={() => i !== active && onActive(i)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(hit)}
      className={cx("flex cursor-pointer gap-3 rounded-ctl px-2 py-2 transition-colors", i === active && "bg-wash")}
    >
      {hit.kind === "task" ? (
        <>
          <span className="shrink-0 text-meta text-ink-3 tabular-nums">{taskId(hit.task.id)}</span>
          <span className="min-w-0 flex-1 truncate text-body">
            <Marked text={hit.task.title} terms={terms} />
          </span>
          <span className="shrink-0 text-meta text-ink-3">{labelOf(state, hit.task)}</span>
        </>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 truncate text-ui font-semibold">
              <Marked text={nameOf(hit.m.from)} terms={terms} />
            </span>
            {state.rooms.size > 1 && <span className="shrink-0 text-meta text-ink-3"># {state.rooms.get(roomOfMessage(state, hit.m))?.name}</span>}
            <span className="shrink-0 text-meta text-ink-3">{formatShort(hit.m.ts)}</span>
          </span>
          <span className="line-clamp-2 text-body text-ink-2">
            <Marked text={snippet(hit.m.body, terms)} terms={terms} />
          </span>
        </span>
      )}
    </li>
  )
  return (
    <ul id={SEARCH_LIST} role="listbox" aria-label="Search results" className="space-y-0.5">
      {hits.flatMap((hit, i) => [
        ...(i === 0 && hit.kind === "task" ? [<Heading key="tasks" text="Tasks" />] : []),
        ...(i === firstMessage ? [<Heading key="messages" text="Messages" />] : []),
        row(hit, i),
      ])}
    </ul>
  )
}

function Heading({ text }: { text: string }) {
  return (
    <li role="presentation" className="px-2 pt-3 pb-1 text-meta font-semibold text-ink-3 first:pt-1">
      {text}
    </li>
  )
}
