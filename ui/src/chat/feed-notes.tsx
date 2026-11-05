import { lazy, Suspense } from "react"

import { dmInRoom } from "~/live/dm"
import type { Channel, Where } from "~/model"
import { between, nickname, shown } from "~/names"
import { useApp } from "~/nav"

const AddAgentCard = lazy(() => import("~/modals/add-agent").then((m) => ({ default: m.AddAgentCard })))

export function HoldBanner({ channel, hold }: { channel: Channel; hold: NonNullable<Channel["hold"]> }) {
  const { app } = useApp()
  const owner = channel.people.find((p) => p.owner && !p.you)
  const until = channel.youOwn ? "until you resume them" : `until ${owner ? shown(owner) : "the owner"} resumes them`
  const note = hold.note?.replace(/[.\s]+$/, "")
  return (
    <div className="banner" role="status" title={`They read but don't act ${until}.`}>
      <p className="banner-text">
        <b>{channel.youOwn || !owner ? "Agents paused" : `${shown(owner)} paused the agents`}</b>
        {note && <span className="dim">{note}</span>}
      </p>
      {channel.youOwn && (
        <button type="button" className="btn is-small" onClick={() => app.actions.setHold(channel.code, false)}>
          Resume
        </button>
      )}
    </div>
  )
}

export function Start({ channel, where }: { channel: Channel; where: Where }) {
  if (where.kind === "room" && !channel.people.some((p) => p.kind === "agent"))
    return (
      <div className="feed-start">
        <Suspense fallback={null}>
          <AddAgentCard channel={channel} />
        </Suspense>
      </div>
    )
  return (
    <div className="feed-start">
      <p className="feed-start-title">
        {where.kind === "room"
          ? `This is the start of #${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}.`
          : where.kind === "dm"
            ? dmInRoom(channel, where.with)
              ? `These are sent to you and ${nickname(channel, where.with)} alone. Anyone in the channel can still open them.`
              : `Everyone in the channel can read your messages with ${nickname(channel, where.with)}.`
            : where.kind === "theirs"
              ? `This is the start of ${between(channel, where.between)}.`
              : "Nothing here yet."}
      </p>
    </div>
  )
}
