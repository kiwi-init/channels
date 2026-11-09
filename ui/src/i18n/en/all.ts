import { en } from "~/i18n/en"
import liveLater from "~/i18n/en/live-later"
import settings from "~/i18n/en/settings"

export const english = { ...en, ...liveLater, ...settings } as const
