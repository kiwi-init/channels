import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { liveOf, restOf, unsureOf } from "~/doing"

import { Avatar, Count, cx, Heading, IconButton, STATUS_WORDS } from "~/kit/bits"
import { openMenu, showMenu } from "~/kit/menu-open"
import { useAppCan } from "~/live/app-can"
import { useGlide } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import { ago } from "~/kit/time"
import { memberOf, type Channel, type Direct, type Person } from "~/model"
import { sameWhere, useAct, useGo, useNav, useOpenToType } from "~/nav"
import { between, nickname, onePerPerson, shown } from "~/names"
import { comingBack, hiddenKey, hiddenPlaces, setHidden } from "~/shell/hidden-places"
import { leftDirects } from "~/shell/left-directs"
import { openAsks } from "~/needs/open"
import { openTasks } from "~/tasks/open"
import { headerLine } from "~/now"
import { wordsPlain } from "~/words"
import { t } from "~/i18n/i18n"

const SideCards = later(() => import("~/shell/updates").then((m) => m.SideCards))

function ViewRows({ channel }: { channel: Channel }) {
  const nav = useNav()
  const go = useGo()
  const agents = channel.people.filter((p) => p.kind === "agent" && !p.left)
  const needs = openAsks(channel).length
  const tasks = openTasks(channel).length
  const github = channel.repos.length > 0 || !!channel.prs?.length || !!channel.issues?.length
  const openPrs = channel.prs?.filter((p) => p.state === "open" || p.state === "draft") ?? []
  const red = openPrs.some((p) => p.checks === "fail" || !!p.ticks?.failed.length)
  const openIssues = channel.issues?.filter((i) => i.state === "open").length ?? 0
  const specs = channel.specs?.filter((s) => !s.result) ?? []
  const specsNeed = specs.filter((s) => s.canJudge && (s.stage === "draft" || s.stage === "delivered" || s.changed)).length
  const line = channel.loading ? [] : headerLine(channel, 0)
  const view = (tab: "needs" | "specs" | "agents" | "github", icon: "needs" | "spec" | "agent" | "github", label: string, title: string | undefined, mark: ReactNode) => (
    <li>
      <button
        type="button"
        className={cx("side-row", tab === "needs" && "is-needs", nav.tab === tab && "is-on")}
        aria-pressed={nav.tab === tab}
        title={title}
        onClick={() => go(tab === "specs" ? { to: "spec", ask: null } : { to: "tab", tab })}
      >
        <span className="side-icon">
          <Icon name={icon} />
        </span>
        <span className="side-label">{label}</span>
        {mark}
      </button>
    </li>
  )
  return (
    <ul>
      {(needs > 0 || nav.tab === "needs") && view("needs", "needs", t("shell.channel.needs.you"), undefined, <Count n={needs} loud />)}
      {view(
        "specs",
        "spec",
        t("shell.channel.specs"),
        specsNeed ? t("shell.channel.specs.need", { count: specsNeed }) : t("shell.channel.specs.open", { specs: specs.length, tasks }),
        specsNeed > 0 && <span className="side-mark is-decide" role="img" aria-label={t("shell.channel.waiting.on.you")} />
      )}
      {(agents.length > 0 || nav.tab === "agents") && view("agents", "agent", t("shell.channel.agents"), line.length ? line.join(" · ") : undefined, null)}
      {(github || nav.tab === "github") &&
        view(
          "github",
          "github",
          t("shell.channel.github"),
          red ? t("shell.channel.github.red") : t("shell.channel.github.open", { prs: openPrs.length, issues: openIssues }),
          red && <span className="side-mark" role="img" aria-label={t("shell.channel.checks.failed")} />
        )}
    </ul>
  )
}

export function ViewsBar({ channel }: { channel: Channel }) {
  return (
    <nav className="views-bar" aria-label={t("shell.channel.views")}>
      <ViewRows channel={channel} />
    </nav>
  )
}

export function Sidebar({ channel, views = true }: { channel: Channel; views?: boolean }) {
  const nav = useNav()
  const go = useGo()
  const open = useOpenToType()
  const { actions, now } = useAct()
  const people = onePerPerson(channel.people.filter((p) => p.kind === "human")).filter((p) => !p.left)
  const me = people.find((p) => p.you)
  const humans = people.filter((p) => !p.you)
  const agents = channel.people.filter((p) => p.kind === "agent" && !p.left).sort((a, b) => rank(a) - rank(b))
  const listed = new Set([...humans, ...agents].map((p) => p.name))
  const directOf = new Map(channel.directs.map((d) => [d.with, d]))
  const { people: leftPeople, agents: leftAgents } = leftDirects(channel, listed)
  const onChat = nav.tab === "chat"
  const [openTheirs, setOpenTheirs] = useState(false)
  const sideRef = useGlide<HTMLDivElement>(".side-row.is-on")
  const hidden = useSyncExternalStore(hiddenPlaces.subscribe, hiddenPlaces.get)
  const canLeave = useAppCan("leaveRoom")
  const [showHidden, setShowHidden] = useState(false)
  const roomKey = (room: string) => hiddenKey(channel.code, room)
  const back = comingBack(
    channel.rooms.map((r) => ({ key: roomKey(r.id), mention: r.mentions > 0 })),
    hidden
  ).join(" ")
  useEffect(() => {
    for (const key of back ? back.split(" ") : []) setHidden(key, false)
  }, [back])
  const shownRow = (key: string, on: boolean) => showHidden || on || !hidden.includes(key)
  const openDm = (d: Direct) => onChat && sameWhere(nav.where, { kind: "dm", with: d.with })
  const showLeft = (d: Direct) => showHidden || openDm(d)
  const hiddenCount = channel.rooms.filter((r) => hidden.includes(roomKey(r.id))).length
  const tucked = (left: Direct[]) => (showHidden ? left : left.filter((d) => !openDm(d)))
  const tuckedPeople = tucked(leftPeople)
  const tuckedAgents = tucked(leftAgents)
  const toggleHidden = () => setShowHidden(!showHidden)
  const channelMenu = (at: DOMRect) => {
    const tile = now?.().channels.find((c) => c.code === channel.code)
    void import("~/shell/rail-menu").then((m) =>
      openMenu.set(
        m.railMenu(
          { kind: "channel", code: channel.code },
          { x: at.left, y: at.bottom + 4 },
          {
            noFolders: true,
            folders: [],
            save: () => {},
            title: () => channel.title,
            muted: (code) => now?.().prefs.muted.includes(code) ?? false,
            setMute: (code, on) => actions.setMute(code, null, on),
            settings: () => go({ to: "modal", modal: { kind: "channel" } }),
            own: channel.youOwn,
            invite: () => go({ to: "modal", modal: { kind: "invite" } }),
            end: () => go({ to: "modal", modal: { kind: "channel", end: true } }),
            read: (tile?.unread ?? 0) > 0 ? (code) => actions.markChannelRead(code, tile?.head) : null,
          }
        )
      )
    )
  }
  return (
    <div ref={sideRef} className="side">
      <nav className="side-views" aria-label={t("shell.channel.views")}>
        <button
          type="button"
          className="side-chan"
          aria-haspopup="menu"
          aria-label={t("shell.channel.menu.label", { name: channel.title })}
          onClick={(e) => channelMenu(e.currentTarget.getBoundingClientRect())}
        >
          <span className="side-chan-name">{channel.title}</span>
          <Icon name="down" size={14} />
        </button>
        {views && <ViewRows channel={channel} />}
      </nav>
      <section aria-label={t("shell.sidebar.rooms")}>
        <Heading action={channel.youOwn || channel.youTrusted ? <IconButton icon="plus" label={t("shell.sidebar.new.room")} onClick={() => go({ to: "dialog", dialog: "new-room" })} /> : undefined}>
          {t("shell.sidebar.rooms")}
        </Heading>
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
                  title={r.muted ? t("shell.sidebar.room.muted", { name: r.name }) : undefined}
                  onClick={() => open(channel.code, where)}
                  onContextMenu={(e) => showMenu(e, `#${r.name}`, (x) => x.roomGroups({ channel, go }, actions, on, canLeave, r))}
                >
                  <span className="side-hash">{r.members ? <Icon name="people" size={12} label={t("shell.sidebar.members.only")} /> : "#"}</span>
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
        <section aria-label={t("shell.sidebar.people")}>
          <Heading action={channel.youOwn ? <IconButton icon="plus" label={t("shell.sidebar.invite.people")} onClick={() => go({ to: "modal", modal: { kind: "invite" } })} /> : undefined}>
            {t("shell.sidebar.people")}
          </Heading>
          <ul>
            {me && <You person={me} />}
            {humans.map((p) => (
              <Member key={p.name} person={p} channel={channel} direct={directOf.get(p.name)} />
            ))}
            {leftPeople.filter(showLeft).map((d) => (
              <Former key={d.with} channel={channel} direct={d} />
            ))}
            {tuckedPeople.length > 0 && <HiddenRows count={tuckedPeople.length} news={unreadIn(tuckedPeople)} open={showHidden} toggle={toggleHidden} />}
            {channel.youOwn && humans.length === 0 && (
              <li>
                <button type="button" className={cx("side-row is-add", nav.modal?.kind === "invite" && "is-on")} onClick={() => go({ to: "modal", modal: { kind: "invite" } })}>
                  <Icon name="plus" size={14} />
                  <span className="side-label">{t("shell.sidebar.invite.people")}</span>
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      <section aria-label={t("shell.sidebar.agents")}>
        <Heading action={agents.length > 0 ? <IconButton icon="plus" label={t("shell.sidebar.add.agent")} onClick={() => go({ to: "modal", modal: { kind: "add-agent" } })} /> : undefined}>
          {t("shell.sidebar.agents")}
        </Heading>
        <ul>
          {agents.map((p) => (
            <Member key={p.name} person={p} channel={channel} direct={directOf.get(p.name)} />
          ))}
          {leftAgents.filter(showLeft).map((d) => (
            <Former key={d.with} channel={channel} direct={d} />
          ))}
          {tuckedAgents.length > 0 && <HiddenRows count={tuckedAgents.length} news={unreadIn(tuckedAgents)} open={showHidden} toggle={toggleHidden} />}
          {agents.length === 0 && (
            <li>
              <button type="button" className={cx("side-row is-add", nav.modal?.kind === "add-agent" && "is-on")} onClick={() => go({ to: "modal", modal: { kind: "add-agent" } })}>
                <Icon name="plus" size={14} />
                <span className="side-label">{t("shell.sidebar.add.agent")}</span>
              </button>
            </li>
          )}
        </ul>
      </section>

      {channel.theirs.length > 0 && (
        <section aria-label={t("shell.sidebar.others")}>
          <ul>
            <li>
              <button type="button" className="side-row is-add" aria-expanded={openTheirs} onClick={() => setOpenTheirs(!openTheirs)}>
                <span className="side-icon">
                  <Icon name={openTheirs ? "down" : "chevron"} size={14} />
                </span>
                <span className="side-label">{t("shell.sidebar.others")}</span>
                <Count n={channel.theirs.length} />
              </button>
            </li>
            {channel.theirs.map((pair) => {
              const where = { kind: "theirs", between: pair.between } as const
              const on = onChat && sameWhere(nav.where, where)
              if (!openTheirs && !on) return null
              return (
                <li key={pair.between.join("&")}>
                  <button type="button" className={cx("side-row", on && "is-on")} aria-current={on ? "page" : undefined} onClick={() => go({ to: "where", where })}>
                    <span className="side-pair">
                      <Avatar person={memberOf(channel, pair.between[0])} size="sm" />
                      <Avatar person={memberOf(channel, pair.between[1])} size="sm" />
                    </span>
                    <span className="side-label">{between(channel, pair.between)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

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
  const task = taskOf(p, channel)
  if (task) return `T${task.id} ${STATUS_WORDS[task.status]}`
  if (p.presence === "offline") return t("shell.sidebar.offline.ago", { ago: ago(p.lastSeen) })
  if (p.kind === "human") return p.presence === "away" ? t("shell.sidebar.away") : t("shell.sidebar.online")
  return restOf(p)
}

const taskOf = (p: Person, channel: Channel) => (p.load?.doing[0] !== undefined ? channel.tasks.find((t) => t.id === p.load?.doing[0]) : undefined)

const unreadIn = (directs: readonly Direct[]): number => directs.reduce((n, d) => n + d.unread, 0)

function HiddenRows({ count, news = 0, open, toggle }: { count: number; news?: number; open: boolean; toggle: () => void }) {
  return (
    <li>
      <button type="button" className="side-row is-add" aria-expanded={open} onClick={toggle}>
        <Icon name={open ? "down" : "chevron"} size={14} />
        <span className="side-label">{open ? t("shell.sidebar.show.less") : t("shell.sidebar.hidden", { count })}</span>
        {!open && <Count n={news} loud />}
      </button>
    </li>
  )
}

function Former({ channel, direct }: { channel: Channel; direct: Direct }) {
  const nav = useNav()
  const go = useGo()
  const open = useOpenToType()
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
        title={agent ? t("shell.sidebar.left.channel") : undefined}
        onClick={() => open(channel.code, where)}
        onContextMenu={(e) => showMenu(e, nickname(channel, direct.with), (x) => x.directGroups({ channel, go }, actions, direct, who))}
      >
        <Avatar person={who} size="sm" />
        <span className={agent ? "side-name" : "side-label"}>{nickname(channel, direct.with)}</span>
        {agent && <span className="side-state">{t("shell.sidebar.left")}</span>}
        <Count n={direct.unread} loud />
      </button>
    </li>
  )
}

function You({ person }: { person: Person }) {
  const go = useGo()
  return (
    <li>
      <button type="button" className="side-row side-member" title={t("shell.sidebar.your.profile")} onClick={() => go({ to: "modal", modal: { kind: "person", name: person.name } })}>
        <Avatar person={person} size="sm" pip />
        <span className="side-name">{shown(person)}</span>
        <span className="side-state">{t("shell.sidebar.you")}</span>
      </button>
    </li>
  )
}

function Member({ person, channel, direct }: { person: Person; channel: Channel; direct: Direct | undefined }) {
  const nav = useNav()
  const go = useGo()
  const open = useOpenToType()
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
        onClick={() => open(channel.code, where)}
        onContextMenu={(e) =>
          showMenu(e, shown(person), (x) => [unread > 0 ? [{ label: t("shell.sidebar.mark.read"), run: () => actions.markRead(channel.code, where) }] : [], x.personItems({ channel, go }, person)])
        }
      >
        <Avatar person={person} size="sm" pip />
        <span className="side-name">{shown(person)}</span>
        {live && (
          <span key={live.text} className="side-state">
            {live.busy ? live.text : t("shell.sidebar.needs.person")}
          </span>
        )}
        {!live && unsureOf(person) && <span className="side-state">{t("doing.unknown")}</span>}
        <Count n={unread} loud />
      </button>
    </li>
  )
}
