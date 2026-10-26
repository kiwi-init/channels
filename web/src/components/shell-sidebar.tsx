import { Add01Icon, ArrowLeft01Icon, LockIcon, Settings02Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons"
import { createContext, useContext, useState, type ReactNode } from "react"

import type { ChannelRow } from "@/lib/channel"
import type { RowNews } from "@/lib/news"
import { useIcons } from "@/lib/icons"
import { useOwnPicture } from "@/lib/own-picture"
import { useSecrets } from "@/lib/secrets"
import { SIDEBAR_KEYS, toggleSidebar, useSidebarHidden } from "@/lib/sidebar-hidden"
import { useUpdate } from "@/lib/update"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { Icon } from "./icon"
import { IconButton, Monogram } from "./kit"
import { AccountItems, UpdateButton } from "./lazy"
import { rowNote } from "./sidebar"
import { Menu } from "./ui/menu"

const ChannelSlot = createContext<HTMLElement | null>(null)
const PlaceSlot = createContext<HTMLElement | null>(null)

export const useChannelSlot = (): HTMLElement | null => useContext(ChannelSlot)

export const usePlaceSlot = (): HTMLElement | null => useContext(PlaceSlot)

const SIDEBAR_HEAD = "drag flex h-(--card-head) shrink-0 items-center gap-1 px-(--step) shell-mac:pl-[calc(var(--lights-w)-var(--step))]"

const CONTROL = "no-drag size-(--control) text-ink-2 hover:text-ink"

export function SidebarToggle() {
  const hidden = useSidebarHidden()
  return (
    <IconButton label={`${hidden ? "Show" : "Hide"} the sidebar (${SIDEBAR_KEYS})`} round className={CONTROL} onClick={toggleSidebar}>
      <Icon icon={SidebarLeftIcon} size={16} />
    </IconButton>
  )
}

export function PlaceHead({ title, back, onBack, children }: { title: string; back: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className={SIDEBAR_HEAD}>
      <IconButton label={back} round className={CONTROL} onClick={onBack}>
        <Icon icon={ArrowLeft01Icon} size={16} />
      </IconButton>
      <span className="min-w-0 flex-1 truncate text-ui font-semibold">{title}</span>
      {children}
    </div>
  )
}

function News({ n }: { n: RowNews | undefined }) {
  if (n?.needs)
    return (
      <span
        aria-label={n.needs === 1 ? "1 needs you" : `${n.needs} need you`}
        className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-stamp font-semibold text-accent-ink tabular-nums"
      >
        {n.needs}
      </span>
    )
  if (n?.fresh) return <span aria-label="New messages" className="size-2 shrink-0 rounded-full bg-accent" />
  return null
}

export function ShellSidebar({
  rows,
  news,
  active,
  inChannel,
  place,
  onSelect,
  onNew,
  onComputers,
  onSettings,
  children,
}: {
  rows: ChannelRow[]
  news: RowNews[]
  active: string
  inChannel: boolean
  place: boolean
  onSelect: (code: string) => void
  onNew: () => void
  onComputers: () => void
  onSettings: () => void
  children: ReactNode
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [placeSlot, setPlaceSlot] = useState<HTMLElement | null>(null)
  const hidden = useSidebarHidden() && inChannel
  const person = useSecrets().person
  const picture = useOwnPicture()
  const update = useUpdate()
  const icons = useIcons()
  const newsOf = new Map(rows.map((c, i) => [c.room, news[i]]))

  return (
    <ChannelSlot.Provider value={hidden ? null : slot}>
      <PlaceSlot.Provider value={place ? placeSlot : null}>
        <div className="flex h-svh overflow-clip md:bg-(--shell)">
          <aside aria-label="Channels" className={cx("w-[280px] shrink-0 flex-col py-(--step) pl-(--step)", hidden ? "hidden" : "hidden md:flex")}>
            {place && <div ref={setPlaceSlot} className="flex min-h-0 flex-1 flex-col" />}
            <div className={cx(SIDEBAR_HEAD, place && "hidden")}>
              {inChannel && <SidebarToggle />}
              <span className="flex-1" />
              <IconButton label="New channel" round className={CONTROL} onClick={onNew}>
                <Icon icon={Add01Icon} size={16} />
              </IconButton>
            </div>

            <nav aria-label="Your channels" className={cx("mt-(--step) min-h-0 flex-1 overflow-y-auto", place && "hidden")}>
              <ul className="space-y-0.5">
                {rows.map((c) => {
                  const open = c.code === active
                  const n = newsOf.get(c.room)
                  return (
                    <li key={c.room} className="group/channel">
                      <button
                        type="button"
                        onClick={() => onSelect(c.code)}
                        aria-current={open ? "page" : undefined}
                        title={rowNote(c)}
                        className={cx(
                          "flex h-9 w-full items-center gap-2.5 rounded-ctl px-3 text-left text-ui transition-colors",
                          open ? "bg-(--chosen) font-semibold text-ink group-has-[section_[aria-current=page]]/channel:bg-transparent" : "text-ink-2 hover:bg-wash hover:text-ink"
                        )}
                      >
                        <span className={cx("flex", c.state !== "member" && "grayscale")}>
                          <ChannelIconTile icon={icons.get(c.room) ?? null} title={c.title} size={20} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        {c.state !== "member" && c.state !== "pending" && <Icon icon={LockIcon} size={12} className="shrink-0 text-ink-3" />}
                        {!open && <News n={n} />}
                      </button>
                      {open && <div ref={setSlot} />}
                    </li>
                  )
                })}
              </ul>
            </nav>

            <div className="flex h-(--card-head) shrink-0 items-center gap-1 px-2">
              {person && (
                <Menu
                  side="top"
                  className="w-60"
                  trigger={
                    <button type="button" className="flex min-w-0 items-center gap-2 rounded-full pr-2 text-ui text-ink-2 transition-colors hover:text-ink">
                      <Monogram name={person.name} size={22} picture={picture} />
                      <span className="truncate">{person.name}</span>
                    </button>
                  }
                >
                  <AccountItems note={`Key ${person.pk.slice(0, 12)}`} onComputers={onComputers} onSettings={onSettings} />
                </Menu>
              )}
              <span className="flex-1" />
              {update && <UpdateButton update={update} className={cx(CONTROL, "flex items-center justify-center rounded-full hover:bg-wash")} />}
              <IconButton label="Settings" round className={CONTROL} onClick={onSettings}>
                <Icon icon={Settings02Icon} size={16} />
              </IconButton>
            </div>
          </aside>
          {children}
        </div>
      </PlaceSlot.Provider>
    </ChannelSlot.Provider>
  )
}
