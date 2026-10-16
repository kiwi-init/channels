// The controls on the window's one header row that belong to the list rather than to a
// conversation: show or hide the list (at the list's far edge while it's open), and, while it's
// hidden, new beside it, floating over the conversation's top-left corner past a Mac's traffic lights.

import { SidebarLeftIcon } from "@hugeicons/core-free-icons"

import { toggleSidebar, useSidebarOpen } from "@/lib/sidebar"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { IconButton } from "./kit"

const mac = /Mac/.test(navigator.platform)

/** One round glass control on the header row: 36px, 8px above and below it (index.css, the chrome's grid). */
const ROUND = "glass size-9 text-ink"

export function SidebarToggle({ className }: { className?: string }) {
  const open = useSidebarOpen()
  return (
    <IconButton label={`${open ? "Collapse" : "Expand"} the list (${mac ? "⌘B" : "Ctrl+B"})`} round className={cx(className ?? ROUND, "hidden md:inline-flex")} onClick={toggleSidebar}>
      <Icon icon={SidebarLeftIcon} size={18} />
    </IconButton>
  )
}
