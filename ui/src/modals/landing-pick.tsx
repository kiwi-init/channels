import "~/i18n/en/modals"
import { t } from "~/i18n/i18n"
import { Icon } from "~/kit/icons"

const CHANNEL_LANDINGS: readonly string[] = ["", "merge", "release:tag", "run"]

function landingOptions(current: string | undefined): readonly string[] {
  return current && !CHANNEL_LANDINGS.includes(current) ? [...CHANNEL_LANDINGS, current] : CHANNEL_LANDINGS
}

export function LandingPick({ value, onPick }: { value: string | undefined; onPick: (then: string | null) => void }) {
  return (
    <span className="cset-select">
      <select className="input" aria-label={t("modals.landing.pick.label")} value={value ?? ""} onChange={(e) => onPick(e.target.value || null)}>
        {landingOptions(value).map((option) => (
          <option key={option} value={option}>
            {option || t("modals.landing.pick.approval")}
          </option>
        ))}
      </select>
      <Icon name="down" size={14} />
    </span>
  )
}
