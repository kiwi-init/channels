import { ComputerIcon, Settings01Icon } from "@hugeicons/core-free-icons"

import { MenuItem, MenuNote, MenuSeparator } from "./ui/menu"

export function AccountItems({ note, onComputers, onSettings }: { note: string; onComputers: () => void; onSettings: () => void }) {
  return (
    <>
      <MenuNote>{note}</MenuNote>
      <MenuItem icon={ComputerIcon} onClick={onComputers}>
        Your computers
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={Settings01Icon} onClick={onSettings}>
        Settings
      </MenuItem>
    </>
  )
}
