import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, LockIcon, MinusSignIcon, Settings02Icon, SidebarLeftIcon, SquareIcon } from "@hugeicons/core-free-icons"
import { createContext, useContext, useState, type ReactNode } from "react"

import type { ChannelRow } from "@/lib/channel"
import type { RowNews } from "@/lib/news"
import { useIcons } from "@/lib/icons"
import { useOwnPicture } from "@/lib/own-picture"
import { bridge, useSecrets } from "@/lib/secrets"
import { SIDEBAR_KEYS, toggleSidebar, useSidebarHidden } from "@/lib/sidebar-hidden"
import { useUpdate } from "@/lib/update"
import { cx } from "@/lib/utils"
import { requestDetails } from "@/lib/details-request"
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

const WINDOW_ACTIONS = [
  ["close", Cancel01Icon, "Close window"],
  ["minimize", MinusSignIcon, "Minimize window"],
  ["maximize", SquareIcon, "Maximize window"],
] as const

export function WindowControls() {
  const b = bridge()
  if (!b?.windowControl) return null
  return (
    <span className="no-drag mr-1 hidden shrink-0 items-center gap-1.5 shell-float:flex">
      {WINDOW_ACTIONS.map(([action, icon, label]) => (
        <button
          key={action}
          type="button"
          aria-label={label}
          title={label}
          onClick={() => void b.windowControl(action).catch(() => undefined)}
          className={cx(
            "flex size-5 items-center justify-center rounded-full bg-wash text-ink-2 transition-colors hover:text-ink",
            action === "close" ? "hover:bg-alert hover:text-white" : "hover:bg-wash-2"
          )}
        >
          <Icon icon={icon} size={11} strokeWidth={2.2} />
        </button>
      ))}
    </span>
  )
}

export function PlaceHead({ title, back, onBack, children }: { title: string; back: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className={SIDEBAR_HEAD}>
      <WindowControls />
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
  const [folded, setFolded] = useState(false)
  const hidden = useSidebarHidden() && inChannel
  const person = useSecrets().person
  const picture = useOwnPicture()
  const update = useUpdate()
  const icons = useIcons()
  const newsOf = new Map(rows.map((c, i) => [c.room, news[i]]))

  return (
    <ChannelSlot.Provider value={hidden ? null : slot}>
      <PlaceSlot.Provider value={place ? placeSlot : null}>
        <div className="flex h-svh overflow-clip">
          <aside aria-label="Channels" className={cx("w-[280px] shrink-0 flex-col py-(--step) pl-(--step)", hidden ? "hidden" : "hidden md:flex")}>
            {place && <div ref={setPlaceSlot} className="flex min-h-0 flex-1 flex-col" />}
            <div className={cx(SIDEBAR_HEAD, place && "hidden")}>
              <WindowControls />
              {inChannel && <SidebarToggle />}
              <span className="flex-1" />
              <IconButton label="New channel" round className={CONTROL} onClick={onNew}>
                <Icon icon={Add01Icon} size={16} />
              </IconButton>
            </div>

            <nav aria-label="Your channels" className={cx("mt-(--step) min-h-0 flex-1 overflow-y-auto", place && "hidden")}>
              <p className="px-2.5 pb-1.5 text-meta font-semibold text-ink-3">Channels</p>
              <ul className="space-y-0.5">
                {rows.map((c) => {
                  const open = c.code === active
                  const n = newsOf.get(c.room)
                  return (
                    <li key={c.room} className="group/channel">
                      <div
                        className={cx(
                          "group/row flex h-8 w-full items-center rounded-ctl text-ui transition-colors",
                          open ? "bg-(--chosen) font-semibold text-ink group-has-[section_[aria-current=page]]/channel:bg-transparent" : "text-ink-2 hover:bg-wash hover:text-ink"
                        )}
                      >
                        <button
                          type="button"
                          aria-label={`${open && !folded ? "Collapse" : "Expand"} ${c.title}`}
                          aria-expanded={open && !folded}
                          onClick={() => (open ? setFolded((f) => !f) : (setFolded(false), onSelect(c.code)))}
                          className="flex h-full w-7 shrink-0 items-center justify-center rounded-l-ctl text-ink-3 hover:text-ink"
                        >
                          <Icon icon={ArrowRight01Icon} size={12} className={cx("transition-transform", open && !folded && "rotate-90")} />
                        </button>
                        <button
                          type="button"
                          onClick={() => (setFolded(false), onSelect(c.code))}
                          aria-current={open ? "page" : undefined}
                          title={rowNote(c)}
                          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className={cx("flex w-5 shrink-0 justify-center", c.state !== "member" && "grayscale")}>
                            <ChannelIconTile icon={icons.get(c.room) ?? null} title={c.title} size={20} />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{c.title}</span>
                          {c.state !== "member" && c.state !== "pending" && <Icon icon={LockIcon} size={12} className="shrink-0 text-ink-3" />}
                          {!open && <News n={n} />}
                        </button>
                        {c.state === "member" && (
                          <span className={cx("mr-1 shrink-0", open ? "flex" : "hidden group-hover/row:flex")}>
                            <IconButton
                              label={`Details: ${c.title}`}
                              round
                              className="no-drag size-6 text-ink-3 hover:text-ink"
                              onClick={() => (open ? requestDetails(c.code) : (requestDetails(c.code), onSelect(c.code)))}
                            >
                              <Icon icon={Settings02Icon} size={14} />
                            </IconButton>
                          </span>
                        )}
                      </div>
                      {open && <div ref={setSlot} className={cx(folded && "hidden")} />}
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
