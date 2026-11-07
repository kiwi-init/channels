import { useCommands } from "~/commands/table"
import { useApp } from "~/nav"

const THEMES = ["dark", "light", "system"] as const

export function AppCommands() {
  const { app, nav, go } = useApp()
  useCommands([
    { id: "app.new-channel", run: () => go({ to: "dialog", dialog: "new-channel" }) },
    { id: "app.join", run: () => go({ to: "dialog", dialog: "join" }) },
    { id: "app.new-mod", run: () => go({ to: "dialog", dialog: "new-mod" }) },
    { id: "app.computers", run: () => go({ to: "settings", section: "computers" }) },
    { id: "app.settings", run: () => go({ to: "settings" }) },
    ...THEMES.map((theme) => ({
      id: `view.theme-${theme}` as const,
      run: () => {
        if (app.prefs.theme !== theme) app.actions.setPrefs({ theme })
        if (nav.dialog === "palette") go({ to: "dialog", dialog: null })
      },
    })),
  ])
  return null
}
