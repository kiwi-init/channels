import { en } from "~/i18n/en"
import chatLater from "~/i18n/en/chat-later"
import githubLater from "~/i18n/en/github-later"
import liveLater from "~/i18n/en/live-later"
import modals from "~/i18n/en/modals"
import needs from "~/i18n/en/needs"
import settings from "~/i18n/en/settings"
import shellLater from "~/i18n/en/shell-later"
import specs from "~/i18n/en/specs"

export const english = { ...en, ...liveLater, ...settings, ...chatLater, ...specs, ...modals, ...needs, ...shellLater, ...githubLater } as const
