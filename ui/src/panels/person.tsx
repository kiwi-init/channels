import "~/styles/person.css"

import { useId, useState, type ReactNode } from "react"

import { TaskChip } from "~/chat/cards"
import { Avatar, cx, Dialog, DialogHead, Empty, Heading, Toggle } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { App, Channel, Person } from "~/model"
import { useApp } from "~/nav"
import { nickname, shown } from "~/names"
import { PanelHead } from "~/panels/frame"

const since = (at: number, on = "on "): string => {
  const a = ago(at)
  if (a === "now") return "just now"
  return /^\d+[mhd]$/.test(a) ? `${a} ago` : `${on}${a}`
}

const personaOf = (personas: App["personas"], value: string | undefined) => (value ? personas.find((p) => p.id === value || p.label === value) : undefined)

export function PersonPanel({ channel, name }: { channel: Channel; name: string }) {
  const person = channel.people.find((p) => p.name === name)
  if (!person)
    return (
      <>
        <PanelHead title="Profile" />
        <Empty title={`${name} isn't in this channel.`}>They may have left or been removed.</Empty>
      </>
    )
  return (
    <>
      <PanelHead title="Profile" />
      <div className="panel-body person">
        <Hero person={person} />
        <Now channel={channel} person={person} />
        <Doors person={person} />
        <Facts channel={channel} person={person} />
        {channel.youOwn && !person.you && !person.owner && <Manage channel={channel} person={person} />}
      </div>
    </>
  )
}

function Hero({ person }: { person: Person }) {
  const tags = [...new Set([person.you && "you", person.owner && "owner", person.role, person.readOnly && "reads only"].filter((t): t is string => !!t))]
  const kind = person.kind === "agent" ? ["Agent", person.runs, person.model].filter(Boolean).join(" · ") : "Person"
  return (
    <header className="person-hero">
      <Avatar person={person} size="lg" pip />
      <div className="person-id">
        <h3 className="person-name">
          <span className="person-name-text">{shown(person)}</span>
          {tags.map((t) => (
            <span key={t} className="person-tag">
              {t}
            </span>
          ))}
        </h3>
        <p className="person-kind">{kind}</p>
      </div>
    </header>
  )
}

function Now({ channel, person }: { channel: Channel; person: Person }) {
  const doing = person.doing !== undefined ? channel.tasks.find((t) => t.id === person.doing) : undefined
  const presence = person.presence === "online" ? "Online" : person.presence === "away" ? `Away · last seen ${since(person.lastSeen)}` : `Offline · last seen ${since(person.lastSeen)}`
  return (
    <section className="person-now" aria-label="Now">
      <p className="person-presence">
        <span className={cx("person-dot", `is-${person.presence}`)} aria-hidden="true" />
        <span>{presence}</span>
        {person.typing && <span className="tone-doing">· typing…</span>}
        {!person.typing && !doing && person.kind === "agent" && person.presence === "online" && <span className="dim">· idle</span>}
      </p>
      {person.about && <p className="person-about">{person.about}</p>}
      {doing && (
        <div className="person-doing">
          <span className="person-label">Working on</span>
          <TaskChip channel={channel} id={doing.id} />
        </div>
      )}
    </section>
  )
}

function Doors({ person }: { person: Person }) {
  const { go } = useApp()
  if (person.you)
    return (
      <section className="person-me">
        <p>This is you.</p>
        <button type="button" className="btn" onClick={() => go({ to: "settings", section: "account" })}>
          Your settings
        </button>
      </section>
    )
  return (
    <div className="actions">
      <button
        type="button"
        className="btn is-primary"
        onClick={() => {
          go({ to: "where", where: { kind: "dm", with: person.name } })
          go({ to: "panel", panel: null })
        }}
      >
        Message privately
      </button>
    </div>
  )
}

function Facts({ channel, person }: { channel: Channel; person: Person }) {
  const { app, go } = useApp()
  const persona = personaOf(app.personas, person.persona)
  const editable = channel.youOwn && !person.you && !person.owner
  const sponsor = person.sponsor ? channel.people.find((p) => p.name === person.sponsor) : undefined
  const rows: [string, ReactNode][] =
    person.kind === "agent"
      ? [
          ["Computer", person.machine ?? "unknown"],
          ["Folder", person.folder ? <code>{person.folder}</code> : "unknown"],
          [
            "Brought by",
            sponsor ? (
              <button type="button" className="person-ref" onClick={() => go({ to: "panel", panel: { kind: "person", name: sponsor.name } })}>
                {sponsor.you ? "you" : shown(sponsor)}
              </button>
            ) : person.sponsor ? (
              nickname(channel, person.sponsor)
            ) : (
              "unknown"
            ),
          ],
          ...(editable ? [] : [["Personality", persona?.label ?? person.persona ?? "none"] satisfies [string, ReactNode]]),
          ["Joined", since(person.joined, "")],
          ["Messages", person.messages.toLocaleString()],
        ]
      : [
          ["Joined", since(person.joined, "")],
          ["Messages", person.messages.toLocaleString()],
          [
            "Color",
            person.color ? (
              <span className="person-color">
                <span className="person-swatch" style={{ background: `var(--c-${person.color})` }} aria-hidden="true" />
                {person.color}
              </span>
            ) : (
              "none"
            ),
          ],
        ]
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
  const remove = () => {
    app.actions.removeMember(channel.code, person.name)
    setConfirm(false)
    go({ to: "panel", panel: null })
    toast(`Removed ${shown(person)}`)
  }
  return (
    <section className="person-manage" aria-label="Manage">
      <Heading>Manage</Heading>
      <Row label="Role">
        {(id) => (
          <div id={id} className="seg" role="group" aria-labelledby={`${id}-label`}>
            <button type="button" aria-pressed={!person.role} onClick={() => app.actions.setRole(channel.code, person.name, null)}>
              None
            </button>
            {roles.map((r) => (
              <button key={r} type="button" aria-pressed={person.role === r} onClick={() => app.actions.setRole(channel.code, person.name, r)}>
                {r.slice(0, 1).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        )}
      </Row>
      {agent && (
        <Row label="Personality" hint={persona?.about ?? "Works the way its harness does by default."} stack>
          {(id) => (
            <span className="person-select">
              <select id={id} className="input is-mono" value={persona?.id ?? ""} onChange={(e) => app.actions.setPersona(channel.code, person.name, e.target.value || null)}>
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
      <Row label="Can only read" hint={`${it} reads messages but can't post or take tasks.`}>
        {(id) => <Toggle id={id} on={!!person.readOnly} onChange={(on) => app.actions.setReadOnly(channel.code, person.name, on)} />}
      </Row>
      {agent && (
        <Row label="Wake it on new messages" hint={person.wakes === false ? "Off: it reads them on its next run." : "It starts working when someone writes."}>
          {(id) => <Toggle id={id} on={person.wakes !== false} onChange={(on) => app.actions.setWake(channel.code, person.name, on)} />}
        </Row>
      )}
      <div className="person-remove">
        <button type="button" className="btn is-danger" onClick={() => setConfirm(true)}>
          Remove from channel
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
    </section>
  )
}

function Row({ label, hint, stack, children }: { label: string; hint?: string; stack?: boolean; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className={cx("person-row", stack && "is-stacked")}>
      <div className="person-row-text">
        <label className="person-row-label" htmlFor={id} id={`${id}-label`}>
          {label}
        </label>
        {hint && !stack && <p className="person-row-hint">{hint}</p>}
      </div>
      <div className="person-row-control">{children(id)}</div>
      {hint && stack && <p className="person-row-hint">{hint}</p>}
    </div>
  )
}
