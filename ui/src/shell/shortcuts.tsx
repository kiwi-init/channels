import "~/styles/shortcuts.css"

import { Dialog, DialogHead } from "~/kit/bits"
import { useApp } from "~/nav"
import { onMac } from "~/shell/shortcut-keys"

type Keys = readonly (readonly string[])[]

interface Row {
  does: string
  keys: Keys
}

interface Group {
  title: string
  rows: readonly Row[]
}

const MAC: Readonly<Record<string, string>> = { mod: "⌘", alt: "⌥", shift: "⇧" }
const OTHER: Readonly<Record<string, string>> = { mod: "Ctrl", alt: "Alt", shift: "Shift" }

export function sheetGroups(enterSends: boolean): Group[] {
  return [
    {
      title: "Get around",
      rows: [
        { does: "Find a channel, room, person or task", keys: [["mod", "K"]] },
        { does: "Channel 1 to 8 in the rail, 9 for the last", keys: [["mod", "1…9"]] },
        {
          does: "Next or previous channel with news",
          keys: [
            ["alt", "↓"],
            ["alt", "↑"],
          ],
        },
        {
          does: "Back and forward",
          keys: [
            ["mod", "["],
            ["mod", "]"],
          ],
        },
        { does: "Search this channel", keys: [["mod", "F"]] },
        { does: "Show or hide rooms and people", keys: [["mod", "\\"]] },
        { does: "Close the side panel", keys: [["Esc"]] },
      ],
    },
    {
      title: "Write",
      rows: [
        { does: "Send", keys: enterSends ? [["Enter"]] : [["mod", "Enter"]] },
        { does: "New line", keys: enterSends ? [["shift", "Enter"]] : [["Enter"]] },
        { does: "Edit your last message, from an empty box", keys: [["↑"]] },
        { does: "Put the draft away", keys: [["mod", "S"]] },
        { does: "Bring the last draft back", keys: [["shift", "mod", "S"]] },
      ],
    },
    {
      title: "Text size",
      rows: [
        { does: "Bigger", keys: [["mod", "="]] },
        { does: "Smaller", keys: [["mod", "-"]] },
        { does: "Normal", keys: [["mod", "0"]] },
      ],
    },
    { title: "Help", rows: [{ does: "These shortcuts", keys: [["mod", "/"]] }] },
  ]
}

export function keyWords(keys: Keys, mac: boolean): string[][] {
  const names = mac ? MAC : OTHER
  return keys.map((combo) => combo.map((k) => names[k] ?? k))
}

export function ShortcutsDialog() {
  const { app, nav, go } = useApp()
  const open = nav.dialog === "shortcuts"
  const close = () => go({ to: "dialog", dialog: null })
  const mac = onMac()
  return (
    <Dialog open={open} onClose={() => open && close()} label="Keyboard shortcuts" wide>
      <DialogHead title="Keyboard shortcuts" onClose={close} />
      <div className="keys-sheet">
        {sheetGroups(app.prefs.enterSends).map((group) => (
          <section key={group.title} className="keys-group" aria-label={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.rows.map((row) => (
                <div key={row.does} className="keys-row">
                  <dt>{row.does}</dt>
                  <dd>
                    {keyWords(row.keys, mac).map((combo, i) => (
                      <span key={combo.join("+")} className="keys-combo">
                        {i > 0 && <span className="keys-or">or</span>}
                        {combo.map((k) => (
                          <kbd key={k}>{k}</kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
