import { ArrowLeft01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import type { Dispatch, ReactNode, SetStateAction } from "react"

import type { ChannelIcon } from "@kiwi/core/protocol.ts"

import { TABS, type Tab } from "@/lib/views"
import { useSidebarHidden } from "@/lib/sidebar-hidden"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "../channel-icon"
import { HoldBanner } from "../controls"
import { Icon } from "../icon"
import { IconButton } from "../kit"

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
}) {
  const wide = useSidebarHidden()
  return (
    <header ref={headRef} className="absolute inset-x-0 top-0 z-20 bg-canvas">
      <div className="drag relative flex h-(--chrome-h) items-center gap-1 px-2 sm:gap-3 sm:px-3 md:px-6">
        <IconButton label="Channels" className="size-9 text-ink md:hidden" onClick={onBack}>
          <Icon icon={ArrowLeft01Icon} size={20} />
        </IconButton>
        <button type="button" aria-label={headingLabel} onClick={onTitle} className="no-drag shrink-0 rounded-full sm:hidden">
          <ChannelIconTile icon={face.icon} title={face.title} size={28} />
        </button>
        <button type="button" aria-label={headingLabel} onClick={onTitle} className="no-drag hidden min-w-0 truncate text-left text-title sm:block">
          <span className="md:hidden">{heading}</span>
          <span className="hidden md:inline">{wideHeading}</span>
        </button>
        {wide && places}
        {status.length > 0 && <span className="hidden min-w-0 truncate text-meta text-ink-3 lg:block">{status.join(" · ")}</span>}
        <span className="flex-1" />
        <IconButton label="Search" className={cx("size-9", !wide && "md:hidden", search === null && "text-ink")} active={search !== null} onClick={() => setSearch((s) => (s === null ? "" : null))}>
          <Icon icon={Search01Icon} size={18} />
        </IconButton>
        <nav aria-label="Views of the channel" className={cx("no-drag flex items-center gap-1", !wide && "md:hidden")}>
          {TABS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? "page" : undefined}
              onClick={() => onTab(t)}
              className={cx(
                "relative h-9 rounded-row px-2 text-ui transition-colors hover:text-ink sm:px-2.5",
                tab === t ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-accent sm:after:inset-x-2.5" : "text-ink-2"
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      {search !== null && (
        <div className={cx("relative mx-auto w-full max-w-[792px] px-3 pb-2", !wide && "md:hidden")}>
          <label className="flex h-9 items-center gap-2 rounded-ctl px-3.5 text-ink-3 edge">
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
