import { t } from "~/i18n/i18n"

type Mods = Pick<KeyboardEvent, "metaKey" | "ctrlKey">

const platform = (): string => (typeof navigator === "undefined" ? "" : navigator.platform)

export const onMac = (where: string = platform()): boolean => /mac|iphone|ipad/i.test(where)

export const mod = (e: Mods, mac: boolean = onMac()): boolean => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)

export function inText(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el.isContentEditable
}

export const dialogOpen = (): boolean => !!document.querySelector("dialog[open]")

export function keysHint(key: string, shift: boolean = false, mac: boolean = onMac()): string {
  if (mac) return `${shift ? "⇧" : ""}⌘${key === "Enter" ? ` ${t("shell.keys.enter")}` : key}`
  return [t("shell.keys.ctrl"), ...(shift ? [t("shell.keys.shift")] : []), key === "↩" || key === "Enter" ? t("shell.keys.enter") : key].join("+")
}
