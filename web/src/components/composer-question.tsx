import { useEffect, useState } from "react"

import type { Message } from "@kiwi/core/protocol.ts"
import { taskId } from "@kiwi/core/state.ts"
import { excerpt } from "@/lib/format"

export function ComposerQuestion({
  m,
  more,
  nameOf,
  disabled,
  onChoose,
  onElse,
}: {
  m: Message
  more: number
  nameOf: (name: string) => string
  disabled: boolean
  onChoose: (choice: string) => Promise<boolean>
  onElse: () => void
}) {
  const choose = useChoosing(m.seq, onChoose)
  return (
    <section aria-label="Question" className="mb-2 flex flex-col gap-2 rounded-card bg-raised px-3.5 py-3 shadow-[0_0_0_1px_var(--decide)]">
      <p className="flex items-start gap-2 text-ui">
        <span className="shrink-0 rounded-full bg-decide-wash px-1.5 text-meta font-semibold text-decide">{m.esc ? "Decision for you" : "Question for you"}</span>
        {!!m.task && <span className="shrink-0 text-meta text-ink-3 tabular-nums">{taskId(m.task)}</span>}
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-medium">{nameOf(m.from)}</span>: {excerpt(m.body, 400)}
        </span>
        {more > 0 && <span className="ml-auto shrink-0 text-meta text-ink-3 tabular-nums">+{more} more</span>}
      </p>
      {m.choices?.length ? (
        <ul aria-label="Options" className="flex flex-col gap-1.5">
          {m.choices.map((c) => (
            <li key={c}>
              <button
                type="button"
                disabled={disabled || choose.busy}
                onClick={() => choose.pick(c)}
                className="w-full rounded-row px-3 py-1.5 text-left text-ui leading-snug [overflow-wrap:anywhere] edge transition-colors hover:bg-wash-2 disabled:pointer-events-none disabled:opacity-40"
              >
                {c}
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={onElse} className="w-full rounded-row px-3 py-1.5 text-left text-ui text-ink-2 transition-colors hover:bg-wash-2">
              Something else
            </button>
          </li>
        </ul>
      ) : null}
    </section>
  )
}

const SETTLE_MS = 400
const STUCK_MS = 5_000

export function choiceGate(now: () => number = Date.now) {
  let shownAt = now()
  let busy = false
  return {
    shown() {
      shownAt = now()
      busy = false
    },
    take(): boolean {
      if (busy || now() - shownAt < SETTLE_MS) return false
      busy = true
      return true
    },
    done(sent: boolean) {
      if (!sent) busy = false
    },
  }
}

export function useChoosing(key: number, onChoose: (choice: string) => Promise<boolean>): { busy: boolean; pick: (choice: string) => void } {
  const [gate] = useState(() => choiceGate())
  const [busyFor, setBusyFor] = useState<number | null>(null)
  const busy = busyFor === key
  useEffect(() => gate.shown(), [key, gate])
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => (gate.done(false), setBusyFor(null)), STUCK_MS)
    return () => clearTimeout(t)
  }, [busy, gate])
  const pick = (choice: string) => {
    if (!gate.take()) return
    setBusyFor(key)
    void onChoose(choice).then((sent) => {
      gate.done(sent)
      if (!sent) setBusyFor(null)
    })
  }
  return { busy, pick }
}
