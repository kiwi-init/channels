import "~/styles/person.css"

import { useId, useState, type ReactNode } from "react"

import { TaskChip } from "~/chat/cards"
import { Avatar, cx, Dialog, DialogHead, Empty, Heading, Toggle } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import { ALL_POWERS, memberOf, NO_POWERS, trusted, type App, type Channel, type Person } from "~/model"
import { useApp } from "~/nav"
import { nickname, shown } from "~/names"
import { ShowAgent } from "~/kit/show-agent"
import { contextOf, liveOf, restOf } from "~/doing"
import { PanelHead } from "~/panels/frame"
import { InlineEdit } from "~/settings/controls"
import { CopyBox } from "~/panels/invite"

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
      <PanelHead title="Profile" />
      <div className="panel-body person">
        <Hero person={person} />
        <Now channel={channel} person={person} />
        {!person.left && <Doors channel={channel} person={person} />}
        {!person.left && person.seat === "hosted" && <Terminal channel={channel} person={person} />}
        <Facts channel={channel} person={person} />
        {(channel.youOwn || (channel.youManageAgents && person.kind === "agent")) && !person.you && !person.owner && !person.left && <Manage channel={channel} person={person} />}
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

const LOAD_ROWS = [
  ["doing", "Working on"],
  ["queued", "Up next"],
  ["waiting", "Waiting for review"],
] as const

const capital = (text: string): string => text.slice(0, 1).toUpperCase() + text.slice(1)

function Now({ channel, person }: { channel: Channel; person: Person }) {
  const { app } = useApp()
  const live = person.left ? null : liveOf(person)
  const context = app.computer?.contextLine && !person.left ? contextOf(person) : null
  const rest = !live && person.kind === "agent" && person.presence === "online" ? restOf(person) : null
  const presence = person.left
    ? `Left the channel · last seen ${since(person.lastSeen)}`
    : person.presence === "online"
      ? "Online"
      : person.presence === "away"
        ? `Away · last seen ${since(person.lastSeen)}`
        : `Offline · last seen ${since(person.lastSeen)}`
  return (
    <section className="person-now" aria-label="Now">
      <p className="person-presence">
        <span className={cx("person-dot", `is-${person.presence}`)} aria-hidden="true" />
        <span>{presence}</span>
        {live && (
          <span className={live.busy ? "tone-doing" : "tone-decide"}>
            · {capital(live.text)}
            {live.since && ago(live.since) !== "now" && <span className="dim"> for {ago(live.since)}</span>}
          </span>
        )}
        {rest && <span className="dim">· {capital(rest)}</span>}
        {person.load?.level === "overloaded" && <span className="tone-alert">· Overloaded</span>}
        {context && <span className={context.over ? "tone-alert" : "dim"}>· {context.text}</span>}
      </p>
      {person.about && <p className="person-about">{person.about}</p>}
      {LOAD_ROWS.map(([key, label]) => {
        const ids = (person.load?.[key] ?? []).filter((id) => channel.tasks.some((t) => t.id === id))
        return ids.length > 0 ? (
          <div key={key} className="person-doing">
            <span className="person-label">{label}</span>
            {ids.map((id) => (
              <TaskChip key={id} channel={channel} id={id} />
            ))}
          </div>
        ) : null
      })}
    </section>
  )
}

function Doors({ channel, person }: { channel: Channel; person: Person }) {
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
        Message
      </button>
      {person.seat !== "hosted" && <ShowAgent channel={channel} person={person} />}
    </div>
  )
}

function Terminal({ channel, person }: { channel: Channel; person: Person }) {
  const { app, nav, go, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const here = nav.term?.kind === "agent" && nav.term.name === person.name
  return (
    <section className="person-term" aria-label="Terminal">
      <Heading>Terminal</Heading>
      <p className="person-term-note">It runs in Channels' own tmux on this computer.</p>
      <div className="actions">
        <button type="button" className="btn" aria-pressed={here} onClick={() => go({ to: "term", term: here ? null : { kind: "agent", name: person.name } })}>
          Open here
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void app.actions
              .showAgent(channel.code, person.name)
              .then((note) => note && toast(note))
              .finally(() => setBusy(false))
          }}
        >
          <Icon name="external" size={14} />
          Open in your terminal
        </button>
      </div>
      {person.attach && <CopyBox text={person.attach} label="Copy the command" wrap />}
      <p className="person-term-note">
        To leave it running, press <kbd>Ctrl-b</kbd> then <kbd>d</kbd>.
      </p>
    </section>
  )
}

function Facts({ channel, person }: { channel: Channel; person: Person }) {
  const { app, go } = useApp()
  const persona = personaOf(app.personas, person.persona)
  const editable = (channel.youOwn || (!!channel.youManageAgents && person.kind === "agent")) && !person.you && !person.owner
  const sponsor = person.sponsor ? memberOf(channel, person.sponsor) : undefined
  const rows: [string, ReactNode][] =
    person.kind === "agent"
      ? [
          ["Computer", person.machine ?? person.specs ?? "unknown"],
          ...(person.machine && person.specs ? [["System", person.specs] satisfies [string, ReactNode]] : []),
          [
            "Repo",
            person.repo ? (
              <span className="person-repo">
                <code>
                  {person.repo}
                  {person.branch && <span className="dim">@{person.branch}</span>}
                </code>
                {person.outside && <span className="tone-decide">Not one of this channel's repos</span>}
              </span>
            ) : (
              "unknown"
            ),
          ],
          ...(person.tools?.length ? [["Tools", person.tools.join(", ")] satisfies [string, ReactNode]] : []),
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
  const owns = channel.youOwn
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
      {owns && agent && (
        <Row label="Nickname" hint="The name people see. Its handle stays the same." stack>
          {() => <InlineEdit value={person.display ?? ""} label="Nickname" verb="Change" onSave={(v) => app.actions.setNickname(channel.code, person.name, v || null)} />}
        </Row>
      )}
      {owns && (
        <>
          {!agent && (
            <div className="person-trust">
              <Row
                label="Full trust"
                hint={
                  trust
                    ? "They write and work, add agents, answer decisions and manage agents. The channel stays yours."
                    : "Every power at once, for someone you'd trust with your life. The channel stays yours."
                }
              >
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
            </div>
          )}
          <Row label="Can only read" hint={`${agent ? "It reads" : "They read"} messages but can't post or take tasks.`}>
            {(id) => <Toggle id={id} on={!!person.readOnly} onChange={(on) => app.actions.setReadOnly(channel.code, person.name, on)} />}
          </Row>
          {agent && person.wakes !== undefined && (
            <Row label="Wake it on new messages" hint={person.wakes ? "It starts working when someone writes." : "Off: it reads them on its next run."}>
              {(id) => <Toggle id={id} on={person.wakes === true} onChange={(on) => app.actions.setWake(channel.code, person.name, on)} />}
            </Row>
          )}
          {!agent && (
            <>
              <Row label="Can add agents" hint={person.addsAgents ? "Their agents come in without waiting for you." : "Their agents wait for you to let them in."}>
                {(id) => <Toggle id={id} on={!!person.addsAgents} onChange={(on) => app.actions.setPowers(channel.code, person.name, { addsAgents: on })} />}
              </Row>
              <Row label="Can answer decisions" hint="Agents' questions and approvals can go to them as well as you.">
                {(id) => <Toggle id={id} on={!!person.answersDecisions} onChange={(on) => app.actions.setPowers(channel.code, person.name, { answersDecisions: on })} />}
              </Row>
              <Row label="Can manage agents" hint="They pick agents' personalities and roles, the lead included. Never people's, and never their own.">
                {(id) => <Toggle id={id} on={!!person.managesAgents} onChange={(on) => app.actions.setPowers(channel.code, person.name, { managesAgents: on })} />}
              </Row>
            </>
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
        </>
      )}
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
