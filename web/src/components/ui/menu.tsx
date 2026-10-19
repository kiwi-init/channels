import { cloneElement, isValidElement, useState, type MouseEvent, type ReactElement, type ReactNode } from "react"
import type { Menu as Base } from "@base-ui/react/menu"

import { later } from "@/lib/later"
import type { IconSvgElement } from "../icon"

type MenuProps = {
  trigger: Base.Trigger.Props["render"]
  children: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  className?: string
}
type ItemProps = Base.Item.Props & { tone?: "danger"; className?: string; icon?: IconSvgElement; hint?: string }

const parts = () => import("./menu-base")
const item = later<ItemProps>(() => parts().then((m) => m.MenuItem))
const separator = later<object>(() => parts().then((m) => m.MenuSeparator))
const menu = later<MenuProps & { defaultOpen: boolean; onEarlyClick: () => void }>(
  () => {
    item.load()
    separator.load()
    return parts().then((m) => m.Menu)
  },
  ({ trigger, onEarlyClick }) =>
    isValidElement<{ onClick?: (e: MouseEvent) => void }>(trigger) ? cloneElement(trigger as ReactElement<{ onClick?: (e: MouseEvent) => void }>, { onClick: onEarlyClick }) : null
)

export function Menu(props: MenuProps) {
  const [early, setEarly] = useState(false)
  return <menu.View {...props} defaultOpen={early} onEarlyClick={() => setEarly(true)} />
}

export const MenuItem = item.View
export const MenuSeparator = separator.View

export function MenuNote({ children }: { children: ReactNode }) {
  return <p className="truncate px-2 pt-1.5 pb-2 text-meta text-ink-2">{children}</p>
}
