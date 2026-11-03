import "~/styles/person.css"

import { Fragment, useId, useState, type ReactNode } from "react"

import { Avatar, cx, Dialog, DialogHead, Dot, Empty, Heading, statusWord, Toggle } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { Swatches } from "~/kit/swatches"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { ALL_POWERS, memberOf, NO_POWERS, trusted, type App, type Channel, type Person, type Task } from "~/model"
import { useApp } from "~/nav"
import { devicesOf, nickname, seatRoot, shown } from "~/names"
import { ShowAgent } from "~/kit/show-agent"
import { contextOf, liveOf, restOf } from "~/doing"
import { PanelHead } from "~/panels/frame"
import { InlineEdit } from "~/settings/controls"

const since = (at: number, on = "on "): string => {
  const a = ago(at)
  if (a === "now") return "just now"
  return /^\d+[mhd]$/.test(a) ? `${a} ago` : `${on}${a}`
}

const personaOf = (personas: App["personas"], value: string | undefined) => (value ? personas.find((p) => p.id === value || p.label === value) : undefined)

export function PersonPanel({ channel, name }: { channel: Channel; name: string }) {
  const person = memberOf(channel, name)
  if (!person)
    return (
      <>
        <PanelHead title="Profile" />
        <Empty title={`${nickname(channel, name)} isn't in this channel.`}>They may have left or been removed.</Empty>
      </>
    )
  return (
    <>
      <PanelHead title={<span className="sr">Profile</span>} />
      <div className="panel-body person">
        <section className="person-top" aria-label={shown(person)}>
          <Hero person={person} />
          <Tasks channel={channel} person={person} />
          {!person.left && <Doors channel={channel} person={person} />}
        </section>
        <Facts channel={channel} person={person} />
        {(channel.youOwn || (channel.youManageAgents && person.kind === "agent") || person.yours) && !person.you && !person.owner && !person.left && <Manage channel={channel} person={person} />}
      </div>
    </>
  )
}

function Status({ person }: { person: Person }) {
  const { app } = useApp()
  const seen = (word: string): string => (ago(person.lastSeen) === "now" ? word : `${word} · ${ago(person.lastSeen)}`)
  if (person.left) return <p className="person-status">{seen("left")}</p>
  const live = liveOf(person)
  const context = app.computer?.contextLine ? contextOf(person) : null
  const parts: ReactNode[] = []
  if (live)
    parts.push(
      <span key="live" className={live.busy ? "tone-doing" : "tone-decide"}>
        {live.text}
        {live.since && ago(live.since) !== "now" && <span className="dimmer"> · {ago(live.since)}</span>}
      </span>
    )
  else if (person.presence === "online") {
    if (person.kind === "agent") parts.push(<span key="rest">{restOf(person)}</span>)
  } else parts.push(<span key="away">{seen(person.presence)}</span>)
  if (person.load?.level === "overloaded")
    parts.push(
      <span key="load" className="tone-alert">
        overloaded
      </span>
    )
  if (context)
    parts.push(
      <span key="context" className={context.over ? "tone-alert" : undefined}>
        {context.text}
      </span>
    )
  if (!parts.length) return null
  return (
    <p className="person-status">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {part}
        </Fragment>
      ))}
    </p>
  )
}

function Hero({ person }: { person: Person }) {
  const tags = [...new Set([person.you && "you", person.owner && "owner", person.role, person.readOnly && "reads only"].filter((t): t is string => !!t))]
  return (
    <header className="person-hero">
      <Avatar person={person} size="lg" pip />
      <div className="person-id">
        <h3 className="person-name">
          <span className="person-name-text">{shown(person)}</span>
          {tags.length > 0 && <span className="person-tags">{tags.join(" ")}</span>}
        </h3>
        <Status person={person} />
        {person.about && <p className="person-about">{person.about}</p>}
      </div>
    </header>
  )
}

const LOAD_ORDER = ["doing", "waiting", "queued"] as const

function Tasks({ channel, person }: { channel: Channel; person: Person }) {
  const { go } = useApp()
  if (person.left) return null
  const ids = [...new Set(LOAD_ORDER.flatMap((key) => person.load?.[key] ?? []))]
  const tasks = ids.map((id) => channel.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)
  if (!tasks.length) return null
  return (
    <ul className="person-tasks" aria-label="Tasks">
      {tasks.map((t) => (
        <li key={t.id}>
          <button type="button" className="person-task" title={statusWord(t)} onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
            <Dot status={t.status} />
            <span className="person-task-id num">T{t.id}</span>
            <span className="person-task-title">{t.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Doors({ channel, person }: { channel: Channel; person: Person }) {
  const { go } = useApp()
  if (person.you)
    return (
      <div className="actions">
        <button type="button" className="btn" onClick={() => go({ to: "settings", section: "account" })}>
          Your settings
        </button>
      </div>
    )
  return (
    <div className="actions">
      <button
        type="button"
        className="btn is-primary"
        onClick={() => {
          go({ to: "where", where: { kind: "dm", with: seatRoot(channel, person.name) } })
          go({ to: "panel", panel: null })
        }}
      >
        Message
      </button>
      <ShowAgent channel={channel} person={person} />
    </div>
  )
}

function Facts({ channel, person }: { channel: Channel; person: Person }) {
  const { app, go } = useApp()
  const persona = personaOf(app.personas, person.persona)
  const editable = (channel.youOwn || (!!channel.youManageAgents && person.kind === "agent")) && !person.you && !person.owner
  const sponsor = person.sponsor ? memberOf(channel, person.sponsor) : undefined
  const devices = devicesOf(channel.people, { name: seatRoot(channel, person.name) })
  const by = sponsor ? (
    <button type="button" className="person-ref" onClick={() => go({ to: "panel", panel: { kind: "person", name: sponsor.name } })}>
      {sponsor.you ? "you" : shown(sponsor)}
    </button>
  ) : person.sponsor ? (
    nickname(channel, person.sponsor)
  ) : null
  const joined = (
    <>
      <span title={`${person.messages.toLocaleString()} messages`}>{since(person.joined, "")}</span>
      {by && <> · by {by}</>}
    </>
  )
  const runs = [person.runs, person.model].filter(Boolean).join(" · ")
  const computer = person.machine ?? person.specs
  const rows: [string, ReactNode][] =
    person.kind === "agent"
      ? [
          ...(runs ? [["Runs", runs] satisfies [string, ReactNode]] : []),
          ...(computer
            ? [
                [
                  "Computer",
                  <span key="computer" className="person-stack">
                    {computer}
                    {person.machine && person.specs && <span className="dimmer">{person.specs}</span>}
                  </span>,
                ] satisfies [string, ReactNode],
              ]
            : []),
          ...(person.repo
            ? [
                [
                  "Repo",
                  <span key="repo" className="person-stack">
                    <code>
                      {person.repo}
                      {person.branch && <span className="dimmer">@{person.branch}</span>}
                    </code>
                    {person.outside && <span className="tone-decide">Not one of this channel's repos</span>}
                  </span>,
                ] satisfies [string, ReactNode],
              ]
            : []),
          ...(person.tools?.length ? [["Tools", person.tools.join(", ")] satisfies [string, ReactNode]] : []),
          ...(!editable && persona ? [["Personality", persona.label] satisfies [string, ReactNode]] : []),
          ["Joined", joined],
        ]
      : [...(devices.length ? [["Devices", devices.map((d) => `${d.name} · ${d.presence}`).join(", ")] satisfies [string, ReactNode]] : []), ["Joined", joined]]
  return (
    <section className="person-facts" aria-label="Details">
      <dl className="props">
        {rows.map(([k, v]) => (
          <div key={k} className="person-prop">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Manage({ channel, person }: { channel: Channel; person: Person }) {
  const { app, go, toast } = useApp()
  const [confirm, setConfirm] = useState(false)
  const agent = person.kind === "agent"
  const roles = [...new Set(["lead", ...(person.role ? [person.role] : [])])]
  const persona = personaOf(app.personas, person.persona)
  const it = agent ? "It" : "They"
  const owns = channel.youOwn
  const edits = owns || (!!channel.youManageAgents && agent)
  const trust = !person.readOnly && trusted({ addsAgents: !!person.addsAgents, answersDecisions: !!person.answersDecisions, managesAgents: !!person.managesAgents })
  const remove = () => {
    app.actions.removeMember(channel.code, person.name)
    setConfirm(false)
    go({ to: "panel", panel: null })
    toast(`Removed ${shown(person)}`)
  }
  return (
    <section className="person-manage" aria-label="Manage">
      <Heading>Manage</Heading>
      {edits && agent && (
        <Row label="Nickname" tip="The name people see. Its handle stays the same.">
          {() => <InlineEdit value={person.display ?? ""} label="Nickname" verb={person.display ? "Change" : "Set"} onSave={(v) => app.actions.setNickname(channel.code, person.name, v || null)} />}
        </Row>
      )}
      {edits && (
        <Row label="Role">
          {(id) => (
            <Track id={id} className="seg" role="group" aria-labelledby={`${id}-label`}>
              <button type="button" aria-pressed={!person.role} onClick={() => app.actions.setRole(channel.code, person.name, null)}>
                None
              </button>
              {roles.map((r) => (
                <button key={r} type="button" aria-pressed={person.role === r} onClick={() => app.actions.setRole(channel.code, person.name, r)}>
                  {r.slice(0, 1).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </Track>
          )}
        </Row>
      )}
      {edits && agent && (
        <Row label="Personality" hint={persona?.about}>
          {(id) => (
            <span className="person-select">
              <select id={id} className="input" value={persona?.id ?? ""} onChange={(e) => app.actions.setPersona(channel.code, person.name, e.target.value || null)}>
                <option value="">None</option>
                {app.personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Icon name="down" size={14} />
            </span>
          )}
        </Row>
      )}
      {edits && agent && (
        <Row label="Colour" tip="Its face takes this colour, for everyone here." stack>
          {(id) => <Swatches id={id} color={person.color} onPick={(c) => app.actions.setAgentColor(channel.code, person.name, c)} />}
        </Row>
      )}
      {owns && (
        <>
          {!agent && (
            <Row label="Full trust" tip="Every power below at once. The channel stays yours.">
              {(id) => (
                <Toggle
                  id={id}
                  on={trust}
                  onChange={(on) => {
                    if (on && person.readOnly) app.actions.setReadOnly(channel.code, person.name, false)
                    app.actions.setPowers(channel.code, person.name, on ? ALL_POWERS : NO_POWERS)
                  }}
                />
              )}
            </Row>
          )}
          <Row label="Can only read" tip={`${agent ? "It reads" : "They read"} messages but can't post or take tasks.`}>
            {(id) => <Toggle id={id} on={!!person.readOnly} onChange={(on) => app.actions.setReadOnly(channel.code, person.name, on)} />}
          </Row>
          {agent && person.wakes !== undefined && (
            <Row label="Wake it on new messages" tip={person.wakes ? "It starts working when someone writes." : "It reads them on its next run."}>
              {(id) => <Toggle id={id} on={person.wakes === true} onChange={(on) => app.actions.setWake(channel.code, person.name, on)} />}
            </Row>
          )}
          {!agent && (
            <>
              <Row label="Can add agents" tip={person.addsAgents ? "Their agents come in without waiting for you." : "Their agents wait for you to let them in."}>
                {(id) => <Toggle id={id} on={!!person.addsAgents} onChange={(on) => app.actions.setPowers(channel.code, person.name, { addsAgents: on })} />}
              </Row>
              <Row label="Can answer decisions" tip="Agents' questions and approvals can go to them as well as you.">
                {(id) => <Toggle id={id} on={!!person.answersDecisions} onChange={(on) => app.actions.setPowers(channel.code, person.name, { answersDecisions: on })} />}
              </Row>
              <Row label="Can manage agents" tip="They name agents and pick their personalities and roles, the lead included. Never people's, and never their own.">
                {(id) => <Toggle id={id} on={!!person.managesAgents} onChange={(on) => app.actions.setPowers(channel.code, person.name, { managesAgents: on })} />}
              </Row>
            </>
          )}
        </>
      )}
      {(owns || person.yours) && (
        <>
          <div className="person-remove">
            <button type="button" className="btn is-quiet is-small" onClick={() => setConfirm(true)}>
              Remove from channel…
            </button>
          </div>
          <Dialog open={confirm} onClose={() => setConfirm(false)} label={`Remove ${shown(person)}`}>
            <DialogHead title={`Remove ${shown(person)}?`} onClose={() => setConfirm(false)} />
            <p className="person-confirm">{it} loses access to this channel's messages from now on.</p>
            <div className="dialog-foot">
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="btn is-danger" onClick={remove}>
                Remove
              </button>
            </div>
          </Dialog>
        </>
      )}
    </section>
  )
}

function Row({ label, hint, tip, stack, children }: { label: string; hint?: string; tip?: string; stack?: boolean; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className={cx("person-row", stack && "is-stacked")} title={tip}>
      <label className="person-row-label" htmlFor={id} id={`${id}-label`}>
        {label}
      </label>
      <div className="person-row-control">{children(id)}</div>
      {hint && <p className="person-row-hint">{hint}</p>}
    </div>
  )
}
