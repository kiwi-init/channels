import type { Task } from "@kiwi/core/state.ts"
import { taskId } from "@kiwi/core/state.ts"
import { contextNow, doingNow, type AgentNow } from "../agent-strip"
import { Monogram } from "../kit"
import { freesWord, toneOf, type Frees, type Tone } from "@/lib/frees"
import { cx } from "@/lib/utils"

export const TONE_DOT: Record<Tone, string> = {
  free: "bg-live",
  doing: "bg-doing",
  decide: "bg-decide",
  alert: "bg-alert",
  quiet: "bg-ink-3",
}

export const TONE_TEXT: Record<Tone, string> = {
  free: "text-ink",
  doing: "text-doing",
  decide: "text-decide",
  alert: "text-alert",
  quiet: "text-ink-3",
}

export function Face({ a, size = 32 }: { a: AgentNow; size?: number }) {
  return <Monogram name={a.label} hue={a.name} agent color={a.color} size={size} online={size > 20 && !!a.here} />
}

export function FreesLine({ f, now, nameOf, className }: { f: Frees; now: number; nameOf: (n: string) => string; className?: string }) {
  const tone = toneOf(f)
  const w = freesWord(f, now, nameOf)
  return (
    <span className={cx("flex min-w-0 flex-col", className)}>
      <span className={cx("flex items-center gap-1.5 text-ui font-medium", TONE_TEXT[tone])}>
        <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
        <span className="truncate">{w.label}</span>
      </span>
      <span className="truncate pl-3 text-meta text-ink-3 tabular-nums">{w.when}</span>
    </span>
  )
}

export function NowLine({ a, now }: { a: AgentNow; now: number }) {
  const doing = doingNow(a)
  const since = a.activity?.since
  return (
    <span className={cx("block truncate text-meta", doing?.busy ? "text-ink-2" : "text-ink-3")}>
      {doing ? doing.text : a.here ? "Idle" : "Away"}
      {doing && since ? ` · ${Math.max(1, Math.round((now - since) / 60_000))}m` : ""}
    </span>
  )
}

export function ModelLine({ a }: { a: AgentNow }) {
  const context = contextNow(a)
  return (
    <span className="block truncate text-stamp text-ink-3 tabular-nums">
      {a.model}
      {context && <span className={cx(context.over && "text-alert")}> · {context.text}</span>}
    </span>
  )
}

export function TaskName({ task, className }: { task: Task; className?: string }) {
  return (
    <span className={cx("flex min-w-0 items-baseline gap-1.5", className)}>
      <span className="shrink-0 text-meta text-ink-3 tabular-nums">{taskId(task.id)}</span>
      <span className="truncate">{task.title}</span>
    </span>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-ctl bg-wash p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx("h-7 rounded-row px-3 text-ui font-medium transition-colors", value === v ? "bg-segment text-ink shadow-[0_0_0_1px_var(--edge-strong)]" : "text-ink-2 hover:text-ink")}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
