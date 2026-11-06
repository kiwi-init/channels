import { useMemo } from "react"

import type { Command } from "~/chat/commands"
import type { Channel } from "~/model"
import { showModTab, useModTabs } from "~/mods/bus"
import { useApp } from "~/nav"

export function useCommands(channel: Channel, off = false): Command[] {
  const { app, go } = useApp()
  const code = channel.code
  const owner = channel.youOwn
  const held = !!channel.hold
  const github = useModTabs().some((t) => t.name === "github")
  return useMemo<Command[]>(() => {
    if (off) return []
    return [
      { name: "compact", summary: "Ask the lead for a summary to fold the history behind", run: () => app.actions.askCompact(code) },
      { name: "tasks", summary: "Open the tasks", run: () => go({ to: "tab", tab: "tasks" }) },
      ...(github
        ? [
            { name: "prs", summary: "Open the pull requests", run: () => void showModTab("github", { kind: "view", view: "prs" }) },
            { name: "issues", summary: "Open the issues", run: () => void showModTab("github", { kind: "view", view: "issues" }) },
          ]
        : []),
      ...(owner && !held ? [{ name: "pause", summary: "Pause the agents", args: "note", run: (note: string) => app.actions.setHold(code, true, note || undefined) }] : []),
      ...(owner && held ? [{ name: "resume", summary: "Let the agents work again", run: () => app.actions.setHold(code, false) }] : []),
    ]
  }, [off, code, owner, held, github, app.actions, go])
}
