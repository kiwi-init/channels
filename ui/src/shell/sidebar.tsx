import { useEffect, useState, useSyncExternalStore } from "react"
import { liveOf, restOf } from "~/doing"

import { Avatar, Count, cx, Heading, IconButton, STATUS_WORDS } from "~/kit/bits"
import { showMenu } from "~/kit/menu-open"
import { useAppCan } from "~/live/app-can"
import { useGlide } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Direct, type Person } from "~/model"
import { sameWhere, useAct, useApp } from "~/nav"
import { between, nickname, onePerPerson, shown } from "~/names"
import { comingBack, hiddenKey, hiddenPlaces, keptHidden, setHidden } from "~/shell/hidden-places"
import { SideFoot } from "~/shell/updates"

export function Sidebar({ channel }: { channel: Channel }) {
  const { nav, go } = useApp()
  const { actions } = useAct()
  const humans = onePerPerson(channel.people.filter((p) => p.kind === "human")).filter((p) => !p.you && !p.left)
  const agents = channel.people.filter((p) => p.kind === "agent" && !p.left).sort((a, b) => rank(a) - rank(b))
  const listed = new Set([...humans, ...agents].map((p) => p.name))
  const directOf = new Map(channel.directs.map((d) => [d.with, d]))
  const orphans = channel.directs.filter((d) => !listed.has(d.with))
  const onChat = nav.tab === "chat"
  const [openTheirs, setOpenTheirs] = useState(false)
  const onTheirs = onChat && nav.where.kind === "theirs"
  const theirsShown = openTheirs || onTheirs
  const sideRef = useGlide<HTMLDivElement>(".side-row.is-on")
  const hidden = useSyncExternalStore(hiddenPlaces.subscribe, hiddenPlaces.get)
  const kept = useSyncExternalStore(keptHidden.subscribe, keptHidden.get)
  const canLeave = useAppCan("leaveRoom")
  const [showHidden, setShowHidden] = useState(false)
  const roomKey = (room: string) => hiddenKey(channel.code, { kind: "room", room })
  const dmKey = (who: string) => hiddenKey(channel.code, { kind: "dm", with: who })
  const back = comingBack(
    [
      ...channel.rooms.map((r) => ({ key: roomKey(r.id), news: (r.muted ? r.mentions : r.unread) > 0, mention: r.mentions > 0 })),
      ...channel.directs.map((d) => ({ key: dmKey(d.with), news: d.unread > 0 })),
    ],
    hidden,
    kept
  ).join(" ")
  useEffect(() => {
    for (const key of back ? back.split(" ") : []) setHidden(key, false)
  }, [back])
  const shownRow = (key: string, on: boolean) => showHidden || on || !hidden.includes(key)
  const hiddenCount = channel.rooms.filter((r) => hidden.includes(roomKey(r.id))).length
  const hiddenDirects = orphans.filter((d) => hidden.includes(dmKey(d.with))).length
  const followed = (channel.threads ?? []).filter((t) => t.following)
  const onThreads = nav.tab === "threads"
  const threadNews = followed.filter((t) => t.unread > 0).length
  const threadMentions = followed.reduce((n, t) => n + t.mentions, 0)
  return (
    <div ref={sideRef} className="side">
      {(followed.length > 0 || onThreads) && (
        <section aria-label="Threads">
          <ul>
            <li>
              <button
                type="button"
                className={cx("side-row", onThreads && "is-on", threadNews > 0 && "is-news")}
                aria-current={onThreads ? "page" : undefined}
                onClick={() => go({ to: "tab", tab: "threads" })}
              >
                <span className="side-hash">
                  <Icon name="thread" size={12} />
                </span>
                <span className="side-label">Threads</span>
                <Count n={threadMentions || threadNews} loud={threadMentions > 0} />
              </button>
            </li>
          </ul>
        </section>
      )}
      <section aria-label="Rooms">
        <Heading action={channel.youOwn || channel.youTrusted ? <IconButton icon="plus" label="New room" onClick={() => go({ to: "dialog", dialog: "new-room" })} /> : undefined}>Rooms</Heading>
        <ul>
          {channel.rooms.map((r) => {
            const where = { kind: "room", room: r.id } as const
            const on = onChat && sameWhere(nav.where, where)
            if (!shownRow(roomKey(r.id), on)) return null
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className={cx("side-row", on && "is-on", (r.muted ? r.mentions : r.unread) > 0 && "is-news", r.muted && "is-muted")}
                  aria-current={on ? "page" : undefined}
                  title={r.muted ? `#${r.name} is muted` : undefined}
                  onClick={() => go({ to: "where", where })}
                  onContextMenu={(e) => showMenu(e, `#${r.name}`, (x) => x.roomGroups({ channel, go }, actions, on, canLeave, r))}
                >
                  <span className="side-hash">{r.members ? <Icon name="people" size={12} label="Members only" /> : "#"}</span>
                  <span className="side-label">{r.name}</span>
                  <Count n={r.muted ? r.mentions : r.mentions || r.unread} loud={r.mentions > 0} />
                </button>
              </li>
            )
          })}
          {hiddenCount > 0 && (
            <li>
              <button type="button" className="side-row is-add" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
                <Icon name={showHidden ? "down" : "chevron"} size={14} />
                <span className="side-label">{showHidden ? "Show less" : `${hiddenCount} hidden`}</span>
              </button>
            </li>
          )}
        </ul>
      </section>

      {(humans.length > 0 || orphans.length > 0 || channel.youOwn) && (
        <section aria-label="People">
          <Heading action={channel.youOwn ? <IconButton icon="plus" label="Invite people" onClick={() => go({ to: "panel", panel: { kind: "invite" } })} /> : undefined}>People</Heading>
          <ul>
            {humans.map((p) => (
              <Member key={p.name} person={p} channel={channel} direct={directOf.get(p.name)} />
            ))}
            {orphans.map((d) => {
              const where = { kind: "dm", with: d.with } as const
              const on = onChat && sameWhere(nav.where, where)
              const who = memberOf(channel, d.with)
              if (!shownRow(dmKey(d.with), on)) return null
              return (
                <li key={d.with}>
                  <button
                    type="button"
                    className={cx("side-row", on && "is-on", d.unread > 0 && "is-news")}
                    aria-current={on ? "page" : undefined}
                    onClick={() => go({ to: "where", where })}
                    onContextMenu={(e) => showMenu(e, nickname(channel, d.with), (x) => x.directGroups({ channel, go }, actions, on, d, who))}
                  >
                    <Avatar person={who} size="sm" />
                    <span className="side-label">{nickname(channel, d.with)}</span>
                    <Count n={d.unread} loud />
                  </button>
                </li>
              )
            })}
            {hiddenDirects > 0 && (
              <li>
                <button type="button" className="side-row is-add" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
                  <Icon name={showHidden ? "down" : "chevron"} size={14} />
                  <span className="side-label">{showHidden ? "Show less" : `${hiddenDirects} hidden`}</span>
                </button>
              </li>
            )}
            {channel.youOwn && humans.length + orphans.length === 0 && (
              <li>
                <button type="button" className={cx("side-row is-add", nav.panel?.kind === "invite" && "is-on")} onClick={() => go({ to: "panel", panel: { kind: "invite" } })}>
                  <Icon name="plus" size={14} />
                  <span className="side-label">Invite people</span>
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      <section aria-label="Agents">
        <Heading action={agents.length > 0 ? <IconButton icon="plus" label="Add an agent" onClick={() => go({ to: "panel", panel: { kind: "add-agent" } })} /> : undefined}>Agents</Heading>
        {agents.length > 0 && (
          <ul className="side-tiles">
            {agents.map((p) => (
              <Member key={p.name} person={p} channel={channel} direct={directOf.get(p.name)} tile />
            ))}
          </ul>
        )}
        <ul>
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
                <span className="side-label">{openTheirs ? "Show less" : `${channel.theirs.length} between others`}</span>
              </button>
            </li>
          )}
          {agents.length === 0 && (
            <li>
              <button type="button" className={cx("side-row is-add", nav.panel?.kind === "add-agent" && "is-on")} onClick={() => go({ to: "panel", panel: { kind: "add-agent" } })}>
                <Icon name="plus" size={14} />
                <span className="side-label">Add an agent</span>
              </button>
            </li>
          )}
        </ul>
      </section>

      <SideFoot />
    </div>
  )
}

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

function Member({ person, channel, direct, tile }: { person: Person; channel: Channel; direct: Direct | undefined; tile?: boolean }) {
  const { nav, go } = useApp()
  const { actions } = useAct()
  const where = { kind: "dm", with: person.name } as const
  const on = nav.tab === "chat" && sameWhere(nav.where, where)
  const unread = direct?.unread ?? 0
  return (
    <li>
      <button
        type="button"
        className={cx(tile ? "side-tile" : "side-row side-member", on && "is-on", unread > 0 && "is-news", person.presence === "offline" && "is-off")}
        aria-current={on ? "page" : undefined}
        title={statusOf(person, channel)}
        onClick={() => go({ to: "where", where })}
        onContextMenu={(e) =>
          showMenu(e, shown(person), (x) => [unread > 0 ? [{ label: "Mark as read", run: () => actions.markRead(channel.code, where) }] : [], x.personItems({ channel, go }, person)])
        }
      >
        <Avatar person={person} size={tile ? "lg" : "sm"} pip />
        <span className="side-label">{shown(person)}</span>
        <Count n={unread} loud />
      </button>
    </li>
  )
}
