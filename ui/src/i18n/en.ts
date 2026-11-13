import type { english } from "~/i18n/en/all"
import chat from "~/i18n/en/chat"
import events from "~/i18n/en/events"
import github from "~/i18n/en/github"
import live from "~/i18n/en/live"
import settingsShared from "~/i18n/en/settings-shared"
import shell from "~/i18n/en/shell"
import status from "~/i18n/en/status"

export type Msg = string | Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>

export const en = {
  ...live,
  ...events,
  ...status,
  ...settingsShared,
  ...chat,
  ...shell,
  ...github,
} as const satisfies Record<string, Msg>

export type Key = keyof typeof english
