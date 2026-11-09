import "~/i18n/en/settings"

import { t } from "~/i18n/i18n"
import type { UpdateCheck } from "~/model"

export function updateFound(u: UpdateCheck | null): string {
  if (!u) return t("settings.update.check.idle")
  switch (u.state) {
    case "current":
      return t("settings.update.check.current", { version: u.version })
    case "failed":
      return t("settings.update.check.failed")
    case "downloading":
      return t("settings.update.check.downloading", { version: u.version })
    case "ready":
      return t("settings.update.check.ready", { version: u.version })
    case "available":
      return u.blocked ? t("settings.update.check.blocked") : t("settings.update.check.available", { version: u.version })
  }
}
