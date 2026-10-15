import { Add01Icon, GitPullRequestIcon, Note01Icon, UserIcon } from "@hugeicons/core-free-icons"
import type { ReactNode } from "react"
import type { Message } from "@mc/protocol.ts"
import type { ChannelState } from "@mc/state.ts"
import type { EventMark, FeedItem, PrRef } from "@mc/work.ts"
import { colorOf } from "@mc/state.ts"
import { formatAgo, formatFull, memberName } from "@/lib/format"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Monogram } from "./kit"
import { Markdown } from "./markdown"
import { isAgent } from "./message"
import { StateMark } from "./tasks"

/**
 * An activity feed, the way Linear shows an issue's: events as single muted rows with a small
 * mark, and each thread as one card with hairline separators. A task's page uses it; the
 * conversation (T1126) is the same feed.
 */
export function Feed({ items, state, now }: { items: FeedItem[]; state: ChannelState; now: number }) {
  return (
    <ol className="grid">
      {items.map((item) => (
        <li key={`${item.type}-${item.seq}`}>
          {item.type === "thread" ? (
            <ThreadCard messages={item.messages} room={item.room} state={state} now={now} />
          ) : item.type === "pr" ? (
            <EventLine mark={<Icon icon={GitPullRequestIcon} size={16} />} actor={item.actor} at={item.at} now={now} state={state}>
              linked <PrLink pr={item.pr} />
            </EventLine>
          ) : (
            <EventLine mark={<Mark mark={item.mark} />} actor={item.actor} at={item.at} now={now} state={state} note={item.note}>
              {item.text}
            </EventLine>
          )}
        </li>
      ))}
    </ol>
  )
}

/** "name · 2m ago", muted, the meta line every row and card uses. */
function Meta({ name, at, now, state, strong = true }: { name: string; at: number; now: number; state: ChannelState; strong?: boolean }) {
  return (
    <span className="text-meta text-ink-3">
      <span className={cx(strong ? "font-medium text-ink" : "text-ink-2", "text-ui")}>{memberName(state.members.get(name), name)}</span>
      {" · "}
      <time title={formatFull(at)}>{formatAgo(at, now)}</time>
    </span>
  )
}

function EventLine({ mark, actor, at, now, state, note, children }: { mark: ReactNode; actor: string; at: number; now: number; state: ChannelState; note?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5 text-ui text-ink-3">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-ink-3">{mark}</span>
      <div className="min-w-0">
        <p>
          <span className="font-medium text-ink-2">{memberName(state.members.get(actor), actor)}</span> {children}
          <span className="text-meta">
            {" · "}
            <time title={formatFull(at)}>{formatAgo(at, now)}</time>
          </span>
        </p>
        {/* A note is something someone wrote, so it reads as text, not as part of the event. */}
        {note && <p className="mt-1 text-body text-ink">{note}</p>}
      </div>
    </div>
  )
}

function ThreadCard({ messages, room, state, now }: { messages: Message[]; room?: string; state: ChannelState; now: number }) {
  const roomName = room && state.rooms.size > 1 ? state.rooms.get(room)?.name : undefined
  return (
    <div className="my-2 overflow-hidden rounded-card bg-field">
      {messages.map((m, i) => {
        const author = state.members.get(m.from)
        return (
          <article key={m.seq} id={`f${m.seq}`} className={cx("px-4 py-3", i > 0 && "shadow-[inset_0_1px_0_var(--line)]")}>
            <header className="mb-1 flex items-center gap-2">
              <Monogram name={m.from} agent={isAgent(author)} size={20} color={colorOf(state, m.from)} />
              <Meta name={m.from} at={m.rts ?? m.ts} now={now} state={state} />
              {i === 0 && roomName && <span className="ml-auto text-meta text-ink-3">#{roomName}</span>}
            </header>
            <div className="pl-7 text-body text-ink">
              <Markdown>{m.body}</Markdown>
            </div>
          </article>
        )
      })}
    </div>
  )
}

/** A pull request by its link text; its state comes from what the channel said, never from GitHub. */
export function PrLink({ pr }: { pr: PrRef }) {
  return (
    <a href={pr.url} target="_blank" rel="noreferrer" className="text-ink-2 hover:text-ink hover:underline">
      #{pr.number}
      <span className="text-ink-3">
        {" "}
        in {pr.repo.split("/").pop()}
        {pr.state !== "open" && `, ${pr.state}`}
      </span>
    </a>
  )
}

/** The small mark beside an event row: a task's new state as its state mark, otherwise an icon for what happened. */
function Mark({ mark }: { mark: EventMark }) {
  if (mark === "add") return <Icon icon={Add01Icon} size={16} />
  if (mark === "assign") return <Icon icon={UserIcon} size={16} />
  if (mark === "note") return <Icon icon={Note01Icon} size={16} />
  if (mark === "other") return <span className="block size-1.5 rounded-full bg-ink-3" />
  return <StateMark state={mark} />
}
