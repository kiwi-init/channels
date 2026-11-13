import "~/i18n/en/chat-later"
import { lazy, Suspense } from "react"

import { t } from "~/i18n/i18n"
import { memberOf, type Channel, type Where } from "~/model"
import { between, nickname, shown } from "~/names"
import { useActions } from "~/nav"

const AddAgentCard = lazy(() => import("~/modals/add-agent").then((m) => ({ default: m.AddAgentCard })))

export function HoldBanner({ channel, hold }: { channel: Channel; hold: NonNullable<Channel["hold"]> }) {
  const actions = useActions()
  const owner = channel.people.find((p) => p.owner && !p.you)
  const until = channel.youOwn ? t("chat.feed.notes.hold.you") : owner ? t("chat.feed.notes.hold.owner", { name: shown(owner) }) : t("chat.feed.notes.hold.the.owner")
  const note = hold.note?.replace(/[.\s]+$/, "")
  return (
    <div className="banner" role="status" title={until}>
      <p className="banner-text">
        <b>{channel.youOwn || !owner ? t("chat.feed.notes.agents.paused") : t("chat.feed.notes.paused.by", { name: shown(owner) })}</b>
        {note && <span className="dim">{note}</span>}
      </p>
      {channel.youOwn && (
        <button type="button" className="btn is-small" onClick={() => actions.setHold(channel.code, false)}>
          {t("chat.feed.notes.resume")}
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
          ? t("chat.feed.notes.start.room", { room: channel.rooms.find((r) => r.id === where.room)?.name ?? where.room })
          : where.kind === "dm"
            ? memberOf(channel, where.with)?.kind === "human"
              ? t("chat.feed.notes.dm.alone", { name: nickname(channel, where.with) })
              : t("chat.feed.notes.dm.everyone", { name: nickname(channel, where.with) })
            : where.kind === "theirs"
              ? t("chat.feed.notes.start.between", { names: between(channel, where.between) })
              : t("chat.feed.notes.nothing.yet")}
      </p>
    </div>
  )
}
