import { Tick02Icon } from "@hugeicons/core-free-icons"

import { COLORS, type Color } from "@kiwi/core/protocol.ts"
import { PALETTE } from "@/lib/characters"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"

export function ColorChoice({ value, taken, onPick, disabled }: { value: Color | null; taken: ReadonlyMap<Color, string>; onPick: (c: Color | null) => void; disabled?: boolean }) {
  const swatch = (key: string, on: boolean, label: string, tone: { fill: string; ink: string } | null, pick: () => void, holder?: string) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={holder ? `${label}, ${holder}'s` : label}
      title={holder ? `${holder}'s colour` : label}
      disabled={disabled || !!holder}
      onClick={pick}
      className={cx("flex aspect-square items-center justify-center rounded-full p-0.5 transition-colors hover:bg-wash disabled:pointer-events-none", on && "bg-accent-wash ring-2 ring-accent")}
    >
      <span
        className={cx("flex size-full items-center justify-center rounded-full text-white", !tone && "bg-[linear-gradient(180deg,var(--avatar-top),var(--avatar-bottom))]", holder && "opacity-30")}
        style={tone ? { background: `linear-gradient(180deg, ${tone.fill}, color-mix(in srgb, ${tone.fill} 72%, black))`, color: tone.ink } : undefined}
      >
        {on && <Icon icon={Tick02Icon} size={14} />}
      </span>
    </button>
  )
  return (
    <div role="radiogroup" aria-label="Colour" className="grid grid-cols-6 gap-1.5">
      {swatch("none", value === null, "No colour", null, () => onPick(null))}
      {COLORS.map((c) => swatch(c, value === c, c, PALETTE[c], () => onPick(c), taken.get(c)))}
    </div>
  )
}
