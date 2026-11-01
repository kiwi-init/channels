import type { CSSProperties } from "react"

import { COLORS, type Color } from "@kiwi/core/protocol.ts"

export function Swatches({ id, color, onPick }: { id?: string; color: Color | undefined; onPick: (color: Color | null) => void }) {
  return (
    <div id={id} className="swatches" role="group" aria-label={id ? undefined : "Colour"} aria-labelledby={id ? `${id}-label` : undefined}>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch"
          style={{ "--member": `var(--c-${c})` } as CSSProperties}
          aria-pressed={color === c}
          aria-label={c}
          title={c}
          onClick={() => onPick(color === c ? null : c)}
        />
      ))}
    </div>
  )
}
