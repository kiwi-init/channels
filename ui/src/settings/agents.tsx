import { useState } from "react"

import { cx } from "~/kit/bits"
import { Toggle } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { LOGOS } from "~/kit/logos"
import { RoleFace } from "~/kit/role-face"
import type { Finding, Harness, ThisComputer } from "~/model"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { Personalities } from "~/settings/personalities"
import { Page } from "~/settings/sections"

type Hook = ThisComputer["hooks"][number]

const HOOK_SAYS: Record<Hook["state"], { state: string; action: string; tone?: string; why?: string }> = {
  installed: { state: "Hooks on", action: "Remove" },
  partial: { state: "Hooks out of date", action: "Update", tone: "tone-decide", why: "Its hooks can't wake the agent when a message comes." },
  outdated: { state: "Hooks out of date", action: "Update", tone: "tone-decide", why: "Its hooks are from an older kiwi." },
  missing: { state: "No hooks", action: "Add" },
  off: { state: "No hooks", action: "Add", why: "You removed them. Kiwi won't add them back until you add them." },
}

const HOOKS_DO = "Hooks bring new messages to agents here, and their permission prompts to Needs you."

function HookState({ hook }: { hook: Hook }) {
  const { app } = useApp()
  const says = HOOK_SAYS[hook.state]
  return (
    <>
      <span className={cx("set-harness-state", says.tone)} title={says.why}>
        {says.state}
      </span>
      <button
        type="button"
        className="btn is-quiet is-small"
        title={HOOKS_DO}
        aria-label={`${says.action} hooks for ${hook.label}`}
        onClick={() => app.actions.setHooks(hook.harness, hook.state !== "installed")}
      >
        {says.action}
      </button>
    </>
  )
}

function HarnessMark({ harness }: { harness: Harness }) {
  const logo = LOGOS[harness]
  if (!logo)
    return (
      <span className="set-harness-mark is-face" aria-hidden="true">
        <RoleFace harness={undefined} />
      </span>
    )
  return (
    <svg className="set-harness-mark" viewBox="0 0 24 24" data-harness={harness} aria-hidden="true">
      {logo.map((p, i) => (
        <path key={i} d={p.d} transform={p.transform} fillRule={p.rule} opacity={p.opacity} />
      ))}
    </svg>
  )
}

function HarnessRow({ harness, label, version, path, hook }: { harness: Harness; label: string; version?: string | undefined; path?: string | undefined; hook: Hook | undefined }) {
  return (
    <div className="set-row set-harness">
      <HarnessMark harness={harness} />
      <span className="set-row-text">
        <span className="set-row-label">
          {label}
          {version && <span className="set-harness-version">{version}</span>}
        </span>
        {path && (
          <span className="set-row-hint set-harness-path" title={path}>
            {path}
          </span>
        )}
      </span>
      {hook && (
        <span className="set-row-ctl">
          <HookState hook={hook} />
        </span>
      )}
    </div>
  )
}

function KiwiState({ computer }: { computer: ThisComputer | null }) {
  if (!computer) return null
  if (!computer.kiwi.running) return <span className="set-kiwi tone-decide">kiwi isn't running</span>
  return <span className="set-kiwi">{computer.kiwi.version ? `kiwi ${computer.kiwi.version} · running` : "kiwi · running"}</span>
}

function CheckComputer() {
  const { app } = useApp()
  const [state, setState] = useState<"idle" | "running" | "failed" | Finding[]>("idle")
  const run = () => {
    setState("running")
    app.actions.checkComputer().then(
      (f) => setState(f ?? "failed"),
      () => setState("failed")
    )
  }
  const problems = Array.isArray(state) ? state.filter((f) => !f.ok).length : 0
  return (
    <>
      <Row label="Check this computer" hint={Array.isArray(state) ? (problems ? `${problems} to fix` : "Nothing to fix") : "Install, relay, devices and hooks."}>
        <button type="button" className="btn is-small" disabled={state === "running"} onClick={run}>
          {state === "running" ? "Checking…" : Array.isArray(state) ? "Check again" : "Check"}
        </button>
      </Row>
      {Array.isArray(state) && (
        <ul className="set-findings">
          {state.map((f) => (
            <FindingRow key={f.what} f={f} />
          ))}
        </ul>
      )}
      {state === "failed" && (
        <p className="set-row-hint set-findings-none">
          kiwi doctor didn't answer. Run it in a terminal to see why: <code>kiwi doctor</code>
        </p>
      )}
    </>
  )
}

function FindingRow({ f }: { f: Finding }) {
  if (!f.ok)
    return (
      <li className="set-finding is-bad">
        <span className="set-finding-dot" aria-hidden="true" />
        <span className="set-finding-text">
          <span>{f.what}</span>
          <span className="set-row-hint">{f.how}</span>
        </span>
      </li>
    )
  const [, label, value] = /^(\S+)\s{2,}(.*)$/.exec(f.what) ?? [null, null, f.what]
  return (
    <li className="set-finding">
      <Icon name="check" size={14} />
      {label && <span className="set-finding-label">{label}</span>}
      <span className="set-finding-text">{value}</span>
    </li>
  )
}

export function AgentsSection() {
  const { app } = useApp()
  const { computer, actions } = app
  const hooks = computer?.hooks ?? []
  const loose = hooks.filter((k) => !app.harnesses.some((h) => h.id === k.harness))
  const here = app.harnesses.filter((h) => h.installed || hooks.some((k) => k.harness === h.id))
  const away = app.harnesses.filter((h) => !here.includes(h))
  return (
    <Page title="Agents">
      <Personalities />

      <Group title="Harnesses" aside={<KiwiState computer={computer} />}>
        {here.map((h) => (
          <HarnessRow key={h.id} harness={h.id} label={h.label} version={h.version} path={h.path} hook={hooks.find((k) => k.harness === h.id)} />
        ))}
        {loose.map((k) => (
          <HarnessRow key={k.harness} harness={k.harness} label={k.label} hook={k} />
        ))}
        {away.length > 0 && <p className="set-harness-away">Not installed: {away.map((h) => h.label).join(", ")}</p>}
      </Group>

      {computer && (
        <Group title="This computer">
          <CheckComputer />
          {computer.contextLine !== null && (
            <Row label="Ask agents for a checkpoint past 250k context" hint="An agent here past 250k tokens is asked to write where its work stands before it ends its turn.">
              <Toggle label="Ask agents for a checkpoint past 250k context" on={computer.contextLine} onChange={actions.setContextLine} />
            </Row>
          )}
        </Group>
      )}
    </Page>
  )
}
