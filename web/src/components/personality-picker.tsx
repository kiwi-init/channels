import { capabilityLine, personaOf, ROLE_LABEL, type Persona } from "@kiwi/core/personality.ts"
import { usePersonalities } from "@/lib/personalities"
import { cx } from "@/lib/utils"

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
  const options = all.map(personaOf)
  const shown = current && !options.some((o) => o.name === current.name) ? [current, ...options] : options
  const glyph = (p: Persona) => all.find((x) => x.name === p.name)?.glyph ?? "•"
  const row = (key: string, on: boolean, mark: string, name: string, line: string, pick: () => void, off?: string) => (
    <label
      key={key}
      className={cx(
        "flex cursor-pointer items-center gap-3 rounded-ctl px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow",
        on && "shadow-[inset_0_0_0_1.5px_var(--accent)]",
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
    </label>
  )
  return (
    <div role="radiogroup" aria-label="Personality" className="grid max-h-[46vh] grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto p-px">
      {shown.map((o) =>
        row(o.name, value?.name === o.name, glyph(o), o.name, `${ROLE_LABEL[o.role]} · ${capabilityLine(o)}`, () => onChange(o), o.role === "lead" && lead ? `${lead} is the lead` : undefined)
      )}
      {row("none", value === null, "–", "None", "A plain member: no personality, no instructions", () => onChange(null))}
    </div>
  )
}
