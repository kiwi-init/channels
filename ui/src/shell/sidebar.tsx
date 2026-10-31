import { useState } from "react"
import { roomProblem } from "@kiwi/app/rooms.ts"
import { liveOf, restOf } from "~/doing"

import { Avatar, Count, cx, Heading, IconButton, STATUS_WORDS } from "~/kit/bits"
import { useGlide } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Person } from "~/model"
import { sameWhere, useApp } from "~/nav"
import { between, nickname, shown } from "~/names"
import { SideFoot } from "~/shell/updates"

export function Sidebar({ channel }: { channel: Channel }) {
  const { nav, go, app } = useApp()
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const humans = channel.people.filter((p) => p.kind === "human")
  const agents = channel.people.filter((p) => p.kind === "agent").sort((a, b) => rank(a) - rank(b))
  const onChat = nav.tab === "chat"
  const [openTheirs, setOpenTheirs] = useState(false)
  const onTheirs = onChat && nav.where.kind === "theirs"
  const theirsShown = openTheirs || onTheirs
  const sideRef = useGlide<HTMLDivElement>(".side-row.is-on")
  return (
    <div ref={sideRef} className="side">
      <section aria-label="Rooms">
        <Heading action={channel.youOwn || channel.youTrusted ? <IconButton icon="plus" label="New room" onClick={() => setAdding(true)} /> : undefined}>Rooms</Heading>
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
                  const name = roomName(new FormData(e.currentTarget).get("room")?.toString() ?? "")
                  const wrong = roomProblem(channel.rooms, name)
                  if (wrong) return setProblem(wrong)
                  setAdding(false)
                  void app.actions.addRoom(channel.code, name).then((id) => id && go({ to: "where", where: { kind: "room", room: id } }))
                }}
              >
                <span className="side-hash">#</span>
                <input
                  name="room"
                  autoFocus
                  className="side-input"
                  placeholder="room-name"
                  aria-label="New room name"
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? "side-new-problem" : undefined}
                  onChange={(e) => setProblem(e.target.value.trim() ? roomProblem(channel.rooms, roomName(e.target.value)) : null)}
                  onBlur={(e) => {
                    if (e.target.value) return
                    setAdding(false)
                    setProblem(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return
                    setAdding(false)
                    setProblem(null)
                  }}
                />
              </form>
              {problem && (
                <p className="side-problem" id="side-new-problem" role="alert">
                  {problem}
                </p>
              )}
            </li>
          )}
        </ul>
      </section>

      {(channel.directs.length > 0 || channel.theirs.length > 0) && (
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
            {theirsShown &&
              channel.theirs.map((t) => {
                const where = { kind: "theirs", between: t.between } as const
                const on = onChat && sameWhere(nav.where, where)
                return (
                  <li key={t.between.join("&")}>
                    <button type="button" className={cx("side-row", on && "is-on")} aria-current={on ? "page" : undefined} onClick={() => go({ to: "where", where })}>
                      <span className="side-pair">
                        <Avatar person={memberOf(channel, t.between[0])} size="sm" />
                        <Avatar person={memberOf(channel, t.between[1])} size="sm" />
                      </span>
                      <span className="side-label">{between(channel, t.between)}</span>
                    </button>
                  </li>
                )
              })}
            {channel.theirs.length > 0 && !onTheirs && (
              <li>
                <button type="button" className="side-row is-add" aria-expanded={openTheirs} onClick={() => setOpenTheirs(!openTheirs)}>
                  <Icon name={openTheirs ? "down" : "chevron"} size={14} />
                  <span className="side-label">{openTheirs ? "Show less" : `${channel.theirs.length} more`}</span>
                </button>
              </li>
            )}
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

      <SideFoot />
    </div>
  )
}

const roomName = (typed: string): string => typed.trim().toLowerCase().replace(/\s+/g, "-")

const rank = (p: Person): number => (p.role === "lead" ? 0 : p.presence === "offline" ? 2 : 1)

export function statusOf(p: Person, channel: Channel): string {
  const live = liveOf(p)
  if (live) return live.text
  const t = taskOf(p, channel)
  if (t) return `T${t.id} ${STATUS_WORDS[t.status]}`
  if (p.presence === "offline") return `offline · ${ago(p.lastSeen)}`
  if (p.kind === "human") return p.presence === "away" ? "away" : "online"
  return restOf(p)
}

export const taskOf = (p: Person, channel: Channel) => (p.load?.doing[0] !== undefined ? channel.tasks.find((t) => t.id === p.load?.doing[0]) : undefined)

export function toneOf(p: Person, channel: Channel): string | false {
  const live = liveOf(p)
  if (live) return live.busy ? "is-doing" : "is-waiting"
  const t = taskOf(p, channel)
  return !!t && `is-${t.status}`
}

function Member({ person, channel }: { person: Person; channel: Channel }) {
  const { nav, go } = useApp()
  const on = nav.panel?.kind === "person" && nav.panel.name === person.name
  const tone = toneOf(person, channel)
  const quiet = !tone && person.presence === "online"
  return (
    <li>
      <button
        type="button"
        className={cx("side-member", quiet && "is-quiet", on && "is-on", person.presence === "offline" && "is-off")}
        onClick={() => go({ to: "panel", panel: on ? null : { kind: "person", name: person.name } })}
      >
        <Avatar person={person} size="sm" pip />
        <span className="side-name">
          {shown(person)}
          {person.you && <span className="side-role"> you</span>}
          {person.role && person.role.toLowerCase() !== shown(person).toLowerCase() && <span className="side-role"> {person.role}</span>}
        </span>
        {!quiet && <span className={cx("side-status", tone)}>{statusOf(person, channel)}</span>}
      </button>
    </li>
  )
}
