import { useState } from "react"

import type { TerminalId, TerminalRow } from "@kiwi/core/terminals.ts"
import { Avatar, IconButton, Toggle } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { AgentStarts, Finding, ThisComputer } from "~/model"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { Personalities } from "~/settings/personalities"
import { Page } from "~/settings/sections"

type Hook = ThisComputer["hooks"][number]

const HOOK_SAYS: Record<Hook["state"], { desc: string; action: string }> = {
  installed: { desc: "", action: "Remove hooks" },
  partial: { desc: "Its hooks can't wake Claude Code when a message comes", action: "Update hooks" },
  outdated: { desc: "Its hooks are from an older kiwi", action: "Update hooks" },
  missing: { desc: "No hooks yet", action: "Install hooks" },
  off: { desc: "Hooks removed. Kiwi won't add them back until you install them", action: "Install hooks" },
}

const HOOKS_DO = "Hooks bring new messages to agents here, and their permission prompts to Needs you."

function HookButton({ hook }: { hook: Hook }) {
  const { app } = useApp()
  return (
    <button
      type="button"
      className="btn is-quiet is-small"
      title={HOOKS_DO}
      aria-label={`${HOOK_SAYS[hook.state].action} for ${hook.label}`}
      onClick={() => app.actions.setHooks(hook.harness, hook.state !== "installed")}
    >
      {HOOK_SAYS[hook.state].action}
    </button>
  )
}

const HELPERS: Record<TerminalId, { download: string; on: string; off: string }> = {
  rex: {
    download: "Download Rex Helpers",
    on: "A seat that needs you marks its Rex tab; Needs you opens it.",
    off: "Mark a seat that needs you in its Rex tab, and open it from Needs you.",
  },
  tmux: {
    download: "Download Tmux Helpers",
    on: "A seat that needs you marks its tmux window; prefix K jumps to it.",
    off: "Mark a seat that needs you in tmux's window list, and jump to it with prefix K.",
  },
}

const ORDER: TerminalId[] = ["rex", "tmux"]

function Helpers({ starts }: { starts: AgentStarts }) {
  const { app } = useApp()
  const rows = ORDER.flatMap((id) => starts.terminals.filter((t) => t.id === id))
  const helpers = rows.filter((t): t is TerminalRow & { helpers: "on" | "off" } => t.helpers !== null && (t.found || t.helpers === "on"))
  return (
    <>
      {helpers.map((t) => {
        const on = t.helpers === "on"
        const note =
          on && !t.found ? `${t.name} isn't on this computer anymore. Remove takes back what Kiwi wrote.` : on && !t.running ? `${t.name} isn't running. Kiwi picks it up once it starts.` : null
        return (
          <Row
            key={t.id}
            label={t.name}
            hint={
              <>
                {on ? HELPERS[t.id].on : HELPERS[t.id].off}
                {note && <span className="set-row-note">{note}</span>}
              </>
            }
          >
            <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setTerminalHelpers(t.id, !on)}>
              {on ? "Remove" : HELPERS[t.id].download}
            </button>
          </Row>
        )
      })}
    </>
  )
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
  const { starts, computer, actions } = app
  const hooks = computer?.hooks ?? []
  const loose = hooks.filter((k) => !app.harnesses.some((h) => h.id === k.harness))
  return (
    <Page title="Agents">
      <Personalities />

      <Group title="Harnesses" hint={computer ? (computer.kiwi.running && computer.kiwi.version ? `kiwi ${computer.kiwi.version} running` : "kiwi isn't running") : undefined}>
        {app.harnesses.map((h) => {
          const hook = hooks.find((k) => k.harness === h.id)
          return (
            <div key={h.id} className="set-row">
              <span className="set-row-text set-harness">
                <Avatar person={{ name: h.label, kind: "agent", harness: h.id, presence: h.installed ? "online" : "offline" }} size="sm" />
                <span className="set-harness-text">
                  <span className="set-row-label">
                    {h.label}
                    {h.version && <span className="set-harness-version"> {h.version}</span>}
                  </span>
                  {h.path && (
                    <span className="set-row-hint set-harness-path" title={h.path}>
                      {h.path}
                    </span>
                  )}
                  {h.why && <span className="set-row-hint">{h.why}</span>}
                  {hook && HOOK_SAYS[hook.state].desc && <span className="set-row-hint tone-decide">{HOOK_SAYS[hook.state].desc}</span>}
                </span>
              </span>
              {hook ? <HookButton hook={hook} /> : !h.installed && <span className="set-harness-state">Not installed</span>}
            </div>
          )
        })}
        {loose.map((k) => (
          <Row key={k.harness} label={`${k.label} hooks`} hint={HOOK_SAYS[k.state].desc || undefined}>
            <HookButton hook={k} />
          </Row>
        ))}
      </Group>

      {computer && (
        <Group>
          {computer.contextLine !== null && (
            <Row label="Ask agents for a checkpoint past 250k context" hint="An agent here past 250k tokens is asked to write where its work stands before it ends its turn.">
              <Toggle label="Ask agents for a checkpoint past 250k context" on={computer.contextLine} onChange={actions.setContextLine} />
            </Row>
          )}
          <CheckComputer />
        </Group>
      )}
      {starts && (
        <>
          <Group title="New agents">
            <Row label="Allow creating new agents" hint="From this app or a paired computer.">
              <Toggle label="Allow creating new agents" on={starts.launch} onChange={actions.allowNewAgents} />
            </Row>
            {starts.launch && (
              <Row label="Allow bypass from your other devices" hint="Agents started from your phone or another computer may skip permission prompts here.">
                <Toggle label="Allow bypass from your other devices" on={starts.bypass} onChange={actions.allowRemoteBypass} />
              </Row>
            )}
            <Helpers starts={starts} />
          </Group>
          <Group title="Folders agents can start in" hint="Their subfolders count, and so do the folders agents already work in. From this app, also your home folder's git repos.">
            {starts.folders.map((f) => (
              <div key={f} className="set-row set-folder">
                <span className="set-row-text set-folder-path">
                  <Icon name="folder" size={14} />
                  <span className="set-value">{f}</span>
                </span>
                <IconButton icon="close" label={`Remove ${f}`} onClick={() => actions.removeStartFolder(f)} />
              </div>
            ))}
            <button type="button" className="set-row set-add" onClick={actions.addStartFolder}>
              <Icon name="plus" size={14} />
              Add a folder…
            </button>
          </Group>
        </>
      )}
    </Page>
  )
}
