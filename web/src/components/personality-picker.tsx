import { Tick02Icon } from "@hugeicons/core-free-icons"
import { useLayoutEffect, useRef } from "react"

import { capabilityLine, personaOf, ROLE_LABEL, type Persona } from "@kiwi/core/personality.ts"
import { usePersonalities } from "@/lib/personalities"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"

export function PersonalityPicker({
  current,
  value,
  onChange,
  lead,
  disabled,
}: {
  current?: Persona
  value: Persona | null
  onChange: (p: Persona | null) => void
  lead?: string | null
  disabled?: boolean
}) {
  const all = usePersonalities()
  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = list.current
    const on = box?.querySelector<HTMLElement>("label:has(input:checked)")
    if (!box || !on) return
    const top = on.offsetTop - box.offsetTop
    if (top < box.scrollTop || top + on.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top - 4
  }, [])
  const options = all.map(personaOf)
  const shown = current && !options.some((o) => o.name === current.name) ? [current, ...options] : options
  const glyph = (p: Persona) => all.find((x) => x.name === p.name)?.glyph ?? "•"
  const row = (key: string, on: boolean, mark: string, name: string, line: string, pick: () => void, off?: string) => (
    <label
      key={key}
      className={cx(
        "flex cursor-pointer items-center gap-3 rounded-ctl px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring",
        on ? "bg-accent-wash shadow-[inset_0_0_0_1.5px_var(--accent)]" : "shadow-[inset_0_0_0_1px_var(--line)] hover:bg-wash",
        (disabled || off) && "cursor-default opacity-50"
      )}
    >
      <input type="radio" name="personality" className="sr-only" checked={on} disabled={disabled || !!off} onChange={pick} />
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-row text-ui shadow-[inset_0_0_0_1px_var(--line)]">
        {mark}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-semibold text-ink">{name}</span>
        <span className="block truncate text-meta text-ink-3">{off ?? line}</span>
      </span>
      {on && <Icon icon={Tick02Icon} size={16} className="shrink-0 text-accent-text" />}
    </label>
  )
  return (
    <div ref={list} role="radiogroup" aria-label="Personality" className="grid max-h-[46vh] grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto p-px">
      {row("none", value === null, "–", "None", "A plain member: no personality, no instructions", () => onChange(null))}
      {shown.map((o) =>
        row(o.name, value?.name === o.name, glyph(o), o.name, `${ROLE_LABEL[o.role]} · ${capabilityLine(o)}`, () => onChange(o), o.role === "lead" && lead ? `${lead} is the lead` : undefined)
      )}
    </div>
  )
}
