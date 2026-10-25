import { Add01Icon, ArrowDown01Icon, LockIcon, Search01Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons"
import { useEffect, useRef, useState, type RefObject } from "react"

import type { ChannelIcon } from "@kiwi/core/protocol.ts"
import type { ChannelRow } from "@/lib/channel"
import type { RowNews } from "@/lib/news"
import { useIcons } from "@/lib/icons"
import { useOwnPicture } from "@/lib/own-picture"
import { formatShort } from "@/lib/format"
import { useSecrets } from "@/lib/secrets"
import { SIDEBAR_KEYS, toggleSidebar, useSidebarHidden } from "@/lib/sidebar-hidden"
import { fitTabs, type TabRoom } from "@/lib/tab-fit"
import { useUpdate } from "@/lib/update"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { Icon } from "./icon"
import { IconButton, Monogram } from "./kit"
import { rowNote } from "./sidebar"
import { AccountItems, UpdateButton } from "./lazy"
import { Menu, MenuItem, MenuSeparator } from "./ui/menu"
import { Tooltip } from "./ui/tooltip"

type Entry = { c: ChannelRow; n: RowNews | undefined }

const GAP = 4
const BAR_BUTTON = "no-drag flex size-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-wash hover:text-ink"

const hasNews = (n: RowNews | undefined) => !!n?.fresh || (n?.needs ?? 0) > 0

function NewsMark({ n }: { n: RowNews | undefined }) {
  if (n?.needs) return <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-stamp font-semibold text-accent-ink tabular-nums">{n.needs}</span>
  if (n?.fresh) return <span className="size-2 shrink-0 rounded-full bg-accent" />
  return null
}

function when(c: ChannelRow): string {
  return c.state === "member" ? formatShort(c.ts) : c.state === "pending" ? "Pending" : "Locked"
}

function TabFace({ c, icon }: { c: ChannelRow; icon: ChannelIcon | null }) {
  return (
    <span className={cx("flex", c.state !== "member" && "grayscale")}>
      <ChannelIconTile icon={icon} title={c.title} size={20} />
    </span>
  )
}

function TabBody({ c, n, open, icon }: Entry & { open: boolean; icon: ChannelIcon | null }) {
  return (
    <>
      <TabFace c={c} icon={icon} />
      <span className="max-w-40 min-w-0 truncate">{c.title}</span>
      {c.state !== "member" && c.state !== "pending" && <Icon icon={LockIcon} size={12} className="shrink-0 text-ink-3" />}
      {!open && <NewsMark n={n} />}
    </>
  )
}

const TAB = "flex h-9 shrink-0 items-center gap-2 rounded-ctl px-2.5 text-ui transition-colors [--band:58%]"

function Tab({ c, n, open, icon, onSelect }: Entry & { open: boolean; icon: ChannelIcon | null; onSelect: () => void }) {
  const needs = n?.needs ?? 0
  const note = rowNote(c)
  return (
    <Tooltip
      side="bottom"
      label={
        <span className="block max-w-64 py-0.5">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-semibold">{c.title}</span>
            <span className="shrink-0 font-normal tabular-nums opacity-70">{when(c)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 font-normal opacity-80">{note}</span>
          {needs > 0 && <span className="mt-1 block">{needs === 1 ? "1 needs you" : `${needs} need you`}</span>}
        </span>
      }
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={open ? "page" : undefined}
        aria-label={`${c.title}, ${when(c)}: ${note}${needs ? `, ${needs} ${needs === 1 ? "needs" : "need"} you` : n?.fresh && !open ? ", new messages" : ""}`}
        className={cx(TAB, open ? "prism-lit font-semibold text-ink" : "text-ink-2 hover:bg-wash hover:text-ink")}
      >
        <TabBody c={c} n={n} open={open} icon={icon} />
      </button>
    </Tooltip>
  )
}

function moreLabel(count: number) {
  return `${count} more`
}

function More({ hidden, icons, onSelect, onFind }: { hidden: Entry[]; icons: ReturnType<typeof useIcons>; onSelect: (code: string) => void; onFind: () => void }) {
  const news = hidden.some((e) => hasNews(e.n))
  const listed = [...hidden.filter((e) => hasNews(e.n)), ...hidden.filter((e) => !hasNews(e.n))]
  return (
    <Menu
      side="bottom"
      align="start"
      className="w-72"
      trigger={
        <button
          type="button"
          aria-label={`${moreLabel(hidden.length)} ${hidden.length === 1 ? "channel" : "channels"}${news ? ", with news" : ""}`}
          className="relative flex h-9 shrink-0 items-center gap-1 rounded-ctl px-2.5 text-ui text-ink-2 transition-colors hover:bg-wash hover:text-ink"
        >
          {moreLabel(hidden.length)}
          <Icon icon={ArrowDown01Icon} size={14} />
          {news && <span className="absolute top-1.5 right-1 size-2 rounded-full bg-accent" />}
        </button>
      }
    >
      <MenuItem icon={Search01Icon} hint="⌘K" onClick={onFind}>
        Find a channel
      </MenuItem>
      <MenuSeparator />
      <div className="max-h-[min(60vh,440px)] overflow-y-auto">
        {listed.map(({ c, n }) => (
          <MenuItem key={c.room} onClick={() => onSelect(c.code)} className="gap-2.5">
            <TabFace c={c} icon={icons.get(c.room) ?? null} />
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            {hasNews(n) ? <NewsMark n={n} /> : <span className="shrink-0 text-meta text-ink-3 tabular-nums">{when(c)}</span>}
          </MenuItem>
        ))}
      </div>
    </Menu>
  )
}

function useTabRoom(bar: RefObject<HTMLDivElement | null>, measure: RefObject<HTMLDivElement | null>, key: string): TabRoom | null {
  const [room, setRoom] = useState<TabRoom | null>(null)
  useEffect(() => {
    const box = bar.current
    const row = measure.current
    if (!box || !row || !key) return
    const take = () => {
      const items = [...row.children].map((el) => (el as HTMLElement).offsetWidth)
      const add = items.pop() ?? 0
      const more = items.pop() ?? 0
      setRoom({ widths: items, room: box.clientWidth - add - GAP, more, gap: GAP })
    }
    const watch = new ResizeObserver(take)
    for (const el of [box, row, ...row.children]) watch.observe(el)
    return () => watch.disconnect()
  }, [bar, measure, key])
  return room
}

export function ChannelTabs({
  rows,
  news,
  active,
  inChannel,
  onSelect,
  onNew,
  onFind,
  onComputers,
  onSettings,
}: {
  rows: ChannelRow[]
  news: RowNews[]
  active: string
  inChannel: boolean
  onSelect: (code: string) => void
  onNew: () => void
  onFind: () => void
  onComputers: () => void
  onSettings: () => void
}) {
  const person = useSecrets().person
  const picture = useOwnPicture()
  const update = useUpdate()
  const icons = useIcons()
  const hidden = useSidebarHidden()
  const bar = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const entries: Entry[] = rows.map((c, i) => ({ c, n: news[i] })).sort((a, b) => a.c.at - b.c.at || 0)
  const key = entries.map(({ c, n }) => `${c.room}:${c.title}:${c.state}:${n?.needs ?? 0}:${n?.fresh ? 1 : 0}`).join("|")
  const room = useTabRoom(bar, measure, key)
  const open = entries.findIndex((e) => e.c.code === active)
  const shown = room && room.widths.length === entries.length ? fitTabs(room, open) : entries.map((_, i) => i)
  const rest = entries.filter((_, i) => !shown.includes(i))

  return (
    <header aria-label="Channels" className="drag relative hidden h-(--chrome-h) shrink-0 items-center gap-2 bg-(--shell) px-3 md:flex shell-mac:pl-(--lights-w)">
      {inChannel && (
        <IconButton label={`${hidden ? "Show" : "Hide"} the sidebar (${SIDEBAR_KEYS})`} round className="no-drag size-9 text-ink-2 hover:text-ink" onClick={toggleSidebar}>
          <Icon icon={SidebarLeftIcon} size={18} />
        </IconButton>
      )}
      <div ref={bar} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        <nav aria-label="Channel tabs" className="flex min-w-0 items-center gap-1">
          {shown.map((i) => {
            const { c, n } = entries[i]!
            return <Tab key={c.room} c={c} n={n} open={c.code === active} icon={icons.get(c.room) ?? null} onSelect={() => onSelect(c.code)} />
          })}
        </nav>
        {rest.length > 0 && <More hidden={rest} icons={icons} onSelect={onSelect} onFind={onFind} />}
        <Tooltip label="New channel">
          <button type="button" aria-label="New channel" onClick={onNew} className={BAR_BUTTON}>
            <Icon icon={Add01Icon} size={18} />
          </button>
        </Tooltip>
      </div>
      <div ref={measure} aria-hidden inert className="pointer-events-none invisible absolute top-0 left-0 flex gap-1">
        {entries.map(({ c, n }) => (
          <span key={c.room} className={cx(TAB, c.code === active && "font-semibold")}>
            <TabBody c={c} n={n} open={c.code === active} icon={icons.get(c.room) ?? null} />
          </span>
        ))}
        <span className="flex h-9 items-center gap-1 px-2.5 text-ui">
          {moreLabel(entries.length)}
          <Icon icon={ArrowDown01Icon} size={14} />
        </span>
        <span className="size-9" />
      </div>
      {update && <UpdateButton update={update} className={BAR_BUTTON} />}
      {person && (
        <Menu
          side="bottom"
          align="end"
          className="w-60"
          trigger={
            <button type="button" className="no-drag flex shrink-0 rounded-full">
              <Monogram name={person.name} size={32} picture={picture} />
              <span className="sr-only">{person.name}</span>
            </button>
          }
        >
          <AccountItems note={`${person.name} · key ${person.pk.slice(0, 12)}`} onComputers={onComputers} onSettings={onSettings} />
        </Menu>
      )}
    </header>
  )
}
