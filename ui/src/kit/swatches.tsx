import type { CSSProperties } from "react"

import { COLORS, type Color } from "@kiwi/core/protocol.ts"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"

const NAMES: Record<Color, Key> = {
  red: "kit.swatches.red",
  orange: "kit.swatches.orange",
  yellow: "kit.swatches.yellow",
  green: "kit.swatches.green",
  teal: "kit.swatches.teal",
  blue: "kit.swatches.blue",
  indigo: "kit.swatches.indigo",
  violet: "kit.swatches.violet",
  pink: "kit.swatches.pink",
  brown: "kit.swatches.brown",
}

export function Swatches({ id, color, onPick }: { id?: string; color: Color | undefined; onPick: (color: Color | null) => void }) {
  return (
    <div id={id} className="swatches" role="group" aria-label={id ? undefined : t("kit.swatches.colour")} aria-labelledby={id ? `${id}-label` : undefined}>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch"
          style={{ "--member": `var(--c-${c})` } as CSSProperties}
          aria-pressed={color === c}
          aria-label={t(NAMES[c])}
          title={t(NAMES[c])}
          onClick={() => onPick(color === c ? null : c)}
        />
      ))}
    </div>
  )
}
