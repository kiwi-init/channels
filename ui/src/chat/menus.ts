import { bridge } from "@kiwi/secrets/secrets.ts"
import type { MenuItem } from "~/kit/context-menu"
import type { Channel, Person } from "~/model"
import type { Go } from "~/nav"
import { seatRoot } from "~/names"

const WEB_LINK = /^(https?:\/\/|mailto:)/i

export function webLinkAt(target: unknown): string | null {
  const at = (target as Partial<Element> | null)?.closest?.("a[href]")
  const href = at?.getAttribute("href") ?? null
  return href && WEB_LINK.test(href) ? href : null
}

export function openWebLink(url: string): void {
  const b = bridge()
  if (b) void b.openExternal(url).catch(() => {})
  else window.open(url, "_blank", "noopener,noreferrer")
}

export function saveImage(url: string, name: string): void {
  const a = document.createElement("a")
  a.href = url
  a.download = name || "image"
  a.click()
}

export function personItems(channel: Channel, person: Person, go: Go): MenuItem[] {
  return [
    { label: "View profile", run: () => go({ to: "panel", panel: { kind: "person", name: person.name } }) },
    ...(person.you ? [] : [{ label: "Message privately", run: () => go({ to: "where", where: { kind: "dm", with: seatRoot(channel, person.name) } }) }]),
  ]
}
