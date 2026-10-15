// The controls on the window's one header row that belong to the list rather than to a
// conversation: show or hide the list (at the list's far edge while it's open), and, while it's
// hidden, new beside it, floating over the conversation's top-left corner past a Mac's traffic lights.

import { Add01Icon, Login01Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons"

import { toggleSidebar, useSidebarOpen } from "@/lib/sidebar"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { IconButton } from "./kit"
import { Menu, MenuItem } from "./ui/menu"

const mac = /Mac/.test(navigator.platform)

/** One round glass control on the header row: 36px, 8px above and below it (index.css, the chrome's grid). */
const ROUND = "glass size-9 text-ink"

export function SidebarToggle({ className }: { className?: string }) {
  const open = useSidebarOpen()
  return (
    <IconButton label={`${open ? "Hide" : "Show"} the list (${mac ? "⌘B" : "Ctrl+B"})`} round className={cx(ROUND, "hidden md:inline-flex", className)} onClick={toggleSidebar}>
      <Icon icon={SidebarLeftIcon} size={18} />
    </IconButton>
  )
}

function NewMenu({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  return (
    <Menu
      align="end"
      className="w-52"
      trigger={
        <IconButton label="New channel or join" round className={ROUND}>
          <Icon icon={Add01Icon} size={19} />
        </IconButton>
      }
    >
      <MenuItem icon={Add01Icon} onClick={onNew}>
        New channel
      </MenuItem>
      <MenuItem icon={Login01Icon} onClick={onJoin}>
        Join with a code
      </MenuItem>
    </Menu>
  )
}

/** While the list is hidden: its controls float at the top-left of the window, past a Mac's traffic lights. */
export function ListControls({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  const open = useSidebarOpen()
  if (open) return null
  return (
    <div className="no-drag pointer-events-none absolute top-0 left-0 z-30 hidden h-(--chrome-h) items-center gap-2 pl-3 md:flex shell-mac:pl-(--lights-w) [&>*]:pointer-events-auto">
      <SidebarToggle />
      <NewMenu onNew={onNew} onJoin={onJoin} />
    </div>
  )
}

/** The header row's left the floating list controls take while the list is hidden: gutter, two 36px controls 8px apart, a gutter after. */
export const LEAD_WHEN_HIDDEN = "md:pl-[104px] shell-mac:md:pl-[184px]"
