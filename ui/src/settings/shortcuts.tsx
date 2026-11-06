import { keyLabel, onMac } from "~/commands/keys"
import { APP } from "~/commands/list"
import { useCommandTable } from "~/commands/table"
import { Group, Row } from "~/settings/controls"
import { Page } from "~/settings/sections"

const tilde = (file: string): string => file.replace(/^\/(Users|home)\/[^/]+/, "~")

export function ShortcutsSection() {
  const table = useCommandTable()
  const mods = [...new Set(table.mods.map((c) => c.from))]
  const row = (c: { id: string; title: string }) => {
    const keys = table.keys.get(c.id) ?? []
    return (
      <Row key={c.id} label={c.title} hint={<span className="set-mono">{c.id}</span>}>
        {keys.length ? (
          keys.map((k) => (
            <kbd key={k} className="set-kbd">
              {keyLabel(k)}
            </kbd>
          ))
        ) : (
          <span className="set-value">None</span>
        )}
      </Row>
    )
  }
  return (
    <Page
      title="Shortcuts"
      lede={
        <>
          From <code className="set-mono">{tilde(table.file ?? "~/.kiwi/keys.json")}</code>. “mod” is {onMac() ? "⌘" : "Ctrl"}.
        </>
      }
    >
      {table.problems.length > 0 && (
        <Group title="Not used">
          {table.problems.map((p, i) => (
            <Row key={i} label={<code className="set-mono">{p.id}</code>} hint={p.why} />
          ))}
        </Group>
      )}
      <Group title="Channels">{APP.map(row)}</Group>
      {mods.map((m) => (
        <Group key={m} title={m}>
          {table.mods.filter((c) => c.from === m).map(row)}
        </Group>
      ))}
    </Page>
  )
}
