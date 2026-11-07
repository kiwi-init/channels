import type { CatalogMod, ModDetails, ModIcon, ModInstalled, ModStorePage, ModUpdate, ModView } from "../../../desktop/src/bridge.ts"
import { askLater, showMods } from "~/mods/host"
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
    settingsRev: 3,
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
    settings: [
      { id: "token", title: "GitHub token", type: "secret", required: true, set: true },
      { id: "repos", title: "Repos to watch", type: "text", value: "kiwi-init/channels, kiwi-init/mods" },
      { id: "since", title: "Changes since", type: "choice", choices: ["The last release", "The last week", "The last month"], value: "The last release" },
      { id: "drafts", title: "Include draft releases", type: "toggle", value: false },
    ],
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
    settings: [],
  },
}

const INSTALLED: ModInstalled[] = [
  { name: "release-radar", source: "github.com/kiwi-init/mods/release-radar", commit: "3f9a2c1", local: false, link: null, changed: false },
  { name: "standup-notes", source: null, commit: null, local: true, link: null, changed: false },
  { name: "weather", source: "github.com/ana-lima/weather-mod", commit: "b81e4d0", local: false, link: null, changed: false },
]

const CATALOG: CatalogMod[] = [
  {
    name: "github",
    does: "Your pull requests, reviews and checks, in a panel beside the chat",
    needs: ["tab", "panel", "github"],
    commit: "fef9c2d6fc23f8cce1d0986541362457e3f7e7d7",
    source: "github.com/kiwi-init/mods/github",
    installed: false,
    author: "Kiwi",
    category: "Developer tools",
    icon: svg(
      '<rect width="64" height="64" rx="14" fill="#24292f"/><circle cx="22" cy="20" r="5" fill="none" stroke="#fff" stroke-width="4"/><circle cx="22" cy="44" r="5" fill="none" stroke="#fff" stroke-width="4"/><circle cx="42" cy="28" r="5" fill="none" stroke="#fff" stroke-width="4"/><path d="M22 25v14M42 33c0 6-8 6-16 9" fill="none" stroke="#fff" stroke-width="4"/>'
    ),
  },
  {
    name: "release-radar",
    does: "New releases of what you depend on, with notes drafted from them",
    needs: ["panel", "sidebar", "command", "message-action", "net:api.github.com"],
    commit: "3f9a2c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39",
    source: "github.com/kiwi-init/mods/release-radar",
    installed: true,
    icon: ICONS["release-radar"]!,
  },
  {
    name: "terminals",
    does: "Your tmux and Rex terminals, one tap from the task that runs in them",
    needs: ["terminal", "command", "message-action"],
    commit: "0b4d9e2f7a1c3b5d6e8f0a2c4e6b8d0f1a3c5e7b",
    source: "github.com/kiwi-init/mods/terminals",
    installed: false,
  },
]

const GITHUB_README = [
  "# GitHub",
  "",
  "The channel's **GitHub** tab: the pull requests, issues and checks of the repos the channel works on, and a panel for each one beside the chat.",
  "",
  "## What it shows",
  "",
  "- Pull requests waiting on you first, then the ones you opened",
  "- Checks as they run, with the failing step one click away",
  "- Issues by label, with who's on each",
  "",
  "It reads GitHub with the token you signed in with, and writes nothing.",
  "",
].join("\n")

function drawn(rows: { dot: string; width: number }[], panel: boolean): string {
  const c = document.createElement("canvas")
  c.width = 960
  c.height = 600
  const g = c.getContext("2d")
  if (!g) return ""
  const box = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    g.fillStyle = fill
    g.beginPath()
    g.roundRect(x, y, w, h, r)
    g.fill()
  }
  box(0, 0, 960, 600, 0, "#161514")
  box(0, 0, 960, 56, 0, "#1d1b1a")
  box(32, 20, 120, 16, 8, "#4a4644")
  box(176, 20, 80, 16, 8, "#2e2b2a")
  box(272, 20, 80, 16, 8, "#2e2b2a")
  const left = panel ? 560 : 896
  rows.forEach((r, i) => {
    const y = 88 + i * 72
    box(32, y, left, 56, 10, "#1f1d1c")
    g.fillStyle = r.dot
    g.beginPath()
    g.arc(60, y + 28, 7, 0, Math.PI * 2)
    g.fill()
    box(84, y + 14, r.width, 12, 6, "#8a8481")
    box(84, y + 34, r.width * 0.55, 8, 4, "#4a4644")
  })
  if (panel) {
    box(616, 88, 312, 480, 14, "#1f1d1c")
    box(640, 112, 180, 14, 7, "#a19a97")
    ;["#3fb950", "#3fb950", "#d29922", "#f85149"].forEach((dot, i) => {
      g.fillStyle = dot
      g.beginPath()
      g.arc(652, 168 + i * 44, 6, 0, Math.PI * 2)
      g.fill()
      box(672, 162 + i * 44, 200 - i * 24, 12, 6, "#6d6764")
    })
  }
  return c.toDataURL("image/png").replace(/^data:image\/png;base64,/, "")
}

function githubPage(): ModStorePage {
  const pulls = [
    { dot: "#3fb950", width: 420 },
    { dot: "#a371f7", width: 360 },
    { dot: "#3fb950", width: 480 },
    { dot: "#d29922", width: 300 },
    { dot: "#3fb950", width: 390 },
    { dot: "#a371f7", width: 340 },
  ]
  return {
    name: "github",
    version: "2.3.0",
    readme: GITHUB_README,
    shots: [
      { name: "media/1-pulls.png", type: "image/png", data: drawn(pulls, false) },
      { name: "media/2-checks.png", type: "image/png", data: drawn(pulls.slice(0, 5), true) },
    ],
    skipped: [{ name: "media/3-full-window.png", why: "it's over 1 MB" }],
  }
}

const RADAR_UPDATE: ModUpdate = { name: "release-radar", from: "1.4.0", to: "1.5.0", commits: 3, added: [], dropped: [] }

export function showDemoMods(ask: boolean): void {
  showModReads({
    modIcon: (name) => Promise.resolve(ICONS[name] ?? null),
    modDetails: (name) => Promise.resolve(DETAILS[name] ?? null),
    setModSetting: () => Promise.resolve(MODS),
    modsInstalled: () => Promise.resolve(INSTALLED),
    modUpdates: () => Promise.resolve({ changes: [RADAR_UPDATE], skipped: [] }),
    updateMod: () => Promise.resolve(MODS),
    removeMod: () => Promise.resolve(MODS),
    modCatalog: () => Promise.resolve({ mods: CATALOG, why: null }),
    installMod: () => Promise.resolve(MODS),
    modStorePage: (name) => (name === "github" ? Promise.resolve(githubPage()) : Promise.resolve({ name, version: "1.0.0", readme: null, shots: [], skipped: [] })),
    openModFolder: (name) => Promise.resolve({ editor: "Zed", dir: `~/.kiwi/mods/${name}` }),
  })
  showMods(MODS, [
    {
      name: "release-radar",
      title: "Release Radar",
      failed: null,
      side: { title: "Releases", height: 120 },
      tab: null,
      actions: [{ id: "notes", title: "Draft release notes from this" }],
      commands: ["New release notes", "Open Release Radar"],
    },
  ])
  if (!ask) for (const m of MODS) if (m.state === "asks") askLater(m)
}
