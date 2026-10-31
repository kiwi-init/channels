import { bridge } from "@kiwi/secrets/secrets.ts"
import { askDelete, startEditing } from "~/chat/editing"
import type { MenuGroups, MenuItem } from "~/kit/menu-open"
import type { Actions, Channel, Message, Person } from "~/model"
import type { Go } from "~/nav"
import { seatRoot } from "~/names"

const WEB_LINK = /^(https?:\/\/|mailto:)/i

export function webLinkAt(target: unknown): string | null {
  const at = (target as Partial<Element> | null)?.closest?.("a[href]")
  const href = at?.getAttribute("href") ?? null
  return href && WEB_LINK.test(href) ? href : null
}

function openWebLink(url: string): void {
  const b = bridge()
  if (b) void b.openExternal(url).catch(() => {})
  else window.open(url, "_blank", "noopener,noreferrer")
}

function saveImage(url: string, name: string): void {
  const a = document.createElement("a")
  a.href = url
  a.download = name || "image"
  a.click()
}

export interface MenuContext {
  channel: Channel
  go: (to: Go) => void
  toast: (text: string) => void
}

const copier = (toast: (text: string) => void, text: string) => () =>
  void navigator.clipboard?.writeText(text).then(
    () => toast("Copied"),
    () => {}
  )

export function personItems({ channel, go }: MenuContext, person: Person): MenuItem[] {
  return [
    { label: "View profile", run: () => go({ to: "panel", panel: { kind: "person", name: person.name } }) },
    ...(person.you ? [] : [{ label: "Message", run: () => go({ to: "where", where: { kind: "dm", with: seatRoot(channel, person.name) } }) }]),
  ]
}

export function messageGroups(ctx: MenuContext, m: Message, target: EventTarget, more: { openImage: (url: string, alt: string) => void; reply: (() => void) | null; inThread: boolean }): MenuGroups {
  const { channel, go, toast } = ctx
  const link = webLinkAt(target)
  const picture = (target as Partial<Element>).closest?.<HTMLImageElement>(".msg-image img, .msg-text img") ?? null
  return [
    link
      ? [
          { label: "Open link", run: () => openWebLink(link) },
          { label: "Copy link", run: copier(toast, link) },
        ]
      : [],
    picture
      ? [
          { label: "Open image", run: () => more.openImage(picture.src, picture.alt) },
          { label: "Save image", run: () => saveImage(picture.src, picture.alt) },
        ]
      : [],
    [
      ...(more.reply ? [{ label: "Reply", run: more.reply }] : []),
      ...(more.inThread ? [] : [{ label: "Open thread", run: () => go({ to: "panel", panel: { kind: "thread", seq: m.inThread ?? m.seq } }) }]),
    ],
    m.canChange
      ? [
          { label: "Edit", run: () => startEditing(channel.code, m.seq) },
          { label: "Delete", run: () => askDelete(channel.code, m.seq) },
        ]
      : [],
    [
      { label: "Copy text", run: copier(toast, m.text) },
      { label: `Copy #${m.seq}`, run: copier(toast, `#${m.seq}`) },
    ],
  ]
}

export function roomGroups(ctx: MenuContext, actions: Actions, room: { id: string; name: string; unread: number }): MenuGroups {
  const { channel, go, toast } = ctx
  return [
    room.unread > 0 ? [{ label: "Mark as read", run: () => actions.markRead(channel.code, { kind: "room", room: room.id }) }] : [],
    channel.youOwn || channel.youTrusted ? [{ label: "Room settings", run: () => go({ to: "panel", panel: { kind: "channel" } }) }] : [],
    [{ label: "Copy name", run: copier(toast, `#${room.name}`) }],
  ]
}

export function directGroups(ctx: MenuContext, actions: Actions, direct: { with: string; unread: number }, who: Person | undefined): MenuGroups {
  return [direct.unread > 0 ? [{ label: "Mark as read", run: () => actions.markRead(ctx.channel.code, { kind: "dm", with: direct.with }) }] : [], who ? personItems(ctx, who).slice(0, 1) : []]
}
