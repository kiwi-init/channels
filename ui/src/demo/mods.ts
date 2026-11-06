import type { ModDetails, ModIcon, ModView } from "../../../desktop/src/bridge.ts"
import { showMods } from "~/mods/host"
import { showModReads } from "~/mods/served"

const svg = (body: string): ModIcon => ({ type: "image/svg+xml", data: btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`) })

const ICONS: Record<string, ModIcon> = {
  "release-radar": svg(
    '<rect width="64" height="64" rx="14" fill="#1f9a55"/><circle cx="32" cy="34" r="16" fill="none" stroke="#fff" stroke-width="4"/><circle cx="32" cy="34" r="6" fill="#fff"/><path d="M32 34 46 20" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'
  ),
  "standup-notes": svg('<rect width="64" height="64" rx="14" fill="#2f6fe4"/><path d="M20 22h24M20 32h24M20 42h14" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'),
}

const MODS: ModView[] = [
  {
    name: "release-radar",
    version: "1.4.0",
    source: "github.com/kiwi-init/mods/release-radar",
    needs: ["panel", "sidebar", "command", "message-action", "net:api.github.com"],
    approved: ["panel", "sidebar", "command", "message-action", "net:api.github.com"],
    state: "on",
    hash: "5f0c2b9e1a7d4c3e",
    icon: "a41c09e2d8b7f310",
  },
  { name: "standup-notes", version: "0.1.0", source: "local", needs: ["panel"], approved: ["panel"], state: "on", hash: "9d2e7a1b0c4f6e85", icon: "c7b2e04f19a3d6e8" },
  { name: "weather", version: "2.0.1", source: "github.com/ana-lima/weather-mod", needs: ["panel", "net:api.open-meteo.com"], approved: [], state: "asks" },
]

const README = `# Release Radar

Every release your channel's repos ship, beside the chat, with what changed since the last one.

## Use it

- **⌘K → New release notes** drafts notes from the merged pull requests.
- **⌘K → Open Release Radar** shows the panel.

It reads public releases from \`api.github.com\` and keeps nothing between reloads.
`

const DAY = 86_400_000

const DETAILS: Record<string, ModDetails> = {
  "release-radar": {
    name: "release-radar",
    version: "1.4.0",
    author: "Kiwi",
    source: "github.com/kiwi-init/mods/release-radar",
    commit: "3f9a2c1d8e7b6a5f4c3d2e1f0a9b8c7d6e5f4a3b",
    installed: Date.UTC(2026, 9, 28, 15),
    updated: Date.UTC(2026, 10, 4, 9),
    bytes: 48_213,
    readme: README,
    iconWhy: null,
  },
  "standup-notes": {
    name: "standup-notes",
    version: "0.1.0",
    author: null,
    source: "local",
    commit: null,
    installed: Date.now() - 2 * DAY,
    updated: Date.now() - DAY,
    bytes: 1_904,
    readme: null,
    iconWhy: null,
  },
}

export function showDemoMods(): void {
  showModReads({ modIcon: (name) => Promise.resolve(ICONS[name] ?? null), modDetails: (name) => Promise.resolve(DETAILS[name] ?? null) })
  showMods(MODS, [
    {
      name: "release-radar",
      title: "Release Radar",
      failed: null,
      side: { title: "Releases", height: 120 },
      actions: [{ id: "notes", title: "Draft release notes from this" }],
      commands: ["New release notes", "Open Release Radar"],
    },
  ])
}
