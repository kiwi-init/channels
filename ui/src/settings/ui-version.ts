import "~/i18n/en/settings"

import { t } from "~/i18n/i18n"

export function uiVersionOf(stamped: unknown): string {
  return typeof stamped === "string" && stamped.trim() ? stamped.trim() : t("settings.sections.interface.built.in")
}

export const uiVersion = (): string => uiVersionOf(import.meta.env.VITE_KIWI_UI_VERSION)
