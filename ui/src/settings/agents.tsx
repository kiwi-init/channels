import { Avatar, IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { useApp } from "~/nav"
import { Toggle } from "~/kit/bits"
import { Group, Row } from "~/settings/controls"
import { Personalities } from "~/settings/personalities"
import { Page } from "~/settings/sections"

export function AgentsSection() {
  const { app } = useApp()
  const { starts, actions } = app
  return (
    <Page title="Agents" lede="What agents you start from this computer can use.">
      <Personalities />

      <Group title="Harnesses on this computer">
        {app.harnesses.map((h) => (
          <div key={h.id} className="set-row">
            <span className="set-row-text set-harness">
              <Avatar person={{ name: h.label, kind: "agent", harness: h.id, presence: h.installed ? "online" : "offline" }} size="sm" />
              <span className="set-row-label">{h.label}</span>
            </span>
            <span className={h.installed ? "set-harness-state tone-live" : "set-harness-state"}>{h.installed ? "Installed" : "Not installed"}</span>
          </div>
        ))}
      </Group>

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
          </Group>
          <Group
            title="Folders agents can start in"
            hint="New agent, here or from your phone, can start one in these folders and the folders inside them, as well as where agents on this computer already work and your home folder's git repos."
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
