import { ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons"

import type { Message } from "@kiwi/core/protocol.ts"
import { excerpt } from "@/lib/format"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"

function quoteText(q: Message): string {
  const imgs = q.imgs ?? []
  if (imgs.length && q.body === imgs.map((i) => i.name).join(", ")) return imgs.length === 1 ? "Image" : `${imgs.length} images`
  return excerpt(q.body, 160)
}

export function Quote({
  seq,
  q,
  mine,
  joined,
  nameOf,
  onJump,
}: {
  seq: number
  q: Message | undefined
  mine: boolean
  joined: boolean
  nameOf: (name: string) => string
  onJump: (seq: number) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(seq)}
      aria-label={q ? `Replying to ${nameOf(q.from)}: ${quoteText(q)}` : "Replying to an earlier message"}
      className={cx("relative mb-1 flex max-w-[calc(100%-24px)] min-w-0 flex-col rounded-bubble bg-wash px-3 py-1.5 text-left transition-colors hover:bg-wash-2", mine ? "mr-6 self-end" : "ml-6")}
    >
      {joined && (
        <span
          aria-hidden
          className={cx("pointer-events-none absolute top-1/2 -bottom-3 w-3 border-t-2 border-edge-strong", mine ? "-right-3 rounded-tr-row border-r-2" : "-left-3 rounded-tl-row border-l-2")}
        />
      )}
      <span className="flex min-w-0 items-center gap-1 text-stamp text-ink-3">
        <Icon icon={ArrowTurnBackwardIcon} size={11} className="shrink-0" />
        <span className="truncate font-medium text-ink-2">{q ? nameOf(q.from) : "Earlier message"}</span>
      </span>
      {q && <span className="line-clamp-2 text-ui leading-snug [overflow-wrap:anywhere] text-ink-2">{quoteText(q)}</span>}
    </button>
  )
}
