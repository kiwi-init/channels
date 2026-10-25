import { Add01Icon, LockIcon } from "@hugeicons/core-free-icons"

import type { ChannelRow } from "@/lib/channel"
import type { RowNews } from "@/lib/news"
import { useIcons } from "@/lib/icons"
import { useOwnPicture } from "@/lib/own-picture"
import { formatShort } from "@/lib/format"
import { useSecrets } from "@/lib/secrets"
import { useUpdate } from "@/lib/update"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { Icon } from "./icon"
import { Monogram, Wordmark } from "./kit"
import { AccountItems, UpdatePill } from "./lazy"
import { Menu } from "./ui/menu"

/** What a row says on hover: what was said last, or why this browser can't open it yet. */
export function rowNote(c: ChannelRow): string {
  if (c.state === "pending") return "Waiting for the owner to let you in"
  if (c.state === "elsewhere") return `On ${c.relay}: switch back to that relay in Settings to open it`
  if (c.state === "agents") return c.agents === 1 ? "One of your agents is here" : `${c.agents} of your agents are here`
  if (c.recent?.text) return c.recent.from ? `${c.recent.from}: ${c.recent.text}` : c.recent.text
  return "No messages yet"
}

/** Your channels: the ones this app is in or waiting on. */
export function Sidebar({
  rows,
  news,
  active,
  onSelect,
  onNew,
  onComputers,
  onSettings,
  className,
}: {
  rows: ChannelRow[]
  /** What's new in each row, in the same order. */
  news: RowNews[]
  active: string
  onSelect: (code: string) => void
  onNew: () => void
  onComputers: () => void
  onSettings: () => void
  className?: string
}) {
  const person = useSecrets().person
  const picture = useOwnPicture()
  const update = useUpdate()
  const newsOf = new Map(rows.map((c, i) => [c.room, news[i]]))
  const icons = useIcons()

  return (
    <aside className={cx("relative h-full w-full shrink-0 flex-col bg-canvas md:w-[300px]", className)}>
      {/* The list's part of the window's one header row: past a Mac's traffic lights, and the toggle
          that hides the list at its far edge, by the conversation. The row moves the window in the
          desktop app. (⌘K still searches everything.) */}
      <header className="drag flex h-(--chrome-h) shrink-0 items-center gap-2 px-3 shell-mac:pl-(--lights-w)">
        {!person && !rows.length && <Wordmark className="pl-1 text-title" />}
        <span className="flex-1" />
      </header>

      {/* New, inline as the list's first row (as Grok has "New chat"), on the rows' grid: its + where a
          channel's face is, its words where a name is. Joining with a code is in its dialog (and ⌘K). */}
      <div className="shrink-0 px-3 pb-1">
        <button type="button" onClick={onNew} className="flex h-12 w-full items-center gap-3 rounded-card px-3 text-left text-ink-2 transition-colors hover:bg-wash hover:text-ink">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1.5px_var(--edge-strong)]">
            <Icon icon={Add01Icon} size={18} />
          </span>
          <span className="text-body font-medium">New channel</span>
        </button>
      </div>

      {/* Channels only: a channel's tasks and direct conversations are tabs in the channel itself. */}
      <nav aria-label="Channels" className={cx("flex-1 space-y-1 overflow-y-auto px-3 pt-1", person ? "pb-20" : "pb-3")}>
        {rows.map((c) => {
          const selected = c.code === active
          const reachable = c.state === "member"
          const n = newsOf.get(c.room)
          // The open channel shows its own news; its row says only what needs you.
          const fresh = !selected && !!n?.fresh
          return (
            <button
              key={c.room}
              type="button"
              onClick={() => onSelect(c.code)}
              aria-current={selected ? "page" : undefined}
              title={rowNote(c)}
              className={cx("flex h-16 w-full items-center gap-3 rounded-card px-3 text-left transition-colors", selected ? "bg-(--chosen)" : "hover:bg-wash")}
            >
              <ChannelIconTile icon={icons.get(c.room) ?? null} title={c.title} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cx("min-w-0 flex-1 truncate text-body font-semibold", !reachable && "text-ink-2")}>{c.title}</span>
                  {reachable ? (
                    <span className={cx("shrink-0 text-meta tabular-nums", fresh || n?.needs ? "font-medium text-accent-text" : "text-ink-3")}>{formatShort(c.ts)}</span>
                  ) : c.state !== "pending" ? (
                    <Icon icon={LockIcon} size={12} className="shrink-0 text-ink-3" />
                  ) : null}
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className={cx("min-w-0 flex-1 truncate text-ui", fresh ? "font-medium text-ink" : "text-ink-3")}>{rowNote(c)}</span>
                  {n?.needs ? (
                    <span
                      aria-label={n.needs === 1 ? "1 needs you" : `${n.needs} need you`}
                      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-stamp font-semibold text-accent-ink tabular-nums"
                    >
                      {n.needs}
                    </span>
                  ) : fresh ? (
                    // Unread: Messages' blue dot (last in the row, so the row is still named for its channel).
                    <span aria-label="New messages" className="size-2.5 shrink-0 rounded-full bg-accent" />
                  ) : null}
                </span>
              </span>
            </button>
          )
        })}
        {rows.length === 0 && <p className="px-3 py-4 text-ui leading-normal text-ink-3">Channels you create or join show up here.</p>}
      </nav>

      {/* Who you are, at the foot of the list as Grok keeps it: your face and name on a glass pill that
          floats over the list, the menu above it; an update of the app, when there is one, above that. */}
      {person && (
        <div className="scrim-bottom absolute inset-x-0 bottom-0 flex flex-col items-start gap-2 px-3 pt-6 pb-3 [&>*]:pointer-events-auto">
          {update && <UpdatePill update={update} />}
          <Menu
            side="top"
            className="w-60"
            trigger={
              <button type="button" className="glass flex h-10 max-w-full items-center gap-2 rounded-full pr-4 pl-1 transition-colors">
                <Monogram name={person.name} size={32} picture={picture} />
                <span className="truncate text-ui font-semibold">{person.name}</span>
              </button>
            }
          >
            <AccountItems note={`Key ${person.pk.slice(0, 12)}`} onComputers={onComputers} onSettings={onSettings} />
          </Menu>
        </div>
      )}
    </aside>
  )
}
