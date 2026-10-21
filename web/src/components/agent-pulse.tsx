import type { Flag, Span } from "@/lib/timeline"
import { cx } from "@/lib/utils"

const SEGMENT: Record<Span["kind"], [string, string]> = {
  doing: ["bg-doing/45", "bg-doing"],
  reviewing: ["bg-doing/30", "bg-doing/70"],
  waiting: ["bg-ink-3/25", "bg-ink-3/45"],
  decide: ["bg-decide/50", "bg-decide"],
  done: ["bg-live/50", "bg-live/50"],
}

export interface Pulse {
  from: number
  to: number
  spans: Span[]
  flags: Flag[]
}

export function PulseLine({ pulse }: { pulse: Pulse }) {
  const span = pulse.to - pulse.from
  const pct = (t: number) => `${((Math.max(t, pulse.from) - pulse.from) / span) * 100}%`
  const wide = (a: number, b: number) => `max(3px, ${((Math.min(b, pulse.to) - Math.max(a, pulse.from)) / span) * 100}%)`
  const needs = pulse.flags.some((f) => f.open && (f.kind === "ask" || f.kind === "permission"))
  const red = pulse.flags.filter((f) => f.kind === "red")
  return (
    <span aria-hidden className="mt-1 flex items-center gap-1">
      <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-wash-2">
        {pulse.spans.map((s) => (
          <span key={s.key} className={cx("absolute inset-y-0 rounded-full", SEGMENT[s.kind][s.open ? 1 : 0])} style={{ left: pct(s.from), width: wide(s.from, s.to) }} />
        ))}
        {red.map((f) => (
          <span key={f.key} className="absolute inset-y-0 w-[3px] rounded-full bg-alert" style={{ left: pct(f.at) }} />
        ))}
      </span>
      <span className={cx("size-1.5 shrink-0 rounded-full", needs ? "bg-decide" : red.length ? "bg-alert" : "bg-transparent")} />
    </span>
  )
}
