// A channel's avatar: emoji or a small image, or the title's first letter when there is none, on a
// round tile like a Messages contact. A letter wears a steady hue from the title, so a list of
// channels reads as faces, as Grok's list does, not a column of grey. The tile is always the same
// size, so a row doesn't jump when an icon arrives.

import type { ChannelIcon } from "@kiwi/core/protocol.ts"
import { PALETTE } from "@/lib/characters"
import { cx } from "@/lib/utils"
import { hueOf } from "./kit"
import { RobotAvatar } from "./robot"

const SIZE: Record<number, string> = {
  20: "size-5 text-meta",
  28: "size-7 text-ui",
  32: "size-8 text-ui",
  36: "size-9 text-body",
  40: "size-10 text-title",
  48: "size-12 text-display",
  64: "size-16 text-display",
}

export function ChannelIconTile({ icon, title, size }: { icon: ChannelIcon | null; title: string; size: 20 | 28 | 32 | 36 | 40 | 48 | 64 }) {
  const box = cx("rounded-full", SIZE[size])
  if (icon?.kind === "image") {
    return (
      <span className={cx(box, "block shrink-0 overflow-hidden bg-wash-2")}>
        <img src={`data:${icon.mime};base64,${icon.data}`} alt="" className="size-full object-cover" />
      </span>
    )
  }
  if (icon?.kind === "emoji") {
    return (
      <span aria-hidden className={cx(box, "flex shrink-0 items-center justify-center bg-wash-2 select-none")}>
        {icon.emoji}
      </span>
    )
  }
  const tone = PALETTE[hueOf(title.trim().toLowerCase())]
  return (
    <span
      aria-hidden
      className={cx(box, "flex shrink-0 items-center justify-center font-semibold tracking-[-0.02em] select-none")}
      style={{ background: `linear-gradient(180deg, ${tone.fill}, color-mix(in srgb, ${tone.fill} 72%, black))`, color: tone.ink }}
    >
      {letterOf(title)}
    </span>
  )
}

export function ChannelFace({ icon, lead, title, size }: { icon: ChannelIcon | null; lead: string | null; title: string; size: 36 | 40 }) {
  return lead ? <RobotAvatar name={lead} size={size} label="The lead" /> : <ChannelIconTile icon={icon} title={title} size={size} />
}

function letterOf(title: string): string {
  const ch = [...title.trim()][0]
  return ch ? ch.toUpperCase() : "?"
}
