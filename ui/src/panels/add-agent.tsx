import { useEffect, useId, useRef, useState, type ReactNode } from "react"

import { HARNESS_INSTALL, isKnownHarness } from "@kiwi/core/harnesses.ts"

import { wantPersona } from "~/live/persona-later"
import { Avatar, cx } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { ago, useNow } from "~/kit/time"
import type { App, Channel, Computer, ComputerChoices, Harness, NewAgent, Person } from "~/model"
import { useApp } from "~/nav"
import { shown } from "~/names"
import { PanelHead } from "~/panels/frame"
import { CopyBox } from "~/panels/invite"
import { joinedAs, seen, stallOf, starting, stepOf, type Launch, type Stall } from "~/panels/launch-progress"

type Way = "here" | "command"
type Mode = NonNullable<NewAgent["mode"]>
type Taken = Map<string, "in" | "asking">

interface Run {
  agent: NewAgent
  on: string
  runs: string
  launch: Launch
}

const NAMES = ["nova", "ember", "quill", "otto", "juno"]

const PRESET = new URLSearchParams(location.search).get("shot")

const SHOT_FAILED =
  "Claude Code stopped as it started (exit 1):\nshell-init: error retrieving current directory: getcwd: cannot access parent directories: No such file or directory\nThe current directory no longer exists (it was deleted or moved). Start Claude Code from an existing directory."

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

function firstChoices(app: App) {
  const computer = computersOf(app).find((c) => c.thisOne && c.online) ?? computersOf(app).find((c) => c.online)
  const harness = app.harnesses.find((h) => h.installed)
  return { computer, harness }
}

function presetRun(app: App, name: string, people: Person[]): Run | null {
  if (PRESET !== "add-agent-starting" && PRESET !== "add-agent-failed") return null
  const { computer, harness } = firstChoices(app)
  if (!computer || !harness) return null
  const now = Date.now()
  const begun = starting(name, people, now)
  const launch = PRESET === "add-agent-failed" ? seen(begun, { stage: "failed", why: SHOT_FAILED }, now) : seen(seen(begun, { stage: "started" }, now), { stage: "asked", name }, now)
  return { agent: { harness: harness.id, computer: computer.id, folder: "~/www/channels", name, mode: "ask-first" }, on: computer.label, runs: harness.label, launch }
}

export function AddAgentPanel({ channel }: { channel: Channel }) {
  const { app, go } = useApp()
  const taken = takenNames(channel)
  const [name, setName] = useState(() => freeName(taken))
  const [way, setWay] = useState<Way>(PRESET === "add-agent" ? "here" : "command")
  const [run, setRun] = useState<Run | null>(() => presetRun(app, name, channel.people))
  const following = useRef<(() => void) | null>(null)

  useEffect(() => () => following.current?.(), [])

  const start = (agent: NewAgent, on: string, runs: string) => {
    following.current?.()
    setRun({ agent, on, runs, launch: starting(agent.name, channel.people, Date.now()) })
    following.current = app.actions.addAgent(channel.code, agent, (s) => setRun((r) => r && { ...r, launch: seen(r.launch, s, Date.now()) }))
  }

  if (run)
    return (
      <>
        <PanelHead title="Add agent" />
        <Progress
          channel={channel}
          run={run}
          onDone={() => go({ to: "panel", panel: null })}
          onMessage={(handle) => {
            go({ to: "where", where: { kind: "dm", with: handle } })
            go({ to: "panel", panel: null })
          }}
          onRetry={() => start(run.agent, run.on, run.runs)}
          onBack={() => {
            following.current?.()
            following.current = null
            setRun(null)
          }}
        />
      </>
    )

  return (
    <>
      <PanelHead title="Add agent" />
      <p className="add-lede">Agents join a channel the way people join a chat. They stay yours: each one keeps running where it runs, and Channels never takes it over.</p>
      <div className="add-way">
        <Track className="seg" role="group" aria-label="How to add it">
          <button type="button" aria-pressed={way === "command"} onClick={() => setWay("command")}>
            Invite one you run
          </button>
          <button type="button" aria-pressed={way === "here"} onClick={() => setWay("here")}>
            Start one here
          </button>
        </Track>
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
  const { app } = useApp()
  const id = useId()
  const computers = computersOf(app)
  const [first] = useState(() => firstChoices(app))
  const [computerId, setComputerId] = useState(first.computer?.id ?? "")
  const [harnessId, setHarnessId] = useState<Harness | "">(first.harness?.id ?? "")
  const [folder, setFolder] = useState("")
  const [typed, setTyped] = useState(false)
  const [loaded, setLoaded] = useState<{ for: string; choices: ComputerChoices } | null>(null)
  useEffect(() => {
    if (!computerId) return
    let live = true
    const load = () =>
      void app.actions.choicesOn(channel.code, computerId).then((c) => {
        if (!live) return
        setLoaded({ for: computerId, choices: c })
        if (!typed && "folders" in c) setFolder(c.folders[0] ?? "")
        const there = "harnesses" in c ? c.harnesses : undefined
        if (there) setHarnessId((now) => (there.some((h) => h.id === now && h.installed) ? now : (there.find((h) => h.installed)?.id ?? "")))
      })
    load()
    window.addEventListener("focus", load)
    return () => {
      live = false
      window.removeEventListener("focus", load)
    }
  }, [app.actions, channel.code, computerId, typed])
  const choices = loaded?.for === computerId ? loaded.choices : null
  const harnesses = choices && "harnesses" in choices && choices.harnesses ? choices.harnesses : app.harnesses
  const found = harnesses.filter((h) => h.installed)
  const missing = harnesses.filter((h) => !h.installed)
  const folders = choices && "folders" in choices ? choices.folders : []
  const unreachable = choices && "error" in choices ? choices.error : null
  const [persona, setPersona] = useState("")
  const [mode, setMode] = useState<Mode>("ask-first")
  const [understood, setUnderstood] = useState(false)

  const computer = computers.find((c) => c.id === computerId && c.online)
  const harness = harnesses.find((h) => h.id === harnessId && h.installed)
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
        <p className="add-how">Channels opens a new agent on one of your computers, in a terminal you can open from here. Once it's in, it's an agent like any other.</p>
        <Group label="Computer">
          {computers.length === 0 && <p className="add-none">No computer of yours is linked. Invite one you run instead.</p>}
          {computers.map((c) => (
            <Choice
              key={c.id}
              group={`${id}-computer`}
              on={c.id === computerId}
              off={!c.online}
              pick={() => {
                if (c.id === computerId) return
                setComputerId(c.id)
                setTyped(false)
              }}
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

        <Group label={`Agents found on ${where}`}>
          {found.length === 0 && <p className="add-none">No agent found on {where} yet. Install one below, then come back here.</p>}
          {found.map((h) => (
            <Choice key={h.id} group={`${id}-harness`} on={h.id === harnessId} pick={() => setHarnessId(h.id)} side={h.version}>
              <Avatar person={{ name: h.label, kind: "agent", harness: h.id, presence: "online" }} size="sm" />
              <span className="add-choice-label">{h.label}</span>
            </Choice>
          ))}
        </Group>

        {missing.length > 0 && (
          <div className="add-group">
            <span className="field-label">To get the others, run on {where}</span>
            <ul className="add-gets">
              {missing.map((h) => (
                <Missing key={h.id} harness={h} />
              ))}
            </ul>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor={`${id}-folder`}>
            Folder
          </label>
          <div className="add-folder">
            <input
              id={`${id}-folder`}
              className="input is-mono"
              value={folder}
              list={`${id}-folders`}
              placeholder={computer?.thisOne ? "Choose a folder" : "A folder on that computer"}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setTyped(true)
                setFolder(e.target.value)
              }}
            />
            <datalist id={`${id}-folders`}>
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            {computer?.thisOne && (
              <button
                type="button"
                className="btn is-quiet"
                onClick={() =>
                  void app.actions.chooseFolder().then((f) => {
                    if (!f) return
                    setTyped(true)
                    setFolder(f)
                  })
                }
              >
                Choose…
              </button>
            )}
          </div>
          {unreachable && computer && (
            <p className="add-none">
              Couldn't ask {computer.label} for its harnesses and folders: {unreachable}
            </p>
          )}
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
          <Track className="seg add-seg" role="group" aria-labelledby={`${id}-mode`}>
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
          </Track>
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

function Missing({ harness: h }: { harness: App["harnesses"][number] }) {
  const line = isKnownHarness(h.id) ? HARNESS_INSTALL[h.id] : undefined
  return (
    <li className="add-get">
      <span className="add-get-who">
        <Avatar person={{ name: h.label, kind: "agent", harness: h.id, presence: "offline" }} size="sm" />
        <span className="add-choice-label">{h.label}</span>
        {h.path && <span className="add-choice-side">{h.why ?? "can't start yet"}</span>}
      </span>
      {!h.path && line && <CopyBox text={line} label={`Copy the ${h.label} install command`} />}
    </li>
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
  useEffect(() => {
    if (!channel.youOwn) wantPersona(channel.code, name, persona)
  }, [channel.code, channel.youOwn, name, persona])
  return (
    <div className="panel-body add-body">
      <p className="add-how">Already running Claude Code, Codex or another agent? Give it this line. It asks to join, and it keeps working where it is.</p>
      <NameField name={name} setName={setName} problem={problem} />
      {channel.youOwn || channel.youManageAgents ? (
        <Group label="Personality">
          <Choice group={`${id}-persona`} on={persona === ""} pick={() => setPersona("")}>
            <span className="add-choice-text">
              <span className="add-choice-label">None</span>
              <span className="add-choice-about">
                {channel.youOwn ? "The harness as it comes. You can still pick one when you let it in." : "The harness as it comes. You can still pick one from its profile."}
              </span>
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
          <CopyBox text={line} label="Copy command" disabled={!!problem} wrap />
        )}
      </div>
      <p className="add-note">
        Run it in the folder the agent should work in. If kiwi isn't on that computer yet, the line installs it first, from the same site, as a signed release. It asks to join
        {persona && channel.youOwn ? ` as ${app.personas.find((p) => p.id === persona)?.label ?? "that personality"}` : ""}; you'll check its code in Needs you.
      </p>
    </div>
  )
}

export function AddAgentCard({ channel }: { channel: Channel }) {
  const { go } = useApp()
  const [name] = useState(() => freeName(takenNames(channel)))
  const { line, failed, retry } = useJoinCommand(channel.code, name, "")
  return (
    <section className="add-card" aria-label="Add an agent">
      <p className="add-card-title">Add an agent</p>
      <p className="dim">
        Invite an agent you already run: give it this line, and it asks to join, installing kiwi there first if it's missing. You check its code in Needs you. Or have Channels start one on a computer
        of yours.
      </p>
      {failed ? (
        <div className="invite-failed">
          <span>Couldn't make the command.</span>
          <button type="button" className="btn is-small" onClick={retry}>
            Try again
          </button>
        </div>
      ) : (
        <CopyBox text={line} label="Copy command" wrap />
      )}
      <div className="add-card-foot">
        <button type="button" className="btn is-primary" onClick={() => go({ to: "panel", panel: { kind: "add-agent" } })}>
          Start one here
        </button>
      </div>
    </section>
  )
}

interface ProgressProps {
  channel: Channel
  run: Run
  onDone: () => void
  onMessage: (handle: string) => void
  onRetry: () => void
  onBack: () => void
}

function stallText(stall: Stall, n: string, on: string, owner: string): string {
  if (stall === "slow-start") return `${on} hasn't said whether ${n} started. It may be asleep or offline.`
  if (stall === "not-asking") return `${n} is running on ${on} but hasn't asked to join. Its window may be waiting on a question: a sign-in, a folder to trust or a permission.`
  if (stall === "not-let-in") return `${n} asked to join, but Kiwi didn't let it in on its own. Let it in from Needs you.`
  return `${owner} hasn't let ${n} in yet. If they don't see it in their Needs you, ${n} may be waiting on a question in its window on ${on}.`
}

function Progress({ channel, run, onDone, onMessage, onRetry, onBack }: ProgressProps) {
  const { app, go } = useApp()
  const { agent, on, runs, launch } = run
  const n = agent.name
  const handle = joinedAs(launch, channel.people)
  const member = handle ? channel.people.find((p) => p.name === handle) : undefined
  const done = !!handle
  const failed = launch.stage === "failed"
  const now = useNow(done || failed ? null : 1_000)
  const step = stepOf(launch, channel.youOwn, done)
  const stall = stallOf(launch, channel.youOwn, done, now)
  const found = channel.people.find((p) => p.owner && !p.you)
  const owner = found ? shown(found) : "the owner"
  const name = member ? shown(member) : n
  const rows = [
    { now: `Starting ${n} on ${on}`, done: `Started ${n} on ${on}`, failed: `Couldn't start ${n} on ${on}` },
    ...(channel.youOwn ? [{ now: `${n} is asking to join`, done: `${n} asked to join`, failed: "" }] : []),
    { now: channel.youOwn ? `Letting ${n} in` : `Waiting for ${owner} to let ${n} in`, done: `${name} is in`, failed: "" },
  ]
  const [why = "", ...said] = (launch.why ?? "").split("\n")
  const persona = app.personas.find((p) => p.id === agent.persona)?.label
  return (
    <>
      <div className="panel-body add-body">
        <div className="add-who">
          <Avatar person={{ name: n, kind: "agent", harness: agent.harness, presence: done ? "online" : "offline" }} size="lg" pip />
          <div className="add-who-text">
            <p className="add-who-name">{name}</p>
            <p className="add-who-meta">{[runs, persona, agent.folder].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <ol className="add-steps" aria-live="polite">
          {rows.map((row, i) => {
            const state = failed && i === step ? "is-failed" : i < step ? "is-done" : i === step ? "is-now" : "is-next"
            return (
              <li key={row.now} className={cx("add-step", state)}>
                <span className="add-step-mark" aria-hidden="true">
                  {state === "is-done" && <Icon name="check" size={12} />}
                  {state === "is-failed" && <Icon name="close" size={12} />}
                </span>
                <span>{state === "is-failed" ? row.failed : state === "is-now" ? `${row.now}…` : row.done}</span>
              </li>
            )
          })}
        </ol>
        {failed ? (
          <div className="add-failed" role="alert">
            <p>{why}</p>
            {said.length > 0 && <pre className="add-said">{said.join("\n")}</pre>}
          </div>
        ) : stall ? (
          <div className="add-stall" role="status">
            <p>{stallText(stall, n, on, owner)}</p>
            {stall === "not-let-in" && (
              <button type="button" className="btn is-small" onClick={() => go({ to: "tab", tab: "needs" })}>
                Open Needs you
              </button>
            )}
          </div>
        ) : (
          !done && <p className="add-note">You can close this. {n} shows up under Agents once it's in.</p>
        )}
      </div>
      {failed && (
        <footer className="add-foot">
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
          <button type="button" className="btn is-primary" onClick={onRetry}>
            Try again
          </button>
        </footer>
      )}
      {handle && (
        <footer className="add-foot">
          <button type="button" className="btn" onClick={onDone}>
            Done
          </button>
          <button type="button" className="btn is-primary" onClick={() => onMessage(handle)}>
            Message {name}
          </button>
        </footer>
      )}
    </>
  )
}
