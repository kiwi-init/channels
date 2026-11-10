import { useMemo } from "react"

import type { Command } from "~/chat/commands"
import { t } from "~/i18n/i18n"
import type { Channel } from "~/model"
import { useActions, useGo } from "~/nav"

export function useCommands(channel: Channel, off = false): Command[] {
  const actions = useActions()
  const go = useGo()
  const code = channel.code
  const owner = channel.youOwn
  const held = !!channel.hold
  return useMemo<Command[]>(() => {
    if (off) return []
    return [
      { name: "compact", summary: t("chat.use.commands.compact"), run: () => actions.askCompact(code) },
      { name: "tasks", summary: t("chat.use.commands.tasks"), run: () => go({ to: "spec", ask: null }) },
      { name: "prs", summary: t("chat.use.commands.prs"), run: () => go({ to: "github", view: "prs" }) },
      { name: "issues", summary: t("chat.use.commands.issues"), run: () => go({ to: "github", view: "issues" }) },
      ...(owner && !held
        ? [{ name: "pause", summary: t("chat.use.commands.pause"), args: t("chat.use.commands.pause.note"), run: (note: string) => actions.setHold(code, true, note || undefined) }]
        : []),
      ...(owner && held ? [{ name: "resume", summary: t("chat.use.commands.resume"), run: () => actions.setHold(code, false) }] : []),
    ]
  }, [off, code, owner, held, actions, go])
}
