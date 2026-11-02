import { useState } from "react"

import type { TerminalId, TerminalRow } from "@kiwi/core/terminals.ts"
import { Avatar, IconButton, Toggle } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { AgentStarts, Finding, ThisComputer } from "~/model"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { Personalities } from "~/settings/personalities"
import { Page } from "~/settings/sections"

const HOOK_SAYS: Record<ThisComputer["hooks"][number]["state"], { desc: string; action: string }> = {
  installed: { desc: "Installed", action: "Remove" },
  partial: { desc: "Installed, but it can't wake Claude Code when a message comes", action: "Update" },
  outdated: { desc: "From an older kiwi: update them", action: "Update" },
  missing: { desc: "Not installed", action: "Install" },
  off: { desc: "Removed. Kiwi won't add them back until you install them", action: "Install" },
}

const HELPERS: Record<TerminalId, { download: string; on: string; off: string }> = {
  rex: {
    download: "Download Rex Helpers",
    on: "Downloaded. A seat that needs you marks its Rex tab, and Needs you opens it.",
    off: "Marks a seat that needs you in its Rex tab, and opens it from Needs you.",
  },
  tmux: {
    download: "Download Tmux Helpers",
    on: "Downloaded. A seat that needs you marks its window in tmux, and prefix K jumps to it.",
    off: "Marks a seat that needs you in tmux's window list, and jumps to it with prefix K.",
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
    <Group>
      <Row
        label="Check this computer"
        hint={Array.isArray(state) ? (problems ? `${problems} to fix` : "Nothing to fix") : "Looks at kiwi's install, the relay, your devices and hooks, and says how to fix what isn't right."}
      >
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
    </Group>
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
  return (
    <Page title="Agents" lede="What agents you start from this computer can use.">
      <Personalities />

      <Group title="Harnesses on this computer" hint={computer ? (computer.kiwi.running && computer.kiwi.version ? `kiwi ${computer.kiwi.version}, running` : "kiwi isn't running") : undefined}>
        {app.harnesses.map((h) => (
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
              </span>
            </span>
            <span className={h.installed ? "set-harness-state tone-live" : "set-harness-state"}>{h.installed ? "Installed" : "Not installed"}</span>
          </div>
        ))}
      </Group>

      {computer && (
        <>
          <Group
            title="Hooks"
            hint={computer.hooks.length ? "Hooks bring new messages to the agents on this computer and their permission prompts to Needs you." : "No harness on this computer takes hooks."}
          >
            {computer.hooks.map((h) => (
              <Row key={h.harness} label={h.label} hint={HOOK_SAYS[h.state].desc}>
                <button
                  type="button"
                  className="btn is-quiet is-small"
                  aria-label={`${HOOK_SAYS[h.state].action} ${h.label}'s hooks`}
                  onClick={() => actions.setHooks(h.harness, h.state !== "installed")}
                >
                  {HOOK_SAYS[h.state].action}
                </button>
              </Row>
            ))}
          </Group>
          {computer.contextLine !== null && (
            <Group>
              <Row
                label="Ask agents for a checkpoint past 250k context"
                hint="Off by default. On, an agent on this computer past 250k tokens is asked to write where its work stands before it ends its turn."
              >
                <Toggle label="Ask agents for a checkpoint past 250k context" on={computer.contextLine} onChange={actions.setContextLine} />
              </Row>
            </Group>
          )}
          <CheckComputer />
        </>
      )}
      {starts && (
        <>
          <Group title="New agents">
            <Row label="Allow creating new agents" hint="New agent starts an agent on this computer, from this app or from a computer paired with it.">
              <Toggle label="Allow creating new agents" on={starts.launch} onChange={actions.allowNewAgents} />
            </Row>
            {starts.launch && (
              <Row label="Allow bypass from your other devices" hint="An agent started from your phone or another computer may skip its harness's permission prompts here. Off keeps every prompt.">
                <Toggle label="Allow bypass from your other devices" on={starts.bypass} onChange={actions.allowRemoteBypass} />
              </Row>
            )}
            <Helpers starts={starts} />
          </Group>
          <Group
            title="Folders agents can start in"
            hint="New agent, here or from your phone, can start one in these folders and the folders inside them, and where agents on this computer already work. Here, it can also start one in your home folder's git repos."
          >
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
