import { Search01Icon } from "@hugeicons/core-free-icons"
import type { ReactNode } from "react"

import type { ChannelIcon } from "@kiwi/core/protocol.ts"
import { VIEWS, type View } from "@/lib/views"
import { cx } from "@/lib/utils"
import { AgentRow, byBusy, type AgentNow } from "../agent-strip"
import { ChannelFace } from "../channel-icon"
import { Icon } from "../icon"

export interface Conversation {
  key: string
  label: string
  unread: number
  forMe: boolean
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-6">
      <h2 className="px-3 pb-1.5 text-meta font-medium text-ink-3">{title}</h2>
      {children}
    </section>
  )
}

function Item({ on, label, count, alert, onClick }: { on: boolean; label: string; count?: number; alert?: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={on ? "page" : undefined}
        className={cx("flex h-9 w-full items-center gap-2 rounded-ctl px-3 text-left text-ui transition-colors", on ? "prism-lit font-semibold text-ink" : "text-ink-2 hover:bg-wash hover:text-ink")}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!!count && <span className={cx("shrink-0 text-meta tabular-nums", alert ? "font-semibold text-decide" : "text-ink-3")}>{count}</span>}
      </button>
    </li>
  )
}

export function ChannelSidebar({
  title,
  icon,
  lead,
  people,
  onTitle,
  onSearch,
  view,
  counts,
  onView,
  agents,
  onOpenTask,
  conversations,
  current,
  onConversation,
}: {
  title: string
  icon: ChannelIcon | null
  lead: string | null
  people: string
  onTitle: () => void
  onSearch: () => void
  view: View | null
  counts: Record<View, number>
  onView: (v: View) => void
  agents: AgentNow[]
  onOpenTask: (id: number) => void
  conversations: Conversation[]
  current: string | null
  onConversation: (key: string) => void
}) {
  return (
    <aside aria-label="Channel" className="hidden h-full w-[280px] shrink-0 flex-col overflow-y-auto bg-rail px-3 pt-(--chrome-h) pb-4 md:flex">
      <button type="button" onClick={onTitle} className="flex items-center gap-3 rounded-row px-2 py-1.5 text-left transition-colors hover:bg-wash">
        <ChannelFace icon={icon} lead={lead} title={title} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-title">{title}</span>
          <span className="block truncate text-meta text-ink-3">{people}</span>
        </span>
      </button>

      <button type="button" onClick={onSearch} className="prism mt-3 flex h-9 items-center gap-2 rounded-ctl px-3 text-left text-ui text-ink-3 transition-colors hover:text-ink-2">
        <Icon icon={Search01Icon} size={16} className="shrink-0" />
        <span className="flex-1">Search this channel</span>
      </button>

      <nav aria-label="Views" className="mt-4">
        <ul className="space-y-0.5">
          {VIEWS.map(([v, label]) => (
            <Item key={v} on={view === v} label={label} count={counts[v]} alert={v === "needs"} onClick={() => onView(v)} />
          ))}
        </ul>
      </nav>

      {agents.length > 0 && (
        <Section title="Agents">
          <ul>
            {byBusy(agents).map((a) => (
              <AgentRow key={a.name} a={a} onOpenTask={onOpenTask} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="Conversations">
        <ul>
          {conversations.map((c) => (
            <Item key={c.key} on={current === c.key} label={c.label} count={c.unread} alert={c.forMe} onClick={() => onConversation(c.key)} />
          ))}
        </ul>
      </Section>
    </aside>
  )
}
