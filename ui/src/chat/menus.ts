import { openOutside } from "~/kit/outside"
import { askDelete, startEditing, type EditAt } from "~/chat/editing"
import { GENERAL_ROOM } from "@kiwi/core/protocol.ts"
import type { MenuGroups, MenuItem } from "~/kit/menu-open"
import type { Actions, Channel, Message, Person, Where } from "~/model"
import type { Go } from "~/nav"
import { wordsPlain, wordsRaw } from "~/words"
import { nickname, seatRoot } from "~/names"
import { hiddenKey, hiddenPlaces, setHidden } from "~/shell/hidden-places"
import { messageLink } from "@kiwi/core/message-link.ts"
import { copyText } from "~/kit/toasts"
import { openedRun } from "~/live/store"
import { docOf } from "~/chat/doc-of"
import type { ModMessage } from "~/mods/protocol"

const WEB_LINK = /^(https?:\/\/|mailto:)/i

export function webLinkAt(target: unknown): string | null {
  const at = (target as Partial<Element> | null)?.closest?.("a[href]")
  const href = at?.getAttribute("href") ?? null
  return href && WEB_LINK.test(href) ? href : null
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
}

const copier = (text: string) => () => copyText(text)

export function personItems({ channel, go }: MenuContext, person: Person): MenuItem[] {
  return [
    { label: "View profile", run: () => go({ to: "modal", modal: { kind: "person", name: person.name } }) },
    ...(person.you ? [] : [{ label: "Message", run: () => go({ to: "where", where: { kind: "dm", with: seatRoot(channel, person.name) } }) }]),
  ]
}

function forMod(channel: Channel, m: Message): ModMessage {
  const room = m.where.kind === "room" ? m.where.room : null
  return {
    seq: m.seq,
    text: wordsPlain(m.text, channel.nicknames),
    author: nickname(channel, m.from),
    from: m.from,
    channelId: openedRun(channel.code)?.roomId ?? "",
    at: m.at,
    room: room === null ? null : `#${channel.rooms.find((r) => r.id === room)?.name ?? room}`,
    link: messageLink(channel.code, m.seq),
  }
}

export const MOD_MENU = "kiwi-message-menu"

export interface ModMenuAsk {
  message: ModMessage
  add: (items: MenuItem[]) => void
}

function modGroups(channel: Channel, m: Message): MenuItem[][] {
  const groups: MenuItem[][] = []
  dispatchEvent(new CustomEvent<ModMenuAsk>(MOD_MENU, { detail: { message: forMod(channel, m), add: (items) => groups.push(items) } }))
  return groups
}

export function messageGroups(ctx: MenuContext, m: Message, target: EventTarget, more: { openImage: (url: string, alt: string) => void; reply: (() => void) | null; at: EditAt }): MenuGroups {
  const { channel } = ctx
  const link = webLinkAt(target)
  const picture = (target as Partial<Element>).closest?.<HTMLImageElement>(".msg-image img, .msg-text img") ?? null
  return [
    link
      ? [
          { label: "Open link", run: () => openOutside(link) },
          { label: "Copy link", run: copier(link) },
        ]
      : [],
    picture
      ? [
          { label: "Open image", run: () => more.openImage(picture.src, picture.alt) },
          { label: "Save image", run: () => saveImage(picture.src, picture.alt) },
        ]
      : [],
    more.reply ? [{ label: "Reply", run: more.reply }] : [],
    m.canChange
      ? [
          { label: "Edit", run: () => startEditing(channel.code, m.seq, more.at) },
          { label: "Delete", run: () => askDelete(channel.code, m.seq) },
        ]
      : [],
    [
      { label: "Copy text", run: copier(wordsRaw(m.text)) },
      { label: "Copy link to message", run: copier(messageLink(channel.code, m.seq)) },
      { label: `Copy #${m.seq}`, run: copier(`#${m.seq}`) },
    ],
    ...modGroups(channel, m),
  ]
}

export function versionsItems({ channel, go }: MenuContext, where: Where, name: string): MenuItem[] {
  const thread = docOf(channel, where)
  return thread && channel.docs?.[thread] ? [{ label: "Earlier versions", run: () => go({ to: "modal", modal: { kind: "versions", thread, name } }) }] : []
}

function hideItem(ctx: MenuContext, actions: Actions, where: Extract<Where, { kind: "room" | "dm" }>, name: string, open: boolean, keep = false): MenuItem {
  const key = hiddenKey(ctx.channel.code, where)
  const hidden = hiddenPlaces.get().includes(key)
  return {
    label: keep ? `Keep ${name} hidden` : `${hidden ? "Show" : "Hide"} ${name}`,
    run: () => {
      if (!hidden) actions.markRead(ctx.channel.code, where)
      setHidden(key, !hidden, keep)
      if (!hidden && open) ctx.go({ to: "where", where: { kind: "room", room: GENERAL_ROOM } })
    },
  }
}

export function roomGroups(
  ctx: MenuContext,
  actions: Actions,
  open: boolean,
  canLeave: boolean,
  room: { id: string; name: string; unread: number; muted?: boolean | undefined; members?: unknown }
): MenuGroups {
  const { channel, go } = ctx
  return [
    [
      ...(room.unread > 0 ? [{ label: "Mark as read", run: () => actions.markRead(channel.code, { kind: "room", room: room.id }) }] : []),
      { label: `${room.muted ? "Unmute" : "Mute"} #${room.name}`, run: () => actions.setMute(channel.code, room.id, !room.muted) },
      ...(room.id === GENERAL_ROOM ? [] : [hideItem(ctx, actions, { kind: "room", room: room.id }, `#${room.name}`, open)]),
      ...(room.id === GENERAL_ROOM || hiddenPlaces.get().includes(hiddenKey(channel.code, { kind: "room", room: room.id }))
        ? []
        : [hideItem(ctx, actions, { kind: "room", room: room.id }, `#${room.name}`, open, true)]),
    ],
    versionsItems(ctx, { kind: "room", room: room.id }, `#${room.name}`),
    channel.youOwn || channel.youTrusted ? [{ label: "Room settings", run: () => go({ to: "modal", modal: { kind: "channel", tab: "rooms" } }) }] : [],
    room.members && canLeave
      ? [
          {
            label: `Leave #${room.name}`,
            confirm: { title: `Leave #${room.name}?`, sub: "It leaves your list now. It's fully closed once someone else in the room is online, and they can add you back.", yes: "Leave" },
            run: () => {
              actions.leaveRoom(channel.code, room.id)
              if (open) go({ to: "where", where: { kind: "room", room: GENERAL_ROOM } })
            },
          },
        ]
      : [],
    [{ label: "Copy name", run: copier(`#${room.name}`) }],
  ]
}

export function directGroups(ctx: MenuContext, actions: Actions, open: boolean, direct: { with: string; unread: number }, who: Person | undefined): MenuGroups {
  return [
    [
      ...(direct.unread > 0 ? [{ label: "Mark as read", run: () => actions.markRead(ctx.channel.code, { kind: "dm", with: direct.with }) }] : []),
      hideItem(ctx, actions, { kind: "dm", with: direct.with }, "conversation", open),
    ],
    versionsItems(ctx, { kind: "dm", with: direct.with }, "This conversation"),
    who ? personItems(ctx, who).slice(0, 1) : [],
  ]
}
