import type { PermissionShown } from "@kiwi/core/permission.ts"
import type { DecisionKind, Message as Wire } from "@kiwi/core/protocol.ts"
import { permissionNoteKinds, permissionWant, type PermissionNote } from "@kiwi/app/permission-view.ts"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"

export function permissionTitleOf(p: PermissionShown): string {
  const want = permissionWant(p)
  switch (want.kind) {
    case "mcp":
      return t("live.ask.wants.mcp", { server: want.server, tool: want.tool })
    case "command":
      return t("live.ask.wants.command")
    case "write":
      return t("live.ask.wants.write")
    case "edit":
      return want.files ? t("live.ask.wants.edit.files") : t("live.ask.wants.edit.file")
    case "fetch":
      return t("live.ask.wants.fetch")
    case "tool":
      return t("live.ask.wants.tool", { tool: want.tool })
  }
}

const NOTES: Record<PermissionNote, Key> = {
  sandbox: "live.ask.note.sandbox",
  background: "live.ask.note.background",
  "replace-all": "live.ask.note.replace.all",
  "too-long": "live.ask.note.too.long",
}

export const permissionNotesOf = (p: PermissionShown): string[] => permissionNoteKinds(p).map((n) => t(NOTES[n]))

const DECISIONS: Record<DecisionKind, readonly [Key, Key]> = {
  intent: ["live.ask.intent", "live.ask.intent.you"],
  taste: ["live.ask.taste", "live.ask.taste.you"],
  irreversible: ["live.ask.irreversible", "live.ask.irreversible.you"],
  scope: ["live.ask.scope", "live.ask.scope.you"],
  choice: ["live.ask.decision", "live.said.decision.you"],
}

export function decisionWords(m: Pick<Wire, "decision" | "step">, forYou: boolean): string {
  if (m.step) return t(forYou ? "live.said.step.you" : "live.ask.step")
  const [bare, you] = DECISIONS[m.decision ?? "choice"]
  return t(forYou ? you : bare)
}
