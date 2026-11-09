import { en } from "~/i18n/en"
import chatLater from "~/i18n/en/chat-later"
import liveLater from "~/i18n/en/live-later"
import settings from "~/i18n/en/settings"
import specs from "~/i18n/en/specs"

export const english = { ...en, ...liveLater, ...settings, ...chatLater, ...specs } as const
