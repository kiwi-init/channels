import { ArrowLeft01Icon, CheckListIcon, Search01Icon } from "@hugeicons/core-free-icons"
import type { Dispatch, SetStateAction } from "react"

import { MAIN, type Place, type PlaceSummary } from "@/lib/threads"
import { cx } from "@/lib/utils"
import { HoldBanner } from "../controls"
import { Icon } from "../icon"
import { IconButton } from "../kit"
import type { Here, Side, Unread } from "./types"

export function Header({
  headRef,
  onBack,
  search,
  setSearch,
  places,
  unreadIn,
  taskKey,
  side,
  setSide,
  hereKey,
  title,
  subtitle,
  headline,
  info,
  onPick,
  place,
  placeTitle,
}: {
  headRef: (el: HTMLElement | null) => void
  onBack: () => void
  search: string | null
  setSearch: Dispatch<SetStateAction<string | null>>
  places: Map<string, PlaceSummary>
  unreadIn: (key: string) => Unread
  taskKey: string | null
  side: Side
  setSide: Dispatch<SetStateAction<Side>>
  hereKey: string
  title: string
  subtitle: string
  headline: string
  info: boolean
  onPick: (p: Place) => void
  place: Here
  placeTitle: string
}) {
  return (
    <header ref={headRef} className="absolute inset-x-0 top-0 z-20">
      <div aria-hidden className="scrim-top absolute inset-x-0 top-0 -bottom-6" />
      <div className="drag relative flex h-(--chrome-h) items-center gap-2 px-3">
        <IconButton label="Channels" round className="glass size-9 text-ink md:hidden" onClick={onBack}>
          <Icon icon={ArrowLeft01Icon} size={20} />
        </IconButton>
        <span className="flex-1" />
        <IconButton label="Search" round className={cx("glass size-9", search === null && "text-ink")} active={search !== null} onClick={() => setSearch((s) => (s === null ? "" : null))}>
          <Icon icon={Search01Icon} size={18} />
        </IconButton>
        <TasksButton places={places} unreadIn={unreadIn} shown={taskKey} active={side?.kind === "tasks"} onClick={() => setSide((s) => (s?.kind === "tasks" ? null : { kind: "tasks", task: null }))} />
      </div>
      <PlaceSwitch
        className="absolute top-0 left-1/2 h-(--chrome-h) -translate-x-1/2"
        current={hereKey}
        unreadIn={unreadIn}
        title={title}
        titleLabel={`Details: ${title}, ${subtitle}`}
        titleHint={headline}
        info={info}
        onTitle={() => setSide((s) => (s?.kind === "info" ? null : { kind: "info" }))}
        onPick={onPick}
      />
      {search !== null && (
        <div className="relative mx-auto w-full max-w-[792px] px-3 pb-2 md:px-4">
          <label className="glass flex h-9 items-center gap-2 rounded-full px-3.5 text-ink-3">
            <Icon icon={Search01Icon} size={16} className="shrink-0" />
            <input
              autoFocus
              value={search}
              aria-label="Search messages"
              placeholder={place.kind === "main" ? "Search this channel" : `Search ${placeTitle}`}
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

function PlaceSwitch({
  className,
  current,
  unreadIn,
  title,
  titleLabel,
  titleHint,
  info,
  onTitle,
  onPick,
}: {
  className?: string
  current: string
  unreadIn: (key: string) => Unread
  title: string
  titleLabel: string
  titleHint: string
  info: boolean
  onTitle: () => void
  onPick: (p: Place) => void
}) {
  return (
    <nav aria-label="Conversations" className={cx("no-drag flex items-center gap-2", className)}>
      <div className="glass flex h-9 items-center gap-0.5 rounded-full p-0.5">
        {current !== "main" && (
          <button
            type="button"
            aria-label="Back to chat"
            title="Back to the channel’s chat"
            onClick={() => onPick(MAIN)}
            className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-wash-2 hover:text-ink"
          >
            <Icon icon={ArrowLeft01Icon} size={17} />
            <Badge u={unreadIn("main")} />
          </button>
        )}
        <button
          type="button"
          aria-label={titleLabel}
          aria-expanded={info}
          title={titleHint}
          onClick={onTitle}
          className="flex h-8 max-w-[min(46vw,360px)] min-w-0 items-center rounded-full px-3 text-ui font-semibold transition-colors hover:bg-wash-2"
        >
          <span className="truncate">{title}</span>
        </button>
      </div>
    </nav>
  )
}

function TasksButton({
  places,
  unreadIn,
  shown,
  active,
  onClick,
}: {
  places: Map<string, PlaceSummary>
  unreadIn: (key: string) => Unread
  shown: string | null
  active: boolean
  onClick: () => void
}) {
  let forMe = 0
  let news = false
  for (const [k, i] of places) {
    if (i.place.kind !== "task" || i.done || k === shown) continue
    const u = unreadIn(k)
    if (u.forMe) forMe += u.n
    else if (u.n) news = true
  }
  return (
    <IconButton label="Tasks" round className={cx("glass size-9 xl:hidden", !active && "text-ink")} active={active} aria-expanded={active} onClick={onClick}>
      <Icon icon={CheckListIcon} size={18} />
      <Badge u={forMe ? { n: forMe, forMe: true } : { n: news ? 1 : 0, forMe: false }} />
    </IconButton>
  )
}

function Badge({ u }: { u: Unread }) {
  if (u.n <= 0) return null
  return u.forMe ? (
    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-stamp leading-none font-semibold text-accent-ink tabular-nums">{u.n}</span>
  ) : (
    <span aria-label="New messages" className="absolute top-0 right-0 size-2 rounded-full bg-accent" />
  )
}
