import { useMemo } from "react"

import type { Command } from "~/chat/commands"
import type { Channel } from "~/model"
import { useApp } from "~/nav"

export function useCommands(channel: Channel, off = false): Command[] {
  const { app, go } = useApp()
  const code = channel.code
  const owner = channel.youOwn
  const held = !!channel.hold
  return useMemo<Command[]>(() => {
    if (off) return []
    return [
      { name: "compact", summary: "Ask the lead for a summary to fold the history behind", run: () => app.actions.askCompact(code) },
      { name: "tasks", summary: "Open the tasks", run: () => go({ to: "tab", tab: "tasks" }) },
      { name: "prs", summary: "Open the pull requests", run: () => go({ to: "github", view: "prs" }) },
      { name: "issues", summary: "Open the issues", run: () => go({ to: "github", view: "issues" }) },
      ...(owner && !held ? [{ name: "pause", summary: "Pause the agents", args: "note", run: (note: string) => app.actions.setHold(code, true, note || undefined) }] : []),
      ...(owner && held ? [{ name: "resume", summary: "Let the agents work again", run: () => app.actions.setHold(code, false) }] : []),
    ]
  }, [off, code, owner, held, app.actions, go])
}
