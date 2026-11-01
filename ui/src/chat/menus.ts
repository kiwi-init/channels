import { bridge } from "@kiwi/secrets/secrets.ts"
import { askDelete, startEditing } from "~/chat/editing"
import { GENERAL_ROOM } from "@kiwi/core/protocol.ts"
import type { MenuGroups, MenuItem } from "~/kit/menu-open"
import type { Actions, Channel, Message, Person, Where } from "~/model"
import type { Go } from "~/nav"
import { seatRoot } from "~/names"
import { hiddenKey, hiddenPlaces, setHidden } from "~/shell/hidden-places"

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

function hideItem(ctx: MenuContext, actions: Actions, where: Extract<Where, { kind: "room" | "dm" }>, name: string, open: boolean): MenuItem {
  const key = hiddenKey(ctx.channel.code, where)
  const hidden = hiddenPlaces.get().includes(key)
  return {
    label: `${hidden ? "Show" : "Hide"} ${name}`,
    run: () => {
      if (!hidden) actions.markRead(ctx.channel.code, where)
      setHidden(key, !hidden)
      if (!hidden && open) ctx.go({ to: "where", where: { kind: "room", room: GENERAL_ROOM } })
    },
  }
}

export function roomGroups(ctx: MenuContext, actions: Actions, open: boolean, room: { id: string; name: string; unread: number; muted?: boolean | undefined }): MenuGroups {
  const { channel, go, toast } = ctx
  return [
    [
      ...(room.unread > 0 ? [{ label: "Mark as read", run: () => actions.markRead(channel.code, { kind: "room", room: room.id }) }] : []),
      { label: `${room.muted ? "Unmute" : "Mute"} #${room.name}`, run: () => actions.setMute(channel.code, room.id, !room.muted) },
      ...(room.id === GENERAL_ROOM ? [] : [hideItem(ctx, actions, { kind: "room", room: room.id }, `#${room.name}`, open)]),
    ],
    channel.youOwn || channel.youTrusted ? [{ label: "Room settings", run: () => go({ to: "panel", panel: { kind: "channel" } }) }] : [],
    [{ label: "Copy name", run: copier(toast, `#${room.name}`) }],
  ]
}

export function directGroups(ctx: MenuContext, actions: Actions, open: boolean, direct: { with: string; unread: number }, who: Person | undefined): MenuGroups {
  return [
    [
      ...(direct.unread > 0 ? [{ label: "Mark as read", run: () => actions.markRead(ctx.channel.code, { kind: "dm", with: direct.with }) }] : []),
      hideItem(ctx, actions, { kind: "dm", with: direct.with }, "conversation", open),
    ],
    who ? personItems(ctx, who).slice(0, 1) : [],
  ]
}
