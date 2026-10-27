import { useEffect, useId, useRef, useState, type ReactNode } from "react"

import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { App, Channel, Computer, Harness, NewAgent } from "~/model"
import { useApp } from "~/nav"
import { PanelHead } from "~/panels/frame"
import { CopyBox } from "~/panels/invite"

type Way = "here" | "command"
type Mode = NonNullable<NewAgent["mode"]>
type Step = 0 | 1 | 2
type Taken = Map<string, "in" | "asking">

interface Run {
  agent: NewAgent
  on: string
  runs: string
  step: Step
}

const NAMES = ["nova", "ember", "quill", "otto", "juno"]

const PRESET = new URLSearchParams(location.search).get("shot")

const DEMO_STEPS = new Map<Step, number>([
  [1, 800],
  [2, 1600],
])

const MODES: { id: Mode; label: string }[] = [
  { id: "ask-first", label: "Ask first" },
  { id: "accept-edits", label: "Accept edits" },
  { id: "dont-ask", label: "Don't ask" },
]

const isPhone = (c: Computer): boolean => c.os === "iphone" || c.os === "android"

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
  if (!name) return "Give it a name."
  if (name.length > 32) return "32 characters at most."
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return "Letters, numbers, dots, dashes and underscores only."
  const why = taken.get(name.toLowerCase())
  if (why === "in") return `${name} is already in this channel.`
  if (why === "asking") return `${name} is already asking to join.`
  return null
}

function computersOf(app: App): Computer[] {
  return (app.account?.computers ?? []).filter((c) => !isPhone(c))
}

function firstChoices(app: App, channel: Channel) {
  const computer = computersOf(app).find((c) => c.thisOne && c.online) ?? computersOf(app).find((c) => c.online)
  const harness = app.harnesses.find((h) => h.installed)
  return { computer, harness, folder: `~/www/${channel.title.trim().replace(/\s+/g, "-")}` }
}

function presetRun(app: App, channel: Channel, name: string): Run | null {
  if (PRESET !== "add-agent-starting") return null
  const { computer, harness, folder } = firstChoices(app, channel)
  if (!computer || !harness) return null
  return { agent: { harness: harness.id, computer: computer.id, folder, name, mode: "ask-first" }, on: computer.label, runs: harness.label, step: 2 }
}

export function AddAgentPanel({ channel }: { channel: Channel }) {
  const { app, go } = useApp()
  const taken = takenNames(channel)
  const [name, setName] = useState(() => freeName(taken))
  const [way, setWay] = useState<Way>(PRESET === "add-agent-command" ? "command" : "here")
  const [run, setRun] = useState<Run | null>(() => presetRun(app, channel, name))
  const timers = useRef<number[]>([])

  useEffect(() => {
    const list = timers.current
    return () => list.forEach((t) => window.clearTimeout(t))
  }, [])

  const start = (agent: NewAgent, on: string, runs: string) => {
    app.actions.addAgent(channel.code, agent)
    setRun({ agent, on, runs, step: 0 })
    for (const [step, ms] of DEMO_STEPS) timers.current.push(window.setTimeout(() => setRun((r) => r && { ...r, step }), ms))
  }

  if (run)
    return (
      <>
        <PanelHead title="Add agent" />
        <Progress
          channel={channel}
          run={run}
          onDone={() => go({ to: "panel", panel: null })}
          onMessage={() => {
            go({ to: "where", where: { kind: "dm", with: run.agent.name } })
            go({ to: "panel", panel: null })
          }}
        />
      </>
    )

  return (
    <>
      <PanelHead title="Add agent" />
      <div className="add-way">
        <div className="seg" role="group" aria-label="How to add it">
          <button type="button" aria-pressed={way === "here"} onClick={() => setWay("here")}>
            Start one here
          </button>
          <button type="button" aria-pressed={way === "command"} onClick={() => setWay("command")}>
            Run the command
          </button>
        </div>
      </div>
      {way === "here" ? <StartHere channel={channel} name={name} setName={setName} taken={taken} onStart={start} /> : <RunCommand channel={channel} name={name} setName={setName} taken={taken} />}
    </>
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
        Name
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

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="add-group">
      <legend className="field-label">{label}</legend>
      <div className="add-choices">{children}</div>
    </fieldset>
  )
}

function Choice({ group, on, off, pick, children, side }: { group: string; on: boolean; off?: boolean; pick: () => void; children: ReactNode; side?: ReactNode }) {
  return (
    <label className={cx("add-choice", on && "is-on", off && "is-off")}>
      <input type="radio" className="sr" name={group} checked={on} disabled={off} onChange={pick} />
      {children}
      {side && <span className="add-choice-side">{side}</span>}
      <span className="add-choice-tick">{on && <Icon name="check" size={14} />}</span>
    </label>
  )
}

function StartHere({ channel, name, setName, taken, onStart }: NameProps & { onStart: (agent: NewAgent, on: string, runs: string) => void }) {
  const { app, toast } = useApp()
  const id = useId()
  const computers = computersOf(app)
  const [first] = useState(() => firstChoices(app, channel))
  const [computerId, setComputerId] = useState(first.computer?.id ?? "")
  const [harnessId, setHarnessId] = useState<Harness | "">(first.harness?.id ?? "")
  const [folder, setFolder] = useState(first.folder)
  const [persona, setPersona] = useState("")
  const [mode, setMode] = useState<Mode>("ask-first")
  const [understood, setUnderstood] = useState(false)

  const computer = computers.find((c) => c.id === computerId && c.online)
  const harness = app.harnesses.find((h) => h.id === harnessId && h.installed)
  const problem = nameProblem(name, taken)
  const who = problem ? "It" : name
  const ready = !!computer && !!harness && !!folder.trim() && !problem && (mode !== "dont-ask" || understood)
  const where = computer ? (computer.thisOne ? "this computer" : computer.label) : "this computer"

  return (
    <form
      className="add-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready || !computer || !harness) return
        onStart({ harness: harness.id, computer: computer.id, folder: folder.trim(), name, persona: persona || undefined, mode }, computer.label, harness.label)
      }}
    >
      <div className="panel-body add-body">
        <Group label="Computer">
          {computers.length === 0 && <p className="add-none">No computer of yours is linked. Use Run the command instead.</p>}
          {computers.map((c) => (
            <Choice
              key={c.id}
              group={`${id}-computer`}
              on={c.id === computerId}
              off={!c.online}
              pick={() => setComputerId(c.id)}
              side={
                <>
                  <span className={cx("add-pip", c.online && "is-online")} />
                  {c.online ? "online" : `offline · ${ago(c.lastSeen)}`}
                </>
              }
            >
              <Icon name="computer" />
              <span className="add-choice-label">
                {c.label}
                {c.thisOne && <span className="add-choice-tag"> this computer</span>}
              </span>
            </Choice>
          ))}
        </Group>

        <Group label="Harness">
          {app.harnesses.map((h) => (
            <Choice key={h.id} group={`${id}-harness`} on={h.id === harnessId} off={!h.installed} pick={() => setHarnessId(h.id)}>
              <Avatar person={{ name: h.label, kind: "agent", harness: h.id, presence: h.installed ? "online" : "offline" }} size="sm" />
              {h.installed ? (
                <span className="add-choice-label">{h.label}</span>
              ) : (
                <span className="add-choice-text">
                  <span className="add-choice-label">{h.label}</span>
                  <span className="add-choice-about">Not installed on {where}</span>
                </span>
              )}
            </Choice>
          ))}
        </Group>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-folder`}>
            Folder
          </label>
          <div className="add-folder">
            <input id={`${id}-folder`} className="input is-mono" value={folder} spellCheck={false} autoComplete="off" onChange={(e) => setFolder(e.target.value)} />
            <button type="button" className="btn is-quiet" onClick={() => toast("The folder picker opens in the desktop app")}>
              Choose…
            </button>
          </div>
        </div>

        <NameField name={name} setName={setName} problem={problem} />

        <Group label="Personality">
          <Choice group={`${id}-persona`} on={persona === ""} pick={() => setPersona("")}>
            <span className="add-choice-text">
              <span className="add-choice-label">None</span>
              <span className="add-choice-about">The harness as it comes, with no extra instructions.</span>
            </span>
          </Choice>
          {app.personas.map((p) => (
            <Choice key={p.id} group={`${id}-persona`} on={persona === p.id} pick={() => setPersona(p.id)}>
              <span className="add-choice-text">
                <span className="add-choice-label">{p.label}</span>
                <span className="add-choice-about">{p.about}</span>
              </span>
            </Choice>
          ))}
        </Group>

        <div className="field">
          <span className="field-label" id={`${id}-mode`}>
            Permission mode
          </span>
          <div className="seg add-seg" role="group" aria-labelledby={`${id}-mode`}>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                onClick={() => {
                  setMode(m.id)
                  setUnderstood(false)
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === "dont-ask" ? (
            <div className="add-warn">
              <p>
                {who} runs any command on {where} without asking you first.
              </p>
              <label className="add-check">
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />I understand it runs commands without asking
              </label>
            </div>
          ) : (
            <span className="field-hint">{mode === "ask-first" ? `${who} asks you before it edits files or runs commands.` : `${who} edits files on its own and asks before it runs commands.`}</span>
          )}
        </div>
      </div>
      <footer className="add-foot">
        <button type="submit" className="btn is-primary" disabled={!ready}>
          Start {problem ? "agent" : name}
        </button>
      </footer>
    </form>
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
  const { app } = useApp()
  const id = useId()
  const [persona, setPersona] = useState("")
  const problem = nameProblem(name, taken)
  const { line, failed, retry } = useJoinCommand(channel.code, name, channel.youOwn ? persona : "")
  return (
    <div className="panel-body add-body">
      <NameField name={name} setName={setName} problem={problem} />
      {channel.youOwn ? (
        <Group label="Personality">
          <Choice group={`${id}-persona`} on={persona === ""} pick={() => setPersona("")}>
            <span className="add-choice-text">
              <span className="add-choice-label">None</span>
              <span className="add-choice-about">The harness as it comes. You can still pick one when you let it in.</span>
            </span>
          </Choice>
          {app.personas.map((p) => (
            <Choice key={p.id} group={`${id}-persona`} on={persona === p.id} pick={() => setPersona(p.id)}>
              <span className="add-choice-text">
                <span className="add-choice-label">{p.label}</span>
                <span className="add-choice-about">{p.about}</span>
              </span>
            </Choice>
          ))}
        </Group>
      ) : (
        <p className="add-note">The owner picks its personality when they let it in.</p>
      )}
      <div className="field">
        <span className="field-label">Command</span>
        {failed ? (
          <div className="invite-failed">
            <span>Couldn't make the command.</span>
            <button type="button" className="btn is-small" onClick={retry}>
              Try again
            </button>
          </div>
        ) : (
          <CopyBox text={line} label="Copy command" disabled={!!problem} />
        )}
      </div>
      <p className="add-note">
        Run it in the folder the agent should work in. It asks to join{persona && channel.youOwn ? ` as ${app.personas.find((p) => p.id === persona)?.label ?? "that personality"}` : ""}; you'll check
        its code in Needs you.
      </p>
    </div>
  )
}

function Progress({ channel, run, onDone, onMessage }: { channel: Channel; run: Run; onDone: () => void; onMessage: () => void }) {
  const { app } = useApp()
  const { agent, on, runs } = run
  const n = agent.name
  const done = channel.people.some((p) => p.name === n)
  const step = done ? 3 : run.step
  const owner = channel.people.find((p) => p.owner && !p.you)?.name ?? "the owner"
  const rows = [
    { now: `Starting ${n} on ${on}`, done: `Started ${n} on ${on}` },
    { now: `${n} is asking to join`, done: `${n} asked to join` },
    { now: channel.youOwn ? `Letting ${n} in` : `Waiting for ${owner} to let ${n} in`, done: `${n} is in` },
  ]
  const persona = app.personas.find((p) => p.id === agent.persona)?.label
  return (
    <>
      <div className="panel-body add-body">
        <div className="add-who">
          <Avatar person={{ name: n, kind: "agent", harness: agent.harness, presence: done ? "online" : "offline" }} size="lg" pip />
          <div className="add-who-text">
            <p className="add-who-name">{n}</p>
            <p className="add-who-meta">{[runs, persona, agent.folder].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <ol className="add-steps" aria-live="polite">
          {rows.map((row, i) => {
            const state = i < step ? "is-done" : i === step ? "is-now" : "is-next"
            return (
              <li key={row.done} className={cx("add-step", state)}>
                <span className="add-step-mark" aria-hidden="true">
                  {state === "is-done" && <Icon name="check" size={12} />}
                </span>
                <span>{state === "is-now" ? `${row.now}…` : row.done}</span>
              </li>
            )
          })}
        </ol>
        {!done && <p className="add-note">You can close this. {n} shows up under Agents once it's in.</p>}
      </div>
      {done && (
        <footer className="add-foot">
          <button type="button" className="btn" onClick={onDone}>
            Done
          </button>
          <button type="button" className="btn is-primary" onClick={onMessage}>
            Message {n}
          </button>
        </footer>
      )}
    </>
  )
}
