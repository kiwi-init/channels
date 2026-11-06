import { Icon } from "~/kit/icons"

const CHANNEL_LANDINGS: readonly (readonly [string, string])[] = [
  ["", "Approval"],
  ["merge", "merge"],
  ["release:tag", "release:tag"],
  ["run", "run"],
]

function landingOptions(current: string | undefined): readonly (readonly [string, string])[] {
  return current && !CHANNEL_LANDINGS.some(([value]) => value === current) ? [...CHANNEL_LANDINGS, [current, current]] : CHANNEL_LANDINGS
}

export function LandingPick({ value, onPick }: { value: string | undefined; onPick: (then: string | null) => void }) {
  return (
    <span className="cset-select">
      <select className="input" aria-label="Tasks land on" value={value ?? ""} onChange={(e) => onPick(e.target.value || null)}>
        {landingOptions(value).map(([option, label]) => (
          <option key={option} value={option}>
            {label}
          </option>
        ))}
      </select>
      <Icon name="down" size={14} />
    </span>
  )
}
