import { ArrowLeft01Icon, BotIcon, Search01Icon, TaskDone01Icon } from "@hugeicons/core-free-icons"
import type { Dispatch, ReactNode, SetStateAction } from "react"

import type { ChannelIcon } from "@kiwi/core/protocol.ts"

import { TABS, type Tab, type View } from "@/lib/views"
import { useSidebarHidden } from "@/lib/sidebar-hidden"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "../channel-icon"
import { HoldBanner } from "../controls"
import { Icon } from "../icon"
import { IconButton } from "../kit"
import { SidebarToggle } from "../shell-sidebar"

export function Header({
  headRef,
  onBack,
  search,
  setSearch,
  tab,
  onTab,
  heading,
  wideHeading,
  headingLabel,
  face,
  status,
  onTitle,
  searchHint,
  places,
  needs,
  view,
  counts,
  onView,
  reviewing,
}: {
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
  places: ReactNode
  needs: number
  view: View
  counts: Record<View, number>
  onView: (v: View) => void
  reviewing: boolean
}) {
  const wide = useSidebarHidden()
  const place = wideHeading !== face.title ? wideHeading : null
  const toggle = (t: Tab) => onTab(tab === t ? "conversation" : t)
  const views: [View, string][] = [["everything", "Everything"], ["needs", "Needs you"], ["doing", "Working"], ...(reviewing ? ([["review", "In review"]] as [View, string][]) : []), ["done", "Done"]]
  return (
    <header ref={headRef} className="absolute inset-x-0 top-0 z-20 bg-canvas">
      <div className={cx("drag relative hidden h-(--card-head) items-center gap-(--step) px-(--step) md:flex", wide && "shell-mac:pl-[calc(var(--lights-w)-var(--step))]")}>
        <span className="flex min-w-0 flex-1 items-center gap-(--step)">
          {wide && <SidebarToggle />}
          {wide && places}
        </span>
        {tab === "tasks" ? (
          <nav aria-label="Views" className="no-drag flex h-(--control) min-w-0 shrink items-center gap-0.5 rounded-full bg-(--well) p-0.5">
            {views.map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-current={view === v ? "page" : undefined}
                onClick={() => onView(v)}
                className={cx(
                  "flex h-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-ui transition-colors",
                  view === v ? "bg-segment font-semibold text-ink" : "text-ink-2 hover:text-ink"
                )}
              >
                {label}
                {v !== "everything" && counts[v] > 0 && <span className="text-meta text-ink-3 tabular-nums">{counts[v]}</span>}
              </button>
            ))}
          </nav>
        ) : (
          <button
            type="button"
            aria-label={headingLabel}
            onClick={onTitle}
            className="no-drag flex h-(--control) max-w-[60%] min-w-0 items-center gap-2 rounded-full bg-(--well) px-3 text-ui transition-colors hover:bg-wash-2"
          >
            <ChannelIconTile icon={face.icon} title={face.title} size={20} />
            <span className="shrink-0 font-semibold">{face.title}</span>
            {place && <span className="shrink-0 text-ink-2">{place}</span>}
            {status.length > 0 && <span className="min-w-0 truncate text-meta text-ink-3">{status.join(" · ")}</span>}
          </button>
        )}
        <span className="flex flex-1 items-center justify-end gap-0.5">
          <IconButton
            label="Search"
            round
            className="no-drag size-(--control)"
            active={search !== null}
            aria-pressed={search !== null}
            onClick={() => {
              if (search === null && tab !== "conversation") onTab("conversation")
              setSearch((s) => (s === null ? "" : null))
            }}
          >
            <Icon icon={Search01Icon} size={15} />
          </IconButton>
          <IconButton
            label={needs ? `Tasks, ${needs} need you` : "Tasks"}
            round
            className="no-drag size-(--control)"
            active={tab === "tasks"}
            aria-pressed={tab === "tasks"}
            onClick={() => toggle("tasks")}
          >
            <Icon icon={TaskDone01Icon} size={15} />
            {needs > 0 && <span aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-alert" />}
          </IconButton>
          <IconButton label="Agents" round className="no-drag size-(--control)" active={tab === "agents"} aria-pressed={tab === "agents"} onClick={() => toggle("agents")}>
            <Icon icon={BotIcon} size={15} />
          </IconButton>
        </span>
      </div>
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
        <div className="relative mx-auto w-full max-w-[792px] px-3 pb-2">
          <label className="flex h-9 items-center gap-2 rounded-full px-3.5 text-ink-3 edge">
            <Icon icon={Search01Icon} size={16} className="shrink-0" />
            <input
              autoFocus
              value={search}
              aria-label="Search messages"
              placeholder={searchHint}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearch(null)}
              className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
            />
          </label>
        </div>
      )}
      <div className="relative">
        <HoldBanner />
      </div>
    </header>
  )
}
