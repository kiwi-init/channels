import "~/i18n/en/modals"
import "~/styles/person.css"

import { Fragment, useState, type ReactNode } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { Avatar, Dot, statusWord } from "~/kit/bits"
import { Empty } from "~/kit/empty"
import { Toggle } from "~/kit/form"
import { Modal } from "~/kit/modal"
import { Track } from "~/kit/glide"
import { Swatches } from "~/kit/swatches"
import { Icon } from "~/kit/icons"
import { ageOf, ago } from "~/kit/time"
import { copyText } from "~/kit/toasts"
import { ALL_POWERS, memberOf, NO_POWERS, trusted, type App, type Channel, type Person, type Task } from "~/model"
import { useApp, useGo } from "~/nav"
import { devicesOf, nickname, roleWord, seatRoot, shown, Shown } from "~/names"
import { contextOf, liveOf, restOf } from "~/doing"
import { Group, InlineEdit, Row } from "~/settings/controls"

const since = (at: number): string => {
  const age = ageOf(at)
  if (age === "now") return t("modals.profile.just.now")
  return age === "recent" ? t("modals.profile.ago", { time: ago(at) }) : ago(at)
}

const PRESENCE: Record<Person["presence"], Key> = {
  online: "modals.profile.presence.online",
  away: "modals.profile.presence.away",
  offline: "modals.profile.presence.offline",
}

const personaOf = (personas: App["personas"], value: string | undefined) => (value ? personas.find((p) => p.id === value || p.label === value) : undefined)

export function Profile({ channel, name, onClose }: { channel: Channel; name: string; onClose: () => void }) {
  const person = memberOf(channel, name)
  if (!person)
    return (
      <Modal dismiss="outside" onClose={onClose} label={t("modals.profile.title")} title={t("modals.profile.title")}>
        <Empty title={t("modals.profile.missing", { name: nickname(channel, name) })}>{t("modals.profile.missing.why")}</Empty>
      </Modal>
    )
  const tags = [
    ...new Set(
      [person.you && t("modals.profile.tag.you"), person.owner && t("modals.profile.tag.owner"), person.role && roleWord(person.role), person.readOnly && t("modals.profile.tag.reads.only")].filter(
        (tag): tag is string => !!tag
      )
    ),
  ]
  const manages = (channel.youOwn || (channel.youManageAgents && person.kind === "agent") || person.yours) && !person.you && !person.owner && !person.left
  return (
    <Modal
      dismiss="outside"
      onClose={onClose}
      label={t("modals.profile.of", { name: shown(person) })}
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
  const seen = (word: string): string => (ageOf(person.lastSeen) === "now" ? word : `${word} · ${ago(person.lastSeen)}`)
  if (person.left) return <span className="person-status">{seen(t("modals.profile.left"))}</span>
  const live = liveOf(person)
  const context = app.computer?.contextLine ? contextOf(person) : null
  const parts: ReactNode[] = []
  if (live)
    parts.push(
      <span key="live" className={live.busy ? "tone-doing" : "tone-decide"}>
        {live.text}
        {live.since && ageOf(live.since) !== "now" && <span className="dimmer"> · {ago(live.since)}</span>}
      </span>
    )
  else if (person.presence === "online") parts.push(<span key="rest">{person.kind === "agent" ? restOf(person) : t("modals.profile.presence.online")}</span>)
  else parts.push(<span key="away">{seen(t(PRESENCE[person.presence]))}</span>)
  if (person.load?.level === "overloaded")
    parts.push(
      <span key="load" className="tone-alert">
        {t("modals.profile.overloaded")}
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
  const go = useGo()
  if (person.left) return null
  const ids = [...new Set(LOAD_ORDER.flatMap((key) => person.load?.[key] ?? []))]
  const tasks = ids.map((id) => channel.tasks.find((task) => task.id === id)).filter((task): task is Task => !!task)
  if (!tasks.length) return null
  return (
    <Group title={t("modals.profile.working.on")}>
      {tasks.map((task) => (
        <button key={task.id} type="button" className="person-task" title={statusWord(task)} onClick={() => go({ to: "panel", panel: { kind: "task", task: task.id } })}>
          <Dot status={task.status} />
          <span className="person-task-id num">T{task.id}</span>
          <span className="person-task-title">
            <Shown value={task.title} />
          </span>
        </button>
      ))}
    </Group>
  )
}

function Doors({ channel, person }: { channel: Channel; person: Person }) {
  const go = useGo()
  if (person.you)
    return (
      <div className="actions">
        <button type="button" className="btn" onClick={() => go({ to: "settings", section: "account" })}>
          {t("modals.profile.your.settings")}
        </button>
      </div>
    )
  return (
    <div className="actions">
      <button type="button" className="btn is-primary" onClick={() => go({ to: "where", where: { kind: "dm", with: seatRoot(channel, person.name) } })}>
        {t("modals.profile.message")}
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
      {sponsor.you ? t("modals.profile.by.you") : shown(sponsor)}
    </button>
  ) : person.sponsor ? (
    nickname(channel, person.sponsor)
  ) : null
  const when = <span title={t("modals.profile.messages", { count: person.messages })}>{since(person.joined)}</span>
  const joined = by ? tr("modals.profile.joined.by", { when, who: by }) : when
  const runs = [person.runs, person.model].filter(Boolean).join(" · ")
  const computer = person.machine ?? person.specs
  const handle = (
    <span key="handle" className="person-handle" data-handle>
      <code>{person.name}</code>
      {person.seatOf && <span className="dimmer">{t("modals.profile.seat.of", { name: person.seatOf })}</span>}
      <button
        type="button"
        className="icon-btn"
        aria-label={t("modals.profile.copy.handle")}
        title={t("modals.profile.copy.handle")}
        onClick={() => copyText(person.name, t("modals.profile.handle.copied"))}
      >
        <Icon name="copy" />
      </button>
    </span>
  )
  const rows: [string, ReactNode][] =
    person.kind === "agent"
      ? [
          ...(shown(person) !== person.name ? [[t("modals.profile.handle"), handle] satisfies [string, ReactNode]] : []),
          ...(runs ? [[t("modals.profile.runs"), runs] satisfies [string, ReactNode]] : []),
          ...(computer
            ? [
                [
                  t("modals.profile.computer"),
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
                  t("modals.profile.repo"),
                  <span key="repo" className="person-stack">
                    <code>
                      {person.repo}
                      {person.branch && <span className="dimmer">@{person.branch}</span>}
                    </code>
                    {person.outside && <span className="tone-decide">{t("modals.profile.repo.outside")}</span>}
                  </span>,
                ] satisfies [string, ReactNode],
              ]
            : []),
          ...(person.tools?.length ? [[t("modals.profile.tools"), person.tools.join(", ")] satisfies [string, ReactNode]] : []),
          ...(!editable && persona ? [[t("modals.profile.personality"), persona.label] satisfies [string, ReactNode]] : []),
          [t("modals.profile.joined"), joined],
        ]
      : [
          ...(devices.length
            ? [[t("modals.profile.devices"), devices.map((d) => t("modals.profile.device", { name: d.name, presence: t(PRESENCE[d.presence]) })).join(", ")] satisfies [string, ReactNode]]
            : []),
          [t("modals.profile.joined"), joined],
        ]
  return (
    <Group title={t("modals.profile.details")}>
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
  const owns = channel.youOwn
  const edits = owns || (!!channel.youManageAgents && agent)
  const trust = !person.readOnly && trusted({ addsAgents: !!person.addsAgents, answersDecisions: !!person.answersDecisions, managesAgents: !!person.managesAgents })
  const remove = () => {
    app.actions.removeMember(channel.code, person.name)
    setConfirm(false)
    go({ to: "modal", modal: null })
    toast(t("modals.profile.removed", { name: shown(person) }))
  }
  return (
    <>
      {edits && (
        <Group title={agent ? t("modals.profile.agent.settings") : t("modals.profile.settings")}>
          {agent && (
            <Row label={t("modals.profile.nickname")} hint={t("modals.profile.nickname.hint")}>
              <InlineEdit
                value={person.display ?? ""}
                label={t("modals.profile.nickname")}
                verb={person.display ? t("modals.profile.change") : t("modals.profile.set")}
                onSave={(v) => app.actions.setNickname(channel.code, person.name, v || null)}
              />
            </Row>
          )}
          <Row label={t("modals.profile.role")}>
            <Track className="seg" role="group" aria-label={t("modals.profile.role")}>
              <button type="button" aria-pressed={!person.role} onClick={() => app.actions.setRole(channel.code, person.name, null)}>
                {t("modals.profile.none")}
              </button>
              {roles.map((r) => (
                <button key={r} type="button" aria-pressed={person.role === r} onClick={() => app.actions.setRole(channel.code, person.name, r)}>
                  {r === "lead" ? t("modals.profile.role.lead") : r.slice(0, 1).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </Track>
          </Row>
          {agent && (
            <Row label={t("modals.profile.personality")} hint={persona?.about}>
              <span className="person-select">
                <select
                  className="input"
                  aria-label={t("modals.profile.personality")}
                  value={persona?.id ?? ""}
                  onChange={(e) => app.actions.setPersona(channel.code, person.name, e.target.value || null)}
                >
                  <option value="">{t("modals.profile.none")}</option>
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
            <Row label={t("modals.profile.colour")} hint={t("modals.profile.colour.hint")} wide>
              <Swatches color={person.color} onPick={(c) => app.actions.setAgentColor(channel.code, person.name, c)} />
            </Row>
          )}
        </Group>
      )}
      {owns && (
        <Group title={t("modals.profile.powers")}>
          {!agent && (
            <Row label={t("modals.profile.full.trust")} hint={t("modals.profile.full.trust.hint")}>
              <Toggle
                label={t("modals.profile.full.trust")}
                on={trust}
                onChange={(on) => {
                  if (on && person.readOnly) app.actions.setReadOnly(channel.code, person.name, false)
                  app.actions.setPowers(channel.code, person.name, on ? ALL_POWERS : NO_POWERS)
                }}
              />
            </Row>
          )}
          <Row label={t("modals.profile.read.only")} hint={agent ? t("modals.profile.read.only.agent") : t("modals.profile.read.only.person")}>
            <Toggle label={t("modals.profile.read.only")} on={!!person.readOnly} onChange={(on) => app.actions.setReadOnly(channel.code, person.name, on)} />
          </Row>
          {agent && person.wakes !== undefined && (
            <Row label={t("modals.profile.wake")} hint={person.wakes ? t("modals.profile.wake.on") : t("modals.profile.wake.off")}>
              <Toggle label={t("modals.profile.wake")} on={person.wakes === true} onChange={(on) => app.actions.setWake(channel.code, person.name, on)} />
            </Row>
          )}
          {!agent && (
            <>
              <Row label={t("modals.profile.adds.agents")} hint={person.addsAgents ? t("modals.profile.adds.agents.on") : t("modals.profile.adds.agents.off")}>
                <Toggle label={t("modals.profile.adds.agents")} on={!!person.addsAgents} onChange={(on) => app.actions.setPowers(channel.code, person.name, { addsAgents: on })} />
              </Row>
              <Row label={t("modals.profile.answers.decisions")} hint={t("modals.profile.answers.decisions.hint")}>
                <Toggle label={t("modals.profile.answers.decisions")} on={!!person.answersDecisions} onChange={(on) => app.actions.setPowers(channel.code, person.name, { answersDecisions: on })} />
              </Row>
              <Row label={t("modals.profile.manages.agents")} hint={t("modals.profile.manages.agents.hint")}>
                <Toggle label={t("modals.profile.manages.agents")} on={!!person.managesAgents} onChange={(on) => app.actions.setPowers(channel.code, person.name, { managesAgents: on })} />
              </Row>
            </>
          )}
        </Group>
      )}
      {(owns || person.yours) && (
        <div className="modal-end">
          <button type="button" className="btn is-quiet is-small" onClick={() => setConfirm(true)}>
            {t("modals.profile.remove.more")}
          </button>
        </div>
      )}
      <Modal
        dismiss="outside"
        open={confirm}
        onClose={() => setConfirm(false)}
        label={t("modals.profile.remove.label", { name: shown(person) })}
        title={t("modals.profile.remove.title", { name: shown(person) })}
        sub={agent ? t("modals.profile.remove.sub.agent") : t("modals.profile.remove.sub.person")}
        foot={
          <>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              {t("modals.profile.cancel")}
            </button>
            <button type="button" className="btn is-danger" onClick={remove}>
              {t("modals.profile.remove")}
            </button>
          </>
        }
      />
    </>
  )
}
