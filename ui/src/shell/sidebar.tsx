import { Suspense, useEffect, useState, useSyncExternalStore } from "react"
import { liveOf, restOf } from "~/doing"

import { Avatar, Count, cx, Heading, IconButton, STATUS_WORDS } from "~/kit/bits"
import { showMenu } from "~/kit/menu-open"
import { useAppCan } from "~/live/app-can"
import { useGlide } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Direct, type Person } from "~/model"
import { sameWhere, useAct, useApp } from "~/nav"
import { between, nickname, onePerPerson, shown } from "~/names"
import { comingBack, hiddenKey, hiddenPlaces, keptHidden, setHidden } from "~/shell/hidden-places"
import { leftDirects } from "~/shell/left-directs"
import { wordsPlain } from "~/words"

const SideCards = later(() => import("~/shell/updates").then((m) => m.SideCards))

export function Sidebar({ channel }: { channel: Channel }) {
  const { nav, go } = useApp()
  const { actions } = useAct()
  const people = onePerPerson(channel.people.filter((p) => p.kind === "human")).filter((p) => !p.left)
  const me = people.find((p) => p.you)
  const humans = people.filter((p) => !p.you)
  const agents = channel.people.filter((p) => p.kind === "agent" && !p.left).sort((a, b) => rank(a) - rank(b))
  const listed = new Set([...humans, ...agents].map((p) => p.name))
  const directOf = new Map(channel.directs.map((d) => [d.with, d]))
  const { people: leftPeople, agents: leftAgents } = leftDirects(channel, listed)
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
  const showDm = (d: Direct) => shownRow(dmKey(d.with), onChat && sameWhere(nav.where, { kind: "dm", with: d.with }))
  const hiddenCount = channel.rooms.filter((r) => hidden.includes(roomKey(r.id))).length
  const hiddenDirects = leftPeople.filter((d) => hidden.includes(dmKey(d.with))).length
  const hiddenAgents = leftAgents.filter((d) => hidden.includes(dmKey(d.with))).length
  const toggleHidden = () => setShowHidden(!showHidden)
  return (
    <div ref={sideRef} className="side">
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
          {hiddenCount > 0 && <HiddenRows count={hiddenCount} open={showHidden} toggle={toggleHidden} />}
        </ul>
      </section>

      {(me || humans.length > 0 || leftPeople.length > 0 || channel.youOwn) && (
        <section aria-label="People">
          <Heading action={channel.youOwn ? <IconButton icon="plus" label="Invite people" onClick={() => go({ to: "modal", modal: { kind: "invite" } })} /> : undefined}>People</Heading>
          <ul>
            {me && <You person={me} />}
            {humans.map((p) => (
              <Member key={p.name} person={p} channel={channel} direct={directOf.get(p.name)} />
            ))}
            {leftPeople.filter(showDm).map((d) => (
              <Former key={d.with} channel={channel} direct={d} />
            ))}
            {hiddenDirects > 0 && <HiddenRows count={hiddenDirects} open={showHidden} toggle={toggleHidden} />}
            {channel.youOwn && humans.length + leftPeople.length === 0 && (
              <li>
                <button type="button" className={cx("side-row is-add", nav.modal?.kind === "invite" && "is-on")} onClick={() => go({ to: "modal", modal: { kind: "invite" } })}>
                  <Icon name="plus" size={14} />
                  <span className="side-label">Invite people</span>
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      <section aria-label="Agents">
        <Heading action={agents.length > 0 ? <IconButton icon="plus" label="Add an agent" onClick={() => go({ to: "modal", modal: { kind: "add-agent" } })} /> : undefined}>Agents</Heading>
        <ul>
          {agents.map((p) => (
            <Member key={p.name} person={p} channel={channel} direct={directOf.get(p.name)} />
          ))}
          {leftAgents.filter(showDm).map((d) => (
            <Former key={d.with} channel={channel} direct={d} />
          ))}
          {hiddenAgents > 0 && <HiddenRows count={hiddenAgents} open={showHidden} toggle={toggleHidden} />}
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
              <button type="button" className={cx("side-row is-add", nav.modal?.kind === "add-agent" && "is-on")} onClick={() => go({ to: "modal", modal: { kind: "add-agent" } })}>
                <Icon name="plus" size={14} />
                <span className="side-label">Add an agent</span>
              </button>
            </li>
          )}
        </ul>
      </section>

      <div className="side-foot">
        <Suspense fallback={null}>
          <SideCards />
        </Suspense>
      </div>
    </div>
  )
}

const rank = (p: Person): number => (liveOf(p) ? 0 : 3) + (p.role === "lead" ? 0 : p.presence === "offline" ? 2 : 1)

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

function HiddenRows({ count, open, toggle }: { count: number; open: boolean; toggle: () => void }) {
  return (
    <li>
      <button type="button" className="side-row is-add" aria-expanded={open} onClick={toggle}>
        <Icon name={open ? "down" : "chevron"} size={14} />
        <span className="side-label">{open ? "Show less" : `${count} hidden`}</span>
      </button>
    </li>
  )
}

function Former({ channel, direct }: { channel: Channel; direct: Direct }) {
  const { nav, go } = useApp()
  const { actions } = useAct()
  const where = { kind: "dm", with: direct.with } as const
  const on = nav.tab === "chat" && sameWhere(nav.where, where)
  const who = memberOf(channel, direct.with)
  const agent = who?.kind === "agent"
  return (
    <li>
      <button
        type="button"
        className={cx("side-row", agent && "side-member is-off", on && "is-on", direct.unread > 0 && "is-news")}
        aria-current={on ? "page" : undefined}
        title={agent ? "Left the channel" : undefined}
        onClick={() => go({ to: "where", where })}
        onContextMenu={(e) => showMenu(e, nickname(channel, direct.with), (x) => x.directGroups({ channel, go }, actions, on, direct, who))}
      >
        <Avatar person={who} size="sm" />
        <span className={agent ? "side-name" : "side-label"}>{nickname(channel, direct.with)}</span>
        {agent && <span className="side-state">left</span>}
        <Count n={direct.unread} loud />
      </button>
    </li>
  )
}

function You({ person }: { person: Person }) {
  const { go } = useApp()
  return (
    <li>
      <button type="button" className="side-row side-member" title="Your profile" onClick={() => go({ to: "modal", modal: { kind: "person", name: person.name } })}>
        <Avatar person={person} size="sm" pip />
        <span className="side-name">{shown(person)}</span>
        <span className="side-state">you</span>
      </button>
    </li>
  )
}

function Member({ person, channel, direct }: { person: Person; channel: Channel; direct: Direct | undefined }) {
  const { nav, go } = useApp()
  const { actions } = useAct()
  const where = { kind: "dm", with: person.name } as const
  const on = nav.tab === "chat" && sameWhere(nav.where, where)
  const unread = direct?.unread ?? 0
  const agent = person.kind === "agent"
  const live = agent ? liveOf(person) : null
  const task = live ? taskOf(person, channel) : undefined
  return (
    <li>
      <button
        type="button"
        className={cx("side-row side-member", live && "is-live", live && !live.busy && "is-waiting", on && "is-on", unread > 0 && "is-news", person.presence === "offline" && "is-off")}
        aria-current={on ? "page" : undefined}
        title={task ? `T${task.id} ${wordsPlain(task.title, channel.nicknames)} · ${statusOf(person, channel)}` : statusOf(person, channel)}
        onClick={() => go({ to: "where", where })}
        onContextMenu={(e) =>
          showMenu(e, shown(person), (x) => [unread > 0 ? [{ label: "Mark as read", run: () => actions.markRead(channel.code, where) }] : [], x.personItems({ channel, go }, person)])
        }
      >
        <Avatar person={person} size="sm" pip />
        <span className="side-name">{shown(person)}</span>
        {agent && (
          <span key={live?.text} className="side-state">
            {live ? (live.busy ? live.text : "needs a person") : person.presence === "offline" ? "offline" : "idle"}
          </span>
        )}
        <Count n={unread} loud />
      </button>
    </li>
  )
}
