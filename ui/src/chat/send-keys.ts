import { t } from "~/i18n/i18n"

export type SendKey = {
  key: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  keyCode: number
  nativeEvent: { isComposing: boolean }
}

export const composing = (e: SendKey): boolean => e.nativeEvent.isComposing || e.keyCode === 229

export const sendsOn = (e: SendKey): boolean => !composing(e) && e.key === "Enter" && !e.shiftKey && !e.altKey

export const sendTitle = (): string => t("chat.send.keys.enter")
