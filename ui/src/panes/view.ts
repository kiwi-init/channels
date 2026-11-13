import type { Channel } from "~/model"
import type { Nav } from "~/nav"
import type { Doc } from "~/panes/store"
import { wordsPlain } from "~/words"
import { t } from "~/i18n/i18n"

export type DetailView = Extract<Doc, { kind: "task" }> | { kind: "pr"; repo: string; number: number } | { kind: "issue"; repo: string; number: number }

export type View = DetailView | { kind: "now" } | { kind: "specs" } | { kind: "spec"; ask: number } | { kind: "agents" } | { kind: "github" } | { kind: "needs" }

export function viewOf(nav: Nav): View | null {
  if (nav.tab === "chat") return null
  if (nav.tab === "specs") return nav.spec == null ? { kind: "specs" } : { kind: "spec", ask: nav.spec }
  return { kind: nav.tab }
}

export function docName(channel: Channel, doc: Exclude<Doc, { kind: "panel" }>): string {
  if (doc.kind === "now") return t("panes.now")
  if (doc.kind === "blank") return t("panes.blank.name")
  if (doc.kind === "home") return t("panes.home")
  if (doc.kind === "activity") return t("panes.activity")
  const task = channel.tasks.find((x) => x.id === doc.task)
  return task ? `T${task.id} ${wordsPlain(task.title, channel.nicknames)}` : `T${doc.task}`
}
