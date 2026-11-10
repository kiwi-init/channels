import "~/i18n/en/modals"
import { useEffect, useId, useState } from "react"

import { t } from "~/i18n/i18n"
import { wantPersona } from "~/live/persona-later"
import { Icon } from "~/kit/icons"
import type { Channel } from "~/model"
import { useApp } from "~/nav"
import { Modal } from "~/kit/modal"
import { CopyBox } from "~/modals/invite"

type Taken = Map<string, "in" | "asking">

const NAMES = ["nova", "ember", "quill", "otto", "juno"]

function takenNames(channel: Channel): Taken {
  const taken: Taken = new Map()
  for (const a of channel.asks) if (a.kind === "join" && !a.answer) taken.set(a.name.toLowerCase(), "asking")
  for (const p of channel.people) taken.set(p.name.toLowerCase(), "in")
  return taken
}

function freeName(taken: Taken): string {
  const pick = NAMES.find((n) => !taken.has(n))
  if (pick) return pick
  let n = 2
  while (taken.has(`agent-${n}`)) n++
  return `agent-${n}`
}

function nameProblem(name: string, taken: Taken): string | null {
  if (!name) return t("modals.add.agent.name.empty")
  if (name.length > 32) return t("modals.add.agent.name.too.long")
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return t("modals.add.agent.name.chars")
  const why = taken.get(name.toLowerCase())
  if (why === "in") return t("modals.add.agent.name.in", { name })
  if (why === "asking") return t("modals.add.agent.name.asking", { name })
  return null
}

export function AddAgent({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const taken = takenNames(channel)
  const [name, setName] = useState(() => freeName(taken))
  return (
    <Modal stays onClose={onClose} label={t("modals.add.agent.title")} title={t("modals.add.agent.title")} sub={t("modals.add.agent.sub")} className="add-body">
      <RunCommand channel={channel} name={name} setName={setName} taken={taken} />
    </Modal>
  )
}

interface NameProps {
  channel: Channel
  name: string
  setName: (name: string) => void
  taken: Taken
}

function NameField({ name, setName, problem }: { name: string; setName: (name: string) => void; problem: string | null }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-name`}>
        {t("modals.add.agent.name")}
      </label>
      <input
        id={`${id}-name`}
        className="input is-mono"
        value={name}
        maxLength={64}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!!problem}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(e) => setName(e.target.value)}
      />
      {problem && (
        <span id={`${id}-problem`} className="field-hint tone-alert">
          {problem}
        </span>
      )}
    </div>
  )
}

function PersonaPick({ value, onPick, none }: { value: string; onPick: (id: string) => void; none?: string }) {
  const { app } = useApp()
  const id = useId()
  const about = app.personas.find((p) => p.id === value)?.about ?? none
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {t("modals.add.agent.personality")}
      </label>
      <span className="add-select">
        <select id={id} className="input" value={value} onChange={(e) => onPick(e.target.value)}>
          <option value="">{t("modals.add.agent.personality.none")}</option>
          {app.personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <Icon name="down" size={14} />
      </span>
      {about && <span className="field-hint">{about}</span>}
    </div>
  )
}

function useJoinCommand(code: string, nick: string, persona: string): { line: string | null; failed: boolean; retry: () => void } {
  const { app } = useApp()
  const key = JSON.stringify([code, nick, persona])
  const [got, setGot] = useState<{ key: string; line: string } | { key: string; failed: true } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    const as = { ...(nick ? { nick } : {}), ...(persona ? { persona } : {}) }
    app.actions
      .joinCommand(code, as)
      .then((line) => live && setGot({ key: JSON.stringify([code, nick, persona]), line }))
      .catch(() => live && setGot({ key: JSON.stringify([code, nick, persona]), failed: true }))
    return () => {
      live = false
    }
  }, [app.actions, code, nick, persona, attempt])
  const mine = got?.key === key ? got : null
  return {
    line: mine && "line" in mine ? mine.line : null,
    failed: !!mine && "failed" in mine,
    retry: () => {
      setGot(null)
      setAttempt((n) => n + 1)
    },
  }
}

function RunCommand({ channel, name, setName, taken }: NameProps) {
  const [persona, setPersona] = useState("")
  const problem = nameProblem(name, taken)
  const { line, failed, retry } = useJoinCommand(channel.code, name, channel.youOwn ? persona : "")
  useEffect(() => {
    if (!channel.youOwn) wantPersona(channel.code, name, persona)
  }, [channel.code, channel.youOwn, name, persona])
  return (
    <>
      <NameField name={name} setName={setName} problem={problem} />
      {channel.youOwn || channel.youManageAgents ? (
        <PersonaPick value={persona} onPick={setPersona} none={channel.youOwn ? t("modals.add.agent.personality.later.owner") : t("modals.add.agent.personality.later.profile")} />
      ) : (
        <p className="add-note">{t("modals.add.agent.personality.owner.picks")}</p>
      )}
      <div className="field">
        <span className="field-label">{t("modals.add.agent.command")}</span>
        {failed ? (
          <div className="invite-failed">
            <span>{t("modals.add.agent.command.failed")}</span>
            <button type="button" className="btn is-small" onClick={retry}>
              {t("modals.add.agent.try.again")}
            </button>
          </div>
        ) : (
          <CopyBox text={line} label={t("modals.add.agent.copy.command")} disabled={!!problem} wrap />
        )}
      </div>
    </>
  )
}

export function AddAgentCard({ channel }: { channel: Channel }) {
  const [name] = useState(() => freeName(takenNames(channel)))
  const { line, failed, retry } = useJoinCommand(channel.code, name, "")
  return (
    <section className="add-card" aria-label={t("modals.add.agent.title")}>
      <p className="add-card-title">{t("modals.add.agent.title")}</p>
      <p className="dim">{t("modals.add.agent.card.hint")}</p>
      {failed ? (
        <div className="invite-failed">
          <span>{t("modals.add.agent.command.failed")}</span>
          <button type="button" className="btn is-small" onClick={retry}>
            {t("modals.add.agent.try.again")}
          </button>
        </div>
      ) : (
        <CopyBox text={line} label={t("modals.add.agent.copy.command")} wrap />
      )}
    </section>
  )
}
