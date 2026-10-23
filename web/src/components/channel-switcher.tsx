import { Add01Icon, ArrowDown01Icon, LockIcon, Search01Icon } from "@hugeicons/core-free-icons"

import type { ChannelIcon } from "@kiwi/core/protocol.ts"
import type { ChannelRow } from "@/lib/channel"
import { useChannelsNav } from "@/lib/channels-nav"
import type { RowNews } from "@/lib/news"
import { useIcons } from "@/lib/icons"
import { useOwnPicture } from "@/lib/own-picture"
import { formatShort } from "@/lib/format"
import { useSecrets } from "@/lib/secrets"
import { useUpdate } from "@/lib/update"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { Icon } from "./icon"
import { Monogram } from "./kit"
import { AccountItems, UpdateButton } from "./lazy"
import { Menu, MenuItem, MenuSeparator } from "./ui/menu"

type Entry = { c: ChannelRow; n: RowNews | undefined }

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

export function ChannelSwitcher({ title, icon, people, onDetails }: { title: string; icon: ChannelIcon | null; people: string; onDetails: () => void }) {
  const nav = useChannelsNav()
  const icons = useIcons()
  const entries: Entry[] = nav ? nav.rows.map((c, i) => ({ c, n: nav.news[i] })).sort((a, b) => a.c.at - b.c.at || 0) : []
  const others = entries.filter((e) => e.c.code !== nav?.active)
  const news = others.some((e) => hasNews(e.n))
  return (
    <Menu
      side="bottom"
      align="start"
      className="w-72"
      trigger={
        <button
          type="button"
          aria-label={`${title}: switch channel${news ? ", other channels have news" : ""}`}
          className="no-drag flex w-full items-center gap-3 rounded-row px-2 py-1.5 text-left transition-colors hover:bg-wash"
        >
          <ChannelIconTile icon={icon} title={title} size={36} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-title">{title}</span>
              <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-3" />
              {news && <span className="size-2 shrink-0 rounded-full bg-accent" />}
            </span>
            <span className="block truncate text-meta text-ink-3">{people}</span>
          </span>
        </button>
      }
    >
      <div className="max-h-[min(60vh,440px)] overflow-y-auto">
        {entries.map(({ c, n }) => (
          <MenuItem key={c.room} onClick={() => nav?.onSelect(c.code)} className={cx("gap-2.5", c.code === nav?.active && "font-semibold")}>
            <TabFace c={c} icon={icons.get(c.room) ?? null} />
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            {c.state !== "member" && c.state !== "pending" && <Icon icon={LockIcon} size={12} className="shrink-0 text-ink-3" />}
            {c.code !== nav?.active && hasNews(n) ? <NewsMark n={n} /> : <span className="shrink-0 text-meta text-ink-3 tabular-nums">{when(c)}</span>}
          </MenuItem>
        ))}
      </div>
      <MenuSeparator />
      <MenuItem icon={Search01Icon} hint="⌘K" onClick={() => nav?.onFind()}>
        Find a channel
      </MenuItem>
      <MenuItem icon={Add01Icon} onClick={() => nav?.onNew()}>
        New channel
      </MenuItem>
      <MenuItem onClick={onDetails}>Details of {title}</MenuItem>
    </Menu>
  )
}

export function AccountFoot() {
  const person = useSecrets().person
  const picture = useOwnPicture()
  const update = useUpdate()
  const nav = useChannelsNav()
  if (!person || !nav) return null
  return (
    <div className="mt-auto flex items-center gap-2 pt-4">
      <Menu
        side="top"
        align="start"
        className="w-60"
        trigger={
          <button type="button" aria-label={`${person.name}, your account`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-row px-2 py-1.5 text-left transition-colors hover:bg-wash">
            <Monogram name={person.name} size={28} picture={picture} />
            <span className="truncate text-ui text-ink-2">{person.name}</span>
          </button>
        }
      >
        <AccountItems note={`${person.name} · key ${person.pk.slice(0, 12)}`} onComputers={nav.onComputers} onSettings={nav.onSettings} />
      </Menu>
      {update && <UpdateButton update={update} className={BAR_BUTTON} />}
    </div>
  )
}
