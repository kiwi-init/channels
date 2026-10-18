import { Add01Icon, ComputerIcon, Download04Icon, LockIcon, Settings01Icon } from "@hugeicons/core-free-icons"

import type { ChannelIcon } from "@kiwi/core/protocol.ts"
import type { ChannelRow } from "@/lib/channel"
import type { RowNews } from "@/lib/news"
import { useIcons } from "@/lib/icons"
import { formatShort } from "@/lib/format"
import { useSecrets } from "@/lib/secrets"
import { openRelease, restartToUpdate, useUpdate } from "@/lib/update"
import { cx } from "@/lib/utils"
import { ChannelIconTile } from "./channel-icon"
import { RobotAvatar } from "./robot"
import { Icon } from "./icon"
import { Monogram, Wordmark } from "./kit"
import { Tooltip } from "./ui/tooltip"
import { Menu, MenuItem, MenuNote, MenuSeparator } from "./ui/menu"

/** What a row says on hover: what was said last, or why this browser can't open it yet. */
function rowNote(c: ChannelRow): string {
  if (c.state === "pending") return "Waiting for the owner to let you in"
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
  const update = useUpdate()
  const newsOf = new Map(rows.map((c, i) => [c.room, news[i]]))
  const icons = useIcons()

  return (
    <aside className={cx("relative h-full w-full shrink-0 flex-col bg-rail md:w-[300px]", className)}>
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
              className={cx("flex h-16 w-full items-center gap-3 rounded-card px-3 text-left transition-colors", selected ? "bg-pick" : "hover:bg-wash")}
            >
              {c.recent?.lead && reachable ? (
                <RobotAvatar name={c.recent.lead} size={40} label="The lead spoke last" />
              ) : (
                <ChannelIconTile icon={icons.get(c.room) ?? null} title={c.title} size={40} />
              )}
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
                      aria-label={n.needs === 1 ? "A question for you" : `${n.needs} questions for you`}
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
          {update && (
            <button
              type="button"
              disabled={update.state === "downloading"}
              onClick={() => (update.state === "ready" ? restartToUpdate() : openRelease(update))}
              className={cx("glass flex h-9 items-center gap-2 rounded-full pr-4 pl-3 text-ui font-medium", update.state === "ready" ? "text-accent-text" : "text-ink-2")}
            >
              <Icon icon={Download04Icon} size={16} className="shrink-0" />
              {update.state === "downloading"
                ? `Downloading Channels ${update.version}…`
                : update.state === "ready"
                  ? `Restart to update to ${update.version}`
                  : `Channels ${update.version} is out · Get it`}
            </button>
          )}
          <Menu
            side="top"
            className="w-60"
            trigger={
              <button type="button" className="glass flex h-10 max-w-full items-center gap-2 rounded-full pr-4 pl-1 transition-colors">
                <Monogram name={person.name} size={32} />
                <span className="truncate text-ui font-semibold">{person.name}</span>
              </button>
            }
          >
            <MenuNote>Key {person.pk.slice(0, 12)}</MenuNote>
            <MenuItem icon={ComputerIcon} onClick={onComputers}>
              Your computers
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Settings01Icon} onClick={onSettings}>
              Settings
            </MenuItem>
          </Menu>
        </div>
      )}
    </aside>
  )
}

function RailChannel({ c, n, selected, icon, onSelect }: { c: ChannelRow; n: RowNews | undefined; selected: boolean; icon: ChannelIcon | null; onSelect: () => void }) {
  const reachable = c.state === "member"
  const fresh = !selected && !!n?.fresh
  const needs = n?.needs ?? 0
  const note = rowNote(c)
  const when = reachable ? formatShort(c.ts) : c.state === "pending" ? "Pending" : "Locked"
  return (
    <Tooltip
      side="right"
      label={
        <span className="block max-w-64 py-0.5">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-semibold">{c.title}</span>
            <span className="shrink-0 font-normal tabular-nums opacity-70">{when}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 font-normal opacity-80">{note}</span>
          {needs > 0 && <span className="mt-1 block">{needs === 1 ? "A question for you" : `${needs} questions for you`}</span>}
        </span>
      }
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "page" : undefined}
        aria-label={`${c.title}, ${when}: ${note}${needs ? `, ${needs} for you` : fresh ? ", new messages" : ""}`}
        className={cx("relative flex size-14 shrink-0 items-center justify-center rounded-card transition-colors", selected ? "bg-pick" : "hover:bg-wash")}
      >
        <span className={cx("flex", !reachable && "grayscale")}>
          {c.recent?.lead && reachable ? <RobotAvatar name={c.recent.lead} size={40} label="The lead spoke last" /> : <ChannelIconTile icon={icon} title={c.title} size={40} />}
        </span>
        {needs > 0 ? (
          <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-stamp font-semibold text-accent-ink tabular-nums shadow-[0_0_0_2px_var(--rail)]">
            {needs}
          </span>
        ) : fresh ? (
          <span className="absolute top-2 right-2 size-2.5 rounded-full bg-accent shadow-[0_0_0_2px_var(--rail)]" />
        ) : null}
        {!reachable && c.state !== "pending" && (
          <span className="absolute right-1.5 bottom-1.5 flex size-5 items-center justify-center rounded-full bg-raised text-ink-3 shadow-[0_0_0_2px_var(--rail)]">
            <Icon icon={LockIcon} size={11} />
          </span>
        )}
      </button>
    </Tooltip>
  )
}

const RAIL_BUTTON = "flex size-10 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-wash hover:text-ink"

export function Rail({
  rows,
  news,
  active,
  onSelect,
  onNew,
  onComputers,
  onSettings,
}: {
  rows: ChannelRow[]
  news: RowNews[]
  active: string
  onSelect: (code: string) => void
  onNew: () => void
  onComputers: () => void
  onSettings: () => void
}) {
  const person = useSecrets().person
  const update = useUpdate()
  const newsOf = new Map(rows.map((c, i) => [c.room, news[i]]))
  const icons = useIcons()
  return (
    <aside className="relative hidden h-full w-20 shrink-0 flex-col items-center bg-rail md:flex">
      <div aria-hidden className="drag h-(--chrome-h) w-full shrink-0" />
      <nav aria-label="Channels" className="flex w-full flex-1 [scrollbar-width:none] flex-col items-center gap-1 overflow-y-auto pt-2 pb-3">
        {rows.map((c) => (
          <RailChannel key={c.room} c={c} n={newsOf.get(c.room)} selected={c.code === active} icon={icons.get(c.room) ?? null} onSelect={() => onSelect(c.code)} />
        ))}
      </nav>
      <div className="flex shrink-0 flex-col items-center gap-1.5 pt-2 pb-3">
        <Tooltip side="right" label="New channel">
          <button type="button" aria-label="New channel" onClick={onNew} className={cx(RAIL_BUTTON, "shadow-[inset_0_0_0_1.5px_var(--edge-strong)]")}>
            <Icon icon={Add01Icon} size={18} />
          </button>
        </Tooltip>
        {update && (
          <Tooltip
            side="right"
            label={
              update.state === "downloading"
                ? `Downloading Channels ${update.version}…`
                : update.state === "ready"
                  ? `Restart to update to ${update.version}`
                  : `Channels ${update.version} is out · Get it`
            }
          >
            <button
              type="button"
              aria-label={update.state === "ready" ? `Restart to update to ${update.version}` : `Channels ${update.version} is out`}
              disabled={update.state === "downloading"}
              onClick={() => (update.state === "ready" ? restartToUpdate() : openRelease(update))}
              className={cx(RAIL_BUTTON, "relative", update.state === "ready" && "text-accent-text")}
            >
              <Icon icon={Download04Icon} size={18} />
              <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent" />
            </button>
          </Tooltip>
        )}
        {person && (
          <Menu
            side="right"
            align="end"
            className="w-60"
            trigger={
              <button type="button" className="mt-1 flex rounded-full">
                <Monogram name={person.name} size={36} />
                <span className="sr-only">{person.name}</span>
              </button>
            }
          >
            <MenuNote>
              {person.name} · key {person.pk.slice(0, 12)}
            </MenuNote>
            <MenuItem icon={ComputerIcon} onClick={onComputers}>
              Your computers
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Settings01Icon} onClick={onSettings}>
              Settings
            </MenuItem>
          </Menu>
        )}
      </div>
    </aside>
  )
}
