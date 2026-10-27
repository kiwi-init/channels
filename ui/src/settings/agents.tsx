import { useState } from "react"

import { Avatar, IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { useApp } from "~/nav"
import { Toggle } from "~/kit/bits"
import { Group, Row } from "~/settings/controls"
import { Page } from "~/settings/sections"

export function AgentsSection() {
  const { app } = useApp()
  const [folders, setFolders] = useState(["~/www/channels", "~/www/landing"])
  const [adding, setAdding] = useState(false)
  const [remote, setRemote] = useState(false)

  return (
    <Page title="Agents" lede="What agents you start from this computer can use.">
      <Group title="Personalities">
        {app.personas.map((p) => (
          <Row key={p.id} label={p.label} hint={p.about} />
        ))}
      </Group>

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

      <Group title="Folders agents can start in">
        {folders.length === 0 && !adding && <p className="set-none">No folders yet. Agents need one to start in.</p>}
        {folders.map((f) => (
          <div key={f} className="set-row set-folder">
            <span className="set-row-text set-folder-path">
              <Icon name="folder" size={14} />
              <span className="set-value">{f}</span>
            </span>
            <IconButton icon="close" label={`Remove ${f}`} onClick={() => setFolders((list) => list.filter((x) => x !== f))} />
          </div>
        ))}
        {adding ? (
          <form
            className="set-row set-folder-add"
            onSubmit={(e) => {
              e.preventDefault()
              const path = new FormData(e.currentTarget).get("folder")?.toString().trim()
              if (path) setFolders((list) => (list.includes(path) ? list : [...list, path]))
              setAdding(false)
            }}
          >
            <input
              name="folder"
              autoFocus
              className="input is-mono"
              placeholder="~/code/project"
              aria-label="Folder path"
              onKeyDown={(e) => {
                if (e.key !== "Escape") return
                e.preventDefault()
                setAdding(false)
              }}
            />
            <button type="submit" className="btn is-small">
              Add
            </button>
            <button type="button" className="btn is-quiet is-small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="set-row set-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            Add a folder…
          </button>
        )}
      </Group>

      <Group>
        <Row label="Let agents start from my other devices" hint="Your other computers and phones can start an agent here, in one of the folders above.">
          <Toggle label="Let agents start from my other devices" on={remote} onChange={setRemote} />
        </Row>
      </Group>
    </Page>
  )
}
