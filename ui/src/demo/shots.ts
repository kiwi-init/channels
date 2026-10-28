import type { Scenario } from "~/demo/provider"
import type { Prefs } from "~/model"
import type { Nav } from "~/nav"

export interface Shot {
  scenario: Scenario
  channel: string | null
  nav?: Partial<Nav>
  prefs?: Partial<Prefs>
}

const kiwi = (nav: Partial<Nav> = {}): Shot => ({ scenario: "full", channel: "kiwi", nav })

export const SHOTS: Record<string, Shot> = {
  channel: kiwi(),
  "long-feed": { scenario: "long", channel: "kiwi" },
  thread: kiwi({ panel: { kind: "thread", seq: 112 } }),
  dm: kiwi({ where: { kind: "dm", with: "atlas" } }),
  room: kiwi({ where: { kind: "room", room: "releases" } }),
  tasks: kiwi({ tab: "tasks" }),
  task: kiwi({ tab: "tasks", panel: { kind: "task", task: 12 } }),
  "task-working": kiwi({ panel: { kind: "task", task: 10 } }),
  "task-review": kiwi({ tab: "tasks", panel: { kind: "task", task: 14 } }),
  "task-waiting": kiwi({ tab: "tasks", panel: { kind: "task", task: 13 } }),
  "task-done": kiwi({ tab: "tasks", panel: { kind: "task", task: 9 } }),
  "tasks-empty": { scenario: "full", channel: "landing", nav: { tab: "tasks" } },
  needs: kiwi({ tab: "needs" }),
  "step-card": { scenario: "step", channel: "kiwi" },
  "needs-step": { scenario: "step", channel: "kiwi", nav: { tab: "needs" } },
  agent: kiwi({ panel: { kind: "person", name: "atlas" } }),
  person: kiwi({ panel: { kind: "person", name: "maya" } }),
  "agent-offline": kiwi({ panel: { kind: "person", name: "ridge" } }),
  "agent-working": kiwi({ panel: { kind: "person", name: "win" } }),
  me: kiwi({ panel: { kind: "person", name: "jow" } }),
  "needs-panel": kiwi({ tab: "needs", panel: { kind: "person", name: "pixel" } }),
  "needs-empty": { scenario: "full", channel: "landing", nav: { tab: "needs" } },
  "channel-settings": kiwi({ panel: { kind: "channel" } }),
  invite: kiwi({ panel: { kind: "invite" } }),
  "add-agent": kiwi({ panel: { kind: "add-agent" } }),
  "add-agent-command": kiwi({ panel: { kind: "add-agent" } }),
  "add-agent-starting": kiwi({ panel: { kind: "add-agent" } }),
  palette: kiwi({ dialog: "palette" }),
  "new-channel": kiwi({ dialog: "new-channel" }),
  join: kiwi({ dialog: "join" }),
  enroll: { scenario: "enroll", channel: "kiwi" },
  "enroll-digits": { scenario: "enroll-digits", channel: "kiwi" },
  "settings-devices": { scenario: "devices", channel: "kiwi", nav: { page: "settings", section: "computers" } },
  empty: { scenario: "full", channel: "landing" },
  waiting: { scenario: "full", channel: "ops" },
  settings: kiwi({ page: "settings", section: "account" }),
  "settings-appearance": kiwi({ page: "settings", section: "appearance" }),
  "settings-themes": {
    ...kiwi({ page: "settings", section: "appearance" }),
    prefs: {
      customThemes: [{ id: "mine-dusk", name: "Dusk", appearance: "dark", base: { background: "#15131a", text: "#e8e2f0", accent: "#f0a86b" } }],
    },
  },
  "theme-editor": kiwi({ page: "settings", section: "appearance" }),
  "personality-editor": kiwi({ page: "settings", section: "agents" }),
  "channel-merino": { ...kiwi(), prefs: { darkTheme: "merino-dark", lightTheme: "merino-light" } },
  "channel-abyssal": { ...kiwi(), prefs: { darkTheme: "abyssal-trench", lightTheme: "glacier-mint" } },
  "channel-cathode": { ...kiwi(), prefs: { darkTheme: "cathode-amber", lightTheme: "sunlit-parchment" } },
  "channel-silver": { ...kiwi(), prefs: { darkTheme: "silver-point-dark", lightTheme: "silver-point-light" } },
  "channel-heliotrope": { ...kiwi(), prefs: { darkTheme: "heliotrope-haze", lightTheme: "lavender-postcard" } },
  "settings-agents": kiwi({ page: "settings", section: "agents" }),
  "settings-computers": kiwi({ page: "settings", section: "computers" }),
  "settings-notifications": kiwi({ page: "settings", section: "notifications" }),
  "settings-updates": kiwi({ page: "settings", section: "updates" }),
  "settings-update-ready": { scenario: "update-ready", channel: "kiwi", nav: { page: "settings", section: "updates" } },
  "settings-update-available": { scenario: "update-available", channel: "kiwi", nav: { page: "settings", section: "updates" } },
  "settings-about": kiwi({ page: "settings", section: "about" }),
  "channel-settings-guest": { scenario: "full", channel: "studio", nav: { panel: { kind: "channel" } } },
  updates: { scenario: "updates", channel: "kiwi" },
  "first-run": { scenario: "signed-out", channel: null },
  welcome: { scenario: "no-channels", channel: null },
}
