import { Menu as Base } from "@base-ui/react/menu"
import type { ReactNode } from "react"

import { cx } from "@/lib/utils"
import { Icon, type IconSvgElement } from "../icon"

// Menus on Base UI: keyboard, focus and outside-click come for free. Pass the
// element that opens it as `trigger`; it keeps its own look.

const POP = "rounded-card bg-raised p-1 text-ink shadow-pop outline-none"
/** Popups grow out of their anchor on open and leave at once on close. */
const POP_IN = "origin-(--transform-origin) transition-[opacity,scale] duration-120 ease-out data-starting-style:scale-[0.98] data-starting-style:opacity-0"
const ITEM =
  "flex w-full cursor-default items-center gap-2 rounded-ctl px-2 py-1.5 text-left text-ui outline-none select-none data-disabled:opacity-40 data-highlighted:bg-wash-2 data-highlighted:text-ink"

export function Menu({
  trigger,
  children,
  side = "bottom",
  align = "start",
  className,
  defaultOpen,
}: {
  trigger: Base.Trigger.Props["render"]
  children: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  className?: string
  defaultOpen?: boolean
}) {
  return (
    <Base.Root defaultOpen={defaultOpen}>
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner side={side} align={align} sideOffset={6} className="no-drag z-50 outline-none">
          <Base.Popup className={cx(POP, POP_IN, "min-w-44", className)}>{children}</Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  )
}

/** A menu row: an optional icon (quiet, 16px), the label, and an optional key hint on the right. */
export function MenuItem({ className, tone, icon, hint, children, ...props }: Base.Item.Props & { tone?: "danger"; className?: string; icon?: IconSvgElement; hint?: string }) {
  return (
    <Base.Item className={cx(ITEM, tone === "danger" && "text-alert", className)} {...props}>
      {icon && <Icon icon={icon} size={16} strokeWidth={1.5} className={cx("shrink-0", tone === "danger" ? "text-alert" : "text-ink-3")} />}
      {icon || hint ? <span className="min-w-0 flex-1 truncate">{children as ReactNode}</span> : (children as ReactNode)}
      {hint && <kbd className="shrink-0 font-sans text-meta text-ink-3">{hint}</kbd>}
    </Base.Item>
  )
}

export function MenuSeparator() {
  return <Base.Separator className="mx-1 my-1 h-px bg-line" />
}
