import { Add01Icon, ArrowDown01Icon, Search01Icon, SidebarLeftIcon, TaskDone01Icon } from "@hugeicons/core-free-icons"
import { useState, type ReactNode } from "react"

import type { ChannelIcon } from "@kiwi/core/protocol.ts"
import { VIEWS, type View } from "@/lib/views"
import { SIDEBAR_KEYS, toggleSidebar, useSidebarHidden } from "@/lib/sidebar-hidden"
import { cx } from "@/lib/utils"
import { AgentRow, byBusy, type AgentNow } from "../agent-strip"
import { AccountFoot, ChannelSwitcher } from "../channel-tabs"
import { Icon } from "../icon"
import { IconButton } from "../kit"
import { Menu, MenuItem } from "../ui/menu"

export interface Conversation {
  key: string
  label: string
  unread: number
  forMe: boolean
  withMe: boolean
}

function Section({ title, onTitle, action, children }: { title: string; onTitle?: () => void; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-6">
      <h2 className="flex items-center justify-between px-3 pb-1.5 text-meta font-medium text-ink-3">
        {onTitle ? (
          <button type="button" onClick={onTitle} className="transition-colors hover:text-ink">
            {title}
          </button>
        ) : (
          title
        )}
        {action}
      </h2>
      {children}
    </section>
  )
}

const ROW = "flex h-9 w-full items-center rounded-ctl px-3 text-left text-ui transition-colors"
const IDLE = "text-ink-2 hover:bg-wash hover:text-ink"

function Item({ on, label, count, alert, onClick }: { on: boolean; label: string; count?: number; alert?: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={on ? "page" : undefined} className={cx(ROW, "gap-2", on ? "prism-lit font-semibold text-ink" : IDLE)}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!!count && <span className={cx("shrink-0 text-meta tabular-nums", alert ? "font-semibold text-decide" : "text-ink-3")}>{count}</span>}
      </button>
    </li>
  )
}

function SearchRow({ search, onSearch }: { search: string | null; onSearch: (q: string | null) => void }) {
  if (search === null)
    return (
      <li>
        <button type="button" onClick={() => onSearch("")} className={cx(ROW, "gap-2.5", IDLE)}>
          <Icon icon={Search01Icon} size={16} className="shrink-0 text-ink-3" />
          Search
        </button>
      </li>
    )
  return (
    <li>
      <label className="flex h-9 items-center gap-2.5 rounded-ctl px-3 text-ui text-ink-3 edge transition-colors focus-within:text-ink-2">
        <Icon icon={Search01Icon} size={16} className="shrink-0" />
        <input
          autoFocus
          value={search}
          aria-label="Search this channel"
          placeholder="Search this channel"
          onChange={(e) => onSearch(e.target.value)}
          onBlur={(e) => !e.target.value && onSearch(null)}
          onKeyDown={(e) => e.key === "Escape" && onSearch(null)}
          className="min-w-0 flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
        />
      </label>
    </li>
  )
}

const DOT: Partial<Record<View, string>> = { needs: "bg-alert", doing: "bg-doing", review: "bg-decide" }

function TasksRow({ view, counts, onView }: { view: View | null; counts: Record<View, number>; onView: (v: View) => void }) {
  return (
    <li className={cx("flex h-9 items-center rounded-ctl transition-colors [--band:46%]", view ? "prism-lit" : "hover:bg-wash")}>
      <button
        type="button"
        onClick={() => onView("everything")}
        aria-current={view === "everything" ? "page" : undefined}
        className={cx("flex h-full min-w-0 flex-1 items-center gap-2.5 px-3 text-left text-ui", view ? "font-semibold text-ink" : "text-ink-2 hover:text-ink")}
      >
        <Icon icon={TaskDone01Icon} size={16} className="shrink-0 text-ink-3" />
        <span className="truncate">Tasks</span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5 pr-1.5">
        {VIEWS.flatMap(([v, label]) => {
          const dot = DOT[v]
          return dot && counts[v] > 0
            ? [
                <button
                  key={v}
                  type="button"
                  onClick={() => onView(v)}
                  aria-label={`${label}, ${counts[v]}`}
                  aria-current={view === v ? "page" : undefined}
                  title={label}
                  className={cx(
                    "flex h-6 items-center gap-1 rounded-row px-1 text-stamp font-semibold tabular-nums transition-colors hover:bg-wash hover:text-ink",
                    view === v ? "text-ink" : "text-ink-2"
                  )}
                >
                  <span className={cx("size-2 rounded-full", dot)} />
                  {counts[v]}
                </button>,
              ]
            : []
        })}
      </span>
    </li>
  )
}

export function hiddenConversations(conversations: Conversation[], current: string | null): Conversation[] {
  return conversations.filter((c) => !c.withMe && !c.forMe && c.key !== current)
}

function Conversations({ conversations, current, onConversation }: { conversations: Conversation[]; current: string | null; onConversation: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const hidden = hiddenConversations(conversations, current)
  const kept = conversations.filter((c) => !hidden.includes(c))
  const shown = open ? [...kept, ...hidden] : kept
  const unread = hidden.reduce((n, c) => n + c.unread, 0)
  return (
    <Section title="Conversations">
      <ul>
        {shown.map((c) => (
          <Item key={c.key} on={current === c.key} label={c.label} count={c.unread} alert={c.forMe} onClick={() => onConversation(c.key)} />
        ))}
        {hidden.length > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? undefined : `${hidden.length} more ${hidden.length === 1 ? "conversation" : "conversations"}${unread ? `, ${unread} unread` : ""}`}
              className={cx(ROW, "gap-2 text-ink-3 hover:bg-wash hover:text-ink")}
            >
              <Icon icon={ArrowDown01Icon} size={14} className={cx("shrink-0", open ? "rotate-180" : "-rotate-90")} />
              <span className="min-w-0 flex-1 truncate">{open ? "Show less" : `${hidden.length} more`}</span>
              {!open && unread > 0 && <span className="shrink-0 text-meta text-ink-3 tabular-nums">{unread}</span>}
            </button>
          </li>
        )}
      </ul>
    </Section>
  )
}

export function ChannelSidebar({
  title,
  icon,
  people,
  onTitle,
  search,
  onSearch,
  onAgents,
  onNewAgent,
  view,
  counts,
  onView,
  agents,
  onMessage,
  onOpenTask,
  conversations,
  current,
  onConversation,
}: {
  title: string
  icon: ChannelIcon | null
  people: string
  onTitle: () => void
  search: string | null
  onSearch: (q: string | null) => void
  onAgents: () => void
  onNewAgent?: (() => void) | undefined
  view: View | null
  counts: Record<View, number>
  onView: (v: View) => void
  agents: AgentNow[]
  onMessage: (name: string) => void
  onOpenTask: (id: number) => void
  conversations: Conversation[]
  current: string | null
  onConversation: (key: string) => void
}) {
  const hidden = useSidebarHidden()
  if (hidden) return null
  return (
    <aside aria-label="Channel" className="hidden h-full w-[280px] shrink-0 flex-col overflow-y-auto bg-rail px-3 pb-3 md:-mt-2 md:-ml-2 md:flex">
      <div className="drag flex h-(--chrome-h) shrink-0 items-center justify-end shell-mac:pl-(--lights-w)">
        <IconButton label={`Hide the sidebar (${SIDEBAR_KEYS})`} round className="no-drag size-9 text-ink-2 hover:text-ink" onClick={toggleSidebar}>
          <Icon icon={SidebarLeftIcon} size={18} />
        </IconButton>
      </div>
      <ChannelSwitcher title={title} icon={icon} people={people} onDetails={onTitle} />

      <nav aria-label="Views" className="mt-4">
        <ul className="space-y-0.5">
          <SearchRow search={search} onSearch={onSearch} />
          <TasksRow view={view} counts={counts} onView={onView} />
        </ul>
      </nav>

      {(agents.length > 0 || onNewAgent) && (
        <Section
          title="Agents"
          onTitle={onAgents}
          action={
            onNewAgent && (
              <button
                type="button"
                onClick={onNewAgent}
                aria-label="New agent"
                title="New agent"
                className="-my-1 -mr-1.5 flex size-6 items-center justify-center rounded-row text-ink-3 transition-colors hover:bg-wash hover:text-ink"
              >
                <Icon icon={Add01Icon} size={15} />
              </button>
            )
          }
        >
          <ul>
            {byBusy(agents).map((a) => (
              <AgentRow key={a.name} a={a} onMessage={onMessage} onOpenTask={onOpenTask} />
            ))}
          </ul>
        </Section>
      )}

      <Conversations conversations={conversations} current={current} onConversation={onConversation} />
      <AccountFoot />
    </aside>
  )
}

export function ConversationMenu({ conversations, current, onConversation }: { conversations: Conversation[]; current: string | null; onConversation: (key: string) => void }) {
  const unread = conversations.some((c) => c.key !== current && c.unread > 0)
  const label = conversations.find((c) => c.key === current)?.label ?? "Conversations"
  return (
    <Menu
      side="bottom"
      align="start"
      className="w-64"
      trigger={
        <button
          type="button"
          aria-label={`Conversations${unread ? ", with unread messages" : ""}`}
          className="no-drag relative hidden h-9 shrink-0 items-center gap-1 rounded-full pr-2.5 pl-3.5 text-ui text-ink-2 edge transition-colors hover:bg-wash hover:text-ink md:flex"
        >
          <span className="max-w-40 truncate">{label}</span>
          <Icon icon={ArrowDown01Icon} size={14} />
          {unread && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--canvas)]" />}
        </button>
      }
    >
      {conversations.map((c) => (
        <MenuItem key={c.key} onClick={() => onConversation(c.key)} className={cx(current === c.key && "font-semibold text-ink")}>
          <span className="min-w-0 flex-1 truncate">{c.label}</span>
          {c.unread > 0 && <span className={cx("shrink-0 text-meta tabular-nums", c.forMe ? "font-semibold text-decide" : "text-ink-3")}>{c.unread}</span>}
        </MenuItem>
      ))}
    </Menu>
  )
}
