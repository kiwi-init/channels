import type { Message } from "@kiwi/core/protocol.ts"
import { excerpt } from "@kiwi/app/format.ts"

function quoteText(q: Message): string {
  const imgs = q.imgs ?? []
  if (imgs.length && q.body === imgs.map((i) => i.name).join(", ")) return imgs.length === 1 ? "Image" : `${imgs.length} images`
  return excerpt(q.body, 160)
}

export function Quote({ seq, q, nameOf, onJump }: { seq: number; q: Message | undefined; nameOf: (name: string) => string; onJump: (seq: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onJump(seq)}
      aria-label={q ? `Replying to ${nameOf(q.from)}: ${quoteText(q)}` : "Replying to an earlier message"}
      className="my-1 flex w-full max-w-[640px] min-w-0 items-baseline gap-2 border-l-2 border-edge-strong pl-2.5 text-left text-meta text-ink-3 transition-colors hover:text-ink-2"
    >
      <span className="shrink-0 font-semibold text-ink-2">{q ? nameOf(q.from) : "Earlier message"}</span>
      {q && <span className="min-w-0 truncate">{quoteText(q)}</span>}
    </button>
  )
}
