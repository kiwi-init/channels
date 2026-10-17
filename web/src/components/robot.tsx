import { avatarUrl } from "@/lib/avatars"
import { cx } from "@/lib/utils"

export function RobotAvatar({ name, size = 28, label, className }: { name: string; size?: number; label?: string; className?: string }) {
  return (
    <img
      src={avatarUrl(name)}
      alt={label ?? ""}
      role={label ? "img" : undefined}
      width={size}
      height={size}
      draggable={false}
      className={cx("shrink-0 select-none", className)}
      style={{ width: size, height: size }}
    />
  )
}
