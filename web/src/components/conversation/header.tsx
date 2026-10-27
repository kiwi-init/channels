import { ArrowLeft01Icon, BotIcon, Cancel01Icon, Search01Icon, Settings02Icon, TaskDone01Icon } from "@hugeicons/core-free-icons"
import { useRef, type Dispatch, type ReactNode, type SetStateAction } from "react"

import type { ChannelIcon } from "@kiwi/core/protocol.ts"

import { TABS, type Tab, type View } from "@/lib/views"
import { useSidebarHidden } from "@/lib/sidebar-hidden"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "../channel-icon"
import { HoldBanner } from "../controls"
import { Icon } from "../icon"
import { IconButton } from "../kit"
import { SidebarToggle, WindowControls } from "../shell-sidebar"

export type HeaderProps = {
  headRef: (el: HTMLElement | null) => void
  onBack: () => void
  search: string | null
  setSearch: Dispatch<SetStateAction<string | null>>
  tab: Tab
  onTab: (t: Tab) => void
  heading: string
  /** On wide screens the sidebar names the view, so the header names the channel or conversation instead. */
  wideHeading: string
  headingLabel: string
  face: { icon: ChannelIcon | null; title: string }
  status: string[]
  onTitle: () => void
  searchHint: string
  onSearchKey?: (key: SearchKey) => void
  searchList?: { id: string; open: boolean; active: string | null }
  places: ReactNode
  needs: number
  view: View
  counts: Record<View, number>
  onView: (v: View) => void
  reviewing: boolean
}

type SearchKey = "up" | "down" | "enter"
const KEYS: Record<string, SearchKey> = { ArrowUp: "up", ArrowDown: "down", Enter: "enter" }

const SEGMENT = "no-drag relative flex h-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-ui transition-colors"

export function Toolbar({ search, setSearch, tab, onTab, headingLabel, face, onTitle, places, needs, onView }: HeaderProps) {
  const wide = useSidebarHidden()
  const toggle = (t: Tab) => onTab(tab === t ? "conversation" : t)
  const on = (yes: boolean) => (yes ? "bg-wash-2 font-semibold text-ink" : "text-ink-2 hover:bg-wash hover:text-ink")
  return (
    <div
      role="toolbar"
      aria-label={face.title}
      className={cx("drag relative mt-(--step) mr-(--step) hidden h-(--card-head) shrink-0 items-center gap-(--step) px-(--step) md:flex", wide && "shell-mac:pl-[calc(var(--lights-w)-var(--step))]")}
    >
      <span className="flex min-w-0 flex-1 items-center gap-(--step)">
        {wide && <WindowControls />}
        {wide && <SidebarToggle />}
        {wide && places}
        {wide && (
          <IconButton label={headingLabel} round className="no-drag size-(--control) text-ink-2 hover:text-ink" onClick={onTitle}>
            <Icon icon={Settings02Icon} size={15} />
          </IconButton>
        )}
      </span>
      <nav aria-label="Sections" className="absolute left-1/2 flex h-(--control) -translate-x-1/2 items-center gap-1">
        <button
          type="button"
          aria-pressed={search !== null}
          className={cx(SEGMENT, on(search !== null))}
          onClick={() => {
            if (search === null && tab !== "conversation") onTab("conversation")
            setSearch((s) => (s === null ? "" : null))
          }}
        >
          <Icon icon={Search01Icon} size={14} />
          Search
        </button>
        <button
          type="button"
          aria-pressed={tab === "tasks"}
          aria-label={needs ? `Tasks, ${needs} need you` : "Tasks"}
          className={cx(SEGMENT, on(tab === "tasks"))}
          onClick={() => (tab === "tasks" ? onTab("conversation") : onView("everything"))}
        >
          <Icon icon={TaskDone01Icon} size={14} />
          Tasks
          {needs > 0 && <span aria-hidden className="size-1.5 rounded-full bg-alert" />}
        </button>
        <button type="button" aria-pressed={tab === "agents"} className={cx(SEGMENT, on(tab === "agents"))} onClick={() => toggle("agents")}>
          <Icon icon={BotIcon} size={14} />
          Agents
        </button>
      </nav>
      <span className="flex-1" />
    </div>
  )
}

export function ViewsNav({ view, counts, onView, reviewing }: Pick<HeaderProps, "view" | "counts" | "onView" | "reviewing">) {
  const views: [View, string][] = [["everything", "Everything"], ["needs", "Needs you"], ["doing", "Working"], ...(reviewing ? ([["review", "In review"]] as [View, string][]) : []), ["done", "Done"]]
  return (
    <nav aria-label="Views" className="mx-auto mb-3 hidden h-(--control) w-fit items-center gap-0.5 rounded-full bg-wash p-0.5 md:flex">
      {views.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-current={view === v ? "page" : undefined}
          onClick={() => onView(v)}
          className={cx("flex h-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-ui transition-colors", view === v ? "bg-segment font-semibold text-ink" : "text-ink-2 hover:text-ink")}
        >
          {label}
          {v !== "everything" && counts[v] > 0 && <span className="text-meta text-ink-3 tabular-nums">{counts[v]}</span>}
        </button>
      ))}
    </nav>
  )
}

export function Header({ headRef, onBack, search, setSearch, tab, onTab, heading, headingLabel, face, onTitle, searchHint, onSearchKey, searchList, places }: HeaderProps) {
  const wide = useSidebarHidden()
  const input = useRef<HTMLInputElement>(null)
  return (
    <header ref={headRef} className="absolute inset-x-0 top-0 z-20 bg-canvas">
      <div className="drag relative flex h-(--chrome-h) items-center gap-1 px-2 sm:gap-3 sm:px-3 md:hidden">
        <IconButton label="Channels" round className="size-9 text-ink" onClick={onBack}>
          <Icon icon={ArrowLeft01Icon} size={20} />
        </IconButton>
        <button type="button" aria-label={headingLabel} onClick={onTitle} className="no-drag shrink-0 rounded-full sm:hidden">
          <ChannelIconTile icon={face.icon} title={face.title} size={28} />
        </button>
        <button type="button" aria-label={headingLabel} onClick={onTitle} className="no-drag hidden min-w-0 truncate text-left text-title sm:block">
          {heading}
        </button>
        {wide && places}
        <span className="flex-1" />
        <IconButton label="Search" round className={cx("size-9", search === null && "text-ink")} active={search !== null} onClick={() => setSearch((s) => (s === null ? "" : null))}>
          <Icon icon={Search01Icon} size={18} />
        </IconButton>
        <nav aria-label="Views of the channel" className="no-drag flex min-w-0 items-center gap-1">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? "page" : undefined}
              onClick={() => onTab(t)}
              className={cx(
                "relative h-9 min-w-0 truncate rounded-row px-1.5 text-ui transition-colors hover:text-ink sm:px-2.5",
                tab === t ? "font-semibold text-ink after:absolute after:inset-x-1.5 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-accent sm:after:inset-x-2.5" : "text-ink-2"
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      {search !== null && (
        <div className="relative mx-auto w-full max-w-[792px] px-3 pb-2 md:px-4 md:pt-(--step)">
          <label className="flex h-9 items-center gap-2 rounded-full px-3.5 text-ink-3 edge">
            <Icon icon={Search01Icon} size={16} className="shrink-0" />
            <input
              ref={input}
              autoFocus
              value={search}
              role={searchList ? "combobox" : undefined}
              aria-expanded={searchList ? searchList.open : undefined}
              aria-controls={searchList?.open ? searchList.id : undefined}
              aria-activedescendant={searchList?.open ? (searchList.active ?? undefined) : undefined}
              aria-autocomplete={searchList ? "list" : undefined}
              aria-label="Search messages and tasks"
              placeholder={searchHint}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearch(null)
                const key = KEYS[e.key]
                if (key && onSearchKey) {
                  e.preventDefault()
                  onSearchKey(key)
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
            />
            {search !== "" && (
              <button
                type="button"
                aria-label="Clear search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSearch("")
                  input.current?.focus()
                }}
                className="-mr-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-wash hover:text-ink"
              >
                <Icon icon={Cancel01Icon} size={14} />
              </button>
            )}
          </label>
        </div>
      )}
      <div className="relative">
        <HoldBanner />
      </div>
    </header>
  )
}
