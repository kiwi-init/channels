import { useState } from "react"

import { Avatar, Count, cx, Heading, IconButton, STATUS_WORDS } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Person } from "~/model"
import { sameWhere, useApp } from "~/nav"
import { nickname, shown } from "~/names"

export function Sidebar({ channel }: { channel: Channel }) {
  const { nav, go, app } = useApp()
  const [adding, setAdding] = useState(false)
  const humans = channel.people.filter((p) => p.kind === "human")
  const agents = channel.people.filter((p) => p.kind === "agent").sort((a, b) => rank(a) - rank(b))
  const onChat = nav.tab === "chat"
  return (
    <div className="side">
      <section aria-label="Rooms">
        <Heading action={channel.youOwn ? <IconButton icon="plus" label="New room" onClick={() => setAdding(true)} /> : undefined}>Rooms</Heading>
        <ul>
          {channel.rooms.map((r) => {
            const where = { kind: "room", room: r.id } as const
            const on = onChat && sameWhere(nav.where, where)
            return (
              <li key={r.id}>
                <button type="button" className={cx("side-row", on && "is-on", r.unread > 0 && "is-news")} aria-current={on ? "page" : undefined} onClick={() => go({ to: "where", where })}>
                  <span className="side-hash">#</span>
                  <span className="side-label">{r.name}</span>
                  <Count n={r.mentions || r.unread} loud={r.mentions > 0} />
                </button>
              </li>
            )
          })}
          {adding && (
            <li>
              <form
                className="side-new"
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = new FormData(e.currentTarget).get("room")?.toString().trim().toLowerCase().replace(/\s+/g, "-")
                  if (name) {
                    app.actions.addRoom(channel.code, name)
                    go({ to: "where", where: { kind: "room", room: name } })
                  }
                  setAdding(false)
                }}
              >
                <span className="side-hash">#</span>
                <input
                  name="room"
                  autoFocus
                  className="side-input"
                  placeholder="room-name"
                  aria-label="New room name"
                  onBlur={(e) => !e.target.value && setAdding(false)}
                  onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
                />
              </form>
            </li>
          )}
        </ul>
      </section>

      {channel.directs.length > 0 && (
        <section aria-label="Direct messages">
          <Heading>Direct</Heading>
          <ul>
            {channel.directs.map((d) => {
              const where = { kind: "dm", with: d.with } as const
              const on = onChat && sameWhere(nav.where, where)
              const who = memberOf(channel, d.with)
              return (
                <li key={d.with}>
                  <button type="button" className={cx("side-row", on && "is-on", d.unread > 0 && "is-news")} aria-current={on ? "page" : undefined} onClick={() => go({ to: "where", where })}>
                    <Avatar person={who} size="sm" />
                    <span className="side-label">{nickname(channel, d.with)}</span>
                    <Count n={d.unread} loud />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section aria-label="People">
        <Heading>People</Heading>
        <ul>
          {humans.map((p) => (
            <Member key={p.name} person={p} channel={channel} />
          ))}
          {channel.youOwn && (
            <li>
              <button type="button" className={cx("side-row is-add", nav.panel?.kind === "invite" && "is-on")} onClick={() => go({ to: "panel", panel: { kind: "invite" } })}>
                <Icon name="plus" size={14} />
                <span className="side-label">invite</span>
              </button>
            </li>
          )}
        </ul>
      </section>

      <section aria-label="Agents">
        <Heading>Agents</Heading>
        <ul>
          {agents.map((p) => (
            <Member key={p.name} person={p} channel={channel} />
          ))}
          <li>
            <button type="button" className={cx("side-row is-add", nav.panel?.kind === "add-agent" && "is-on")} onClick={() => go({ to: "panel", panel: { kind: "add-agent" } })}>
              <Icon name="plus" size={14} />
              <span className="side-label">add agent</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  )
}

const rank = (p: Person): number => (p.role === "lead" ? 0 : p.presence === "offline" ? 2 : 1)

export function statusOf(p: Person, channel: Channel): string {
  if (p.typing) return "typing…"
  if (p.doing) {
    const t = channel.tasks.find((t) => t.id === p.doing)
    if (t) return `T${t.id} ${STATUS_WORDS[t.status]}`
  }
  if (p.presence === "offline") return `offline · ${ago(p.lastSeen)}`
  if (p.kind === "human") return p.presence === "away" ? "away" : "online"
  return "idle"
}

function toneOf(p: Person, channel: Channel): string | false {
  const t = p.doing ? channel.tasks.find((t) => t.id === p.doing) : undefined
  return !p.typing && !!t && `is-${t.status}`
}

function Member({ person, channel }: { person: Person; channel: Channel }) {
  const { nav, go } = useApp()
  const on = nav.panel?.kind === "person" && nav.panel.name === person.name
  return (
    <li>
      <button
        type="button"
        className={cx("side-member", on && "is-on", person.presence === "offline" && "is-off")}
        onClick={() => go({ to: "panel", panel: on ? null : { kind: "person", name: person.name } })}
      >
        <Avatar person={person} size="sm" pip />
        <span className="side-name">
          {shown(person)}
          {person.you && <span className="side-role"> you</span>}
          {person.role && <span className="side-role"> {person.role}</span>}
        </span>
        <span className={cx("side-status", person.typing && "is-typing", toneOf(person, channel))}>{statusOf(person, channel)}</span>
      </button>
    </li>
  )
}
