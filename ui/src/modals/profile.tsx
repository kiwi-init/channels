import "~/styles/person.css"

import { Fragment, useState, type ReactNode } from "react"

import { Avatar, Dot, statusWord } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Toggle } from "~/kit/form"
import { Modal } from "~/kit/modal"
import { Track } from "~/kit/glide"
import { Swatches } from "~/kit/swatches"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { copyText } from "~/kit/toasts"
import { ALL_POWERS, memberOf, NO_POWERS, trusted, type App, type Channel, type Person, type Task } from "~/model"
import { useApp } from "~/nav"
import { devicesOf, nickname, seatRoot, shown } from "~/names"
import { contextOf, liveOf, restOf } from "~/doing"
import { Group, InlineEdit, Row } from "~/settings/controls"

const since = (at: number, on = "on "): string => {
  const a = ago(at)
  if (a === "now") return "just now"
  return /^\d+[mhd]$/.test(a) ? `${a} ago` : `${on}${a}`
}

const personaOf = (personas: App["personas"], value: string | undefined) => (value ? personas.find((p) => p.id === value || p.label === value) : undefined)

export function Profile({ channel, name, onClose }: { channel: Channel; name: string; onClose: () => void }) {
  const person = memberOf(channel, name)
  if (!person)
    return (
      <Modal dismiss="outside" onClose={onClose} label="Profile" title="Profile">
        <Empty title={`${nickname(channel, name)} isn't in this channel.`}>They may have left or been removed.</Empty>
      </Modal>
    )
  const tags = [...new Set([person.you && "you", person.owner && "owner", person.role, person.readOnly && "reads only"].filter((t): t is string => !!t))]
  const manages = (channel.youOwn || (channel.youManageAgents && person.kind === "agent") || person.yours) && !person.you && !person.owner && !person.left
  return (
    <Modal
      dismiss="outside"
      onClose={onClose}
      label={`Profile of ${shown(person)}`}
      className="person"
      lead={<Avatar person={person} size="lg" pip />}
      title={
        <span className="person-name">
          <span className="person-name-text">{shown(person)}</span>
          {tags.length > 0 && <span className="person-tags">{tags.join(" ")}</span>}
        </span>
      }
      sub={<Status person={person} />}
    >
      {person.about && <p className="person-about">{person.about}</p>}
      {!person.left && <Doors channel={channel} person={person} />}
      <Tasks channel={channel} person={person} />
      <Facts channel={channel} person={person} />
      {manages && <Manage channel={channel} person={person} />}
    </Modal>
  )
}

function Status({ person }: { person: Person }) {
  const { app } = useApp()
  const seen = (word: string): string => (ago(person.lastSeen) === "now" ? word : `${word} · ${ago(person.lastSeen)}`)
  if (person.left) return <span className="person-status">{seen("left")}</span>
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
  else if (person.presence === "online") parts.push(<span key="rest">{person.kind === "agent" ? restOf(person) : "online"}</span>)
  else parts.push(<span key="away">{seen(person.presence)}</span>)
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
  return (
    <span className="person-status">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {part}
        </Fragment>
      ))}
    </span>
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
    <Group title="Working on">
      {tasks.map((t) => (
        <button key={t.id} type="button" className="person-task" title={statusWord(t)} onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
          <Dot status={t.status} />
          <span className="person-task-id num">T{t.id}</span>
          <span className="person-task-title">{t.title}</span>
        </button>
      ))}
    </Group>
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
      <button type="button" className="btn is-primary" onClick={() => go({ to: "where", where: { kind: "dm", with: seatRoot(channel, person.name) } })}>
        Message
      </button>
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
    <button type="button" className="person-ref" onClick={() => go({ to: "modal", modal: { kind: "person", name: sponsor.name } })}>
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
  const handle = (
    <span key="handle" className="person-handle" data-handle>
      <code>{person.name}</code>
      {person.seatOf && <span className="dimmer">seat of {person.seatOf}</span>}
      <button type="button" className="icon-btn" aria-label="Copy handle" title="Copy handle" onClick={() => copyText(person.name, "Handle copied")}>
        <Icon name="copy" />
      </button>
    </span>
  )
  const rows: [string, ReactNode][] =
    person.kind === "agent"
      ? [
          ...(shown(person) !== person.name ? [["Handle", handle] satisfies [string, ReactNode]] : []),
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
    <Group title="Details">
      {rows.map(([k, v]) => (
        <Row key={k} label={k}>
          <span className="person-value">{v}</span>
        </Row>
      ))}
    </Group>
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
    go({ to: "modal", modal: null })
    toast(`Removed ${shown(person)}`)
  }
  return (
    <>
      {edits && (
        <Group title={agent ? "Agent settings" : "Settings"}>
          {agent && (
            <Row label="Nickname" hint="The name people see. Its handle stays the same.">
              <InlineEdit value={person.display ?? ""} label="Nickname" verb={person.display ? "Change" : "Set"} onSave={(v) => app.actions.setNickname(channel.code, person.name, v || null)} />
            </Row>
          )}
          <Row label="Role">
            <Track className="seg" role="group" aria-label="Role">
              <button type="button" aria-pressed={!person.role} onClick={() => app.actions.setRole(channel.code, person.name, null)}>
                None
              </button>
              {roles.map((r) => (
                <button key={r} type="button" aria-pressed={person.role === r} onClick={() => app.actions.setRole(channel.code, person.name, r)}>
                  {r.slice(0, 1).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </Track>
          </Row>
          {agent && (
            <Row label="Personality" hint={persona?.about}>
              <span className="person-select">
                <select className="input" aria-label="Personality" value={persona?.id ?? ""} onChange={(e) => app.actions.setPersona(channel.code, person.name, e.target.value || null)}>
                  <option value="">None</option>
                  {app.personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <Icon name="down" size={14} />
              </span>
            </Row>
          )}
          {agent && (
            <Row label="Colour" hint="Its face takes this colour, for everyone here." wide>
              <Swatches color={person.color} onPick={(c) => app.actions.setAgentColor(channel.code, person.name, c)} />
            </Row>
          )}
        </Group>
      )}
      {owns && (
        <Group title="Powers">
          {!agent && (
            <Row label="Full trust" hint="Every power below at once. The channel stays yours.">
              <Toggle
                label="Full trust"
                on={trust}
                onChange={(on) => {
                  if (on && person.readOnly) app.actions.setReadOnly(channel.code, person.name, false)
                  app.actions.setPowers(channel.code, person.name, on ? ALL_POWERS : NO_POWERS)
                }}
              />
            </Row>
          )}
          <Row label="Can only read" hint={`${agent ? "It reads" : "They read"} messages but can't post or take tasks.`}>
            <Toggle label="Can only read" on={!!person.readOnly} onChange={(on) => app.actions.setReadOnly(channel.code, person.name, on)} />
          </Row>
          {agent && person.wakes !== undefined && (
            <Row label="Wake it on new messages" hint={person.wakes ? "It starts working when someone writes." : "It reads them on its next run."}>
              <Toggle label="Wake it on new messages" on={person.wakes === true} onChange={(on) => app.actions.setWake(channel.code, person.name, on)} />
            </Row>
          )}
          {!agent && (
            <>
              <Row label="Can add agents" hint={person.addsAgents ? "Their agents come in without waiting for you." : "Their agents wait for you to let them in."}>
                <Toggle label="Can add agents" on={!!person.addsAgents} onChange={(on) => app.actions.setPowers(channel.code, person.name, { addsAgents: on })} />
              </Row>
              <Row label="Can answer decisions" hint="Agents' questions and approvals can go to them as well as you.">
                <Toggle label="Can answer decisions" on={!!person.answersDecisions} onChange={(on) => app.actions.setPowers(channel.code, person.name, { answersDecisions: on })} />
              </Row>
              <Row label="Can manage agents" hint="They name agents and pick their personalities and roles, the lead included. Never people's, and never their own.">
                <Toggle label="Can manage agents" on={!!person.managesAgents} onChange={(on) => app.actions.setPowers(channel.code, person.name, { managesAgents: on })} />
              </Row>
            </>
          )}
        </Group>
      )}
      {(owns || person.yours) && (
        <div className="modal-end">
          <button type="button" className="btn is-quiet is-small" onClick={() => setConfirm(true)}>
            Remove from channel…
          </button>
        </div>
      )}
      <Modal
        dismiss="outside"
        open={confirm}
        onClose={() => setConfirm(false)}
        label={`Remove ${shown(person)}`}
        title={`Remove ${shown(person)}?`}
        sub={`${it} loses access to this channel's messages from now on.`}
        foot={
          <>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button type="button" className="btn is-danger" onClick={remove}>
              Remove
            </button>
          </>
        }
      />
    </>
  )
}
