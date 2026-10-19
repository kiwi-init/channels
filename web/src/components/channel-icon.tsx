import { ROBOT_FACES, type ChannelIcon, type RobotFace } from "@kiwi/core/protocol.ts"
import { robotFor, robotUrl } from "@/lib/avatars"
import { cx } from "@/lib/utils"

const SIZE: Record<number, string> = {
  20: "size-5 text-meta",
  28: "size-7 text-ui",
  32: "size-8 text-ui",
  36: "size-9 text-body",
  40: "size-10 text-title",
  48: "size-12 text-display",
  64: "size-16 text-display",
  112: "size-28 text-display",
}

type TileSize = 20 | 28 | 32 | 36 | 40 | 48 | 64 | 112

export function ChannelIconTile({ icon, title, size }: { icon: ChannelIcon | null; title: string; size: TileSize }) {
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
  const face = icon?.kind === "robot" ? icon.robot : robotFor(title.trim().toLowerCase())
  return <img src={robotUrl(face)} alt="" width={size} height={size} draggable={false} className={cx(SIZE[size], "shrink-0 select-none")} />
}

export function RobotPicker({ value, onPick, disabled }: { value: RobotFace | null; onPick: (face: RobotFace) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Channel icon" className="grid grid-cols-6 gap-1.5">
      {ROBOT_FACES.map((face) => (
        <button
          key={face}
          type="button"
          role="radio"
          aria-checked={value === face}
          aria-label={`${face} robot`}
          disabled={disabled}
          onClick={() => onPick(face)}
          className={cx("flex aspect-square items-center justify-center rounded-full p-0.5 transition-colors hover:bg-wash disabled:opacity-50", value === face && "bg-accent-wash ring-2 ring-accent")}
        >
          <img src={robotUrl(face)} alt="" draggable={false} className="size-full select-none" />
        </button>
      ))}
    </div>
  )
}
