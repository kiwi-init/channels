import { useMemo } from "react"

import { preview } from "~/chat/preview"
import { Count, cx, Empty } from "~/kit/bits"
import { ago } from "~/kit/time"
import type { Channel, Where } from "~/model"
import { nickname } from "~/names"
import { useApp } from "~/nav"

function placeName(channel: Channel, where: Where): string {
  if (where.kind === "room") return `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}`
  if (where.kind === "task") return `T${where.task}`
  if (where.kind === "dm") return nickname(channel, where.with)
  return where.between.map((n) => nickname(channel, n)).join(" and ")
}

export function ThreadsView({ channel }: { channel: Channel }) {
  const { nav, go } = useApp()
  const bySeq = useMemo(() => new Map(channel.messages.map((m) => [m.seq, m])), [channel.messages])
  const open = nav.panel?.kind === "thread" ? nav.panel.seq : null
  const followed = (channel.threads ?? []).filter((t) => t.following && bySeq.has(t.root))
  const places = new Set(followed.map((t) => placeName(channel, bySeq.get(t.root)!.where)))
  return (
    <div className="threads">
      <div className="threads-list">
        <h2 className="threads-title">Threads</h2>
        {followed.length === 0 ? (
          <Empty title="No threads yet" icon="thread" />
        ) : (
          <ul aria-label="Threads you follow">
            {followed.map((t) => {
              const root = bySeq.get(t.root)
              if (!root) return null
              return (
                <li key={t.root}>
                  <button
                    type="button"
                    className={cx("thread-item", t.unread > 0 && "is-news", open === t.root && "is-on")}
                    aria-current={open === t.root ? "true" : undefined}
                    onClick={() => go({ to: "panel", panel: { kind: "thread", seq: t.root } })}
                  >
                    <span className="thread-item-root">
                      <b>{nickname(channel, root.from)}</b> {preview(root.text)}
                    </span>
                    <span className="thread-item-meta">
                      {t.replies} {t.replies === 1 ? "reply" : "replies"} · {t.people.map((p) => nickname(channel, p)).join(", ")} · {ago(t.last)}
                      {places.size > 1 && ` · ${placeName(channel, root.where)}`}
                    </span>
                    <Count n={t.unread} loud={t.mentions > 0} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
