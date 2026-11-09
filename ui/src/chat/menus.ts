import "~/i18n/en/chat-later"
import { openOutside } from "~/kit/outside"
import { askDelete, startEditing, type EditAt } from "~/chat/editing"
import { GENERAL_ROOM } from "@kiwi/core/protocol.ts"
import type { MenuGroups, MenuItem } from "~/kit/menu-open"
import type { Actions, Channel, Message, Person, Where } from "~/model"
import type { Go } from "~/nav"
import { wordsRaw } from "~/words"
import { seatRoot } from "~/names"
import { hiddenKey, hiddenPlaces, setHidden } from "~/shell/hidden-places"
import { messageLink } from "@kiwi/core/message-link.ts"
import { copyText } from "~/kit/toasts"
import { docOf } from "~/chat/doc-of"
import { t } from "~/i18n/i18n"

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
    { label: t("chat.menus.view.profile"), run: () => go({ to: "modal", modal: { kind: "person", name: person.name } }) },
    ...(person.you ? [] : [{ label: t("chat.menus.message"), run: () => go({ to: "where", where: { kind: "dm", with: seatRoot(channel, person.name) } }) }]),
  ]
}

export function messageGroups(ctx: MenuContext, m: Message, target: EventTarget, more: { openImage: (url: string, alt: string) => void; reply: (() => void) | null; at: EditAt }): MenuGroups {
  const { channel } = ctx
  const link = webLinkAt(target)
  const picture = (target as Partial<Element>).closest?.<HTMLImageElement>(".msg-image img, .msg-text img") ?? null
  return [
    link
      ? [
          { label: t("chat.menus.open.link"), run: () => openOutside(link) },
          { label: t("chat.menus.copy.link"), run: copier(link) },
        ]
      : [],
    picture
      ? [
          { label: t("chat.menus.open.image"), run: () => more.openImage(picture.src, picture.alt) },
          { label: t("chat.menus.save.image"), run: () => saveImage(picture.src, picture.alt) },
        ]
      : [],
    more.reply ? [{ label: t("chat.menus.reply"), run: more.reply }] : [],
    m.canChange
      ? [
          { label: t("chat.menus.edit"), run: () => startEditing(channel.code, m.seq, more.at) },
          { label: t("chat.menus.delete"), run: () => askDelete(channel.code, m.seq) },
        ]
      : [],
    [
      { label: t("chat.menus.copy.text"), run: copier(wordsRaw(m.text)) },
      { label: t("chat.menus.copy.message.link"), run: copier(messageLink(channel.code, m.seq)) },
      { label: t("chat.menus.copy.seq", { seq: String(m.seq) }), run: copier(`#${m.seq}`) },
    ],
  ]
}

export function versionsItems({ channel, go }: MenuContext, where: Where, name: string): MenuItem[] {
  const thread = docOf(channel, where)
  return thread && channel.docs?.[thread] ? [{ label: t("chat.menus.earlier.versions"), run: () => go({ to: "modal", modal: { kind: "versions", thread, name } }) }] : []
}

function hideItem(ctx: MenuContext, actions: Actions, where: Extract<Where, { kind: "room" | "dm" }>, name: string, open: boolean, keep = false): MenuItem {
  const key = hiddenKey(ctx.channel.code, where)
  const hidden = hiddenPlaces.get().includes(key)
  return {
    label: t(keep ? "chat.menus.keep.hidden" : hidden ? "chat.menus.show" : "chat.menus.hide", { name }),
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
      ...(room.unread > 0 ? [{ label: t("chat.menus.mark.read"), run: () => actions.markRead(channel.code, { kind: "room", room: room.id }) }] : []),
      { label: t(room.muted ? "chat.menus.unmute" : "chat.menus.mute", { room: room.name }), run: () => actions.setMute(channel.code, room.id, !room.muted) },
      ...(room.id === GENERAL_ROOM ? [] : [hideItem(ctx, actions, { kind: "room", room: room.id }, `#${room.name}`, open)]),
      ...(room.id === GENERAL_ROOM || hiddenPlaces.get().includes(hiddenKey(channel.code, { kind: "room", room: room.id }))
        ? []
        : [hideItem(ctx, actions, { kind: "room", room: room.id }, `#${room.name}`, open, true)]),
    ],
    versionsItems(ctx, { kind: "room", room: room.id }, `#${room.name}`),
    channel.youOwn || channel.youTrusted ? [{ label: t("chat.menus.room.settings"), run: () => go({ to: "modal", modal: { kind: "channel", tab: "rooms" } }) }] : [],
    room.members && canLeave
      ? [
          {
            label: t("chat.menus.leave", { room: room.name }),
            confirm: { title: t("chat.menus.leave.title", { room: room.name }), sub: t("chat.menus.leave.sub"), yes: t("chat.menus.leave.yes") },
            run: () => {
              actions.leaveRoom(channel.code, room.id)
              if (open) go({ to: "where", where: { kind: "room", room: GENERAL_ROOM } })
            },
          },
        ]
      : [],
    [{ label: t("chat.menus.copy.name"), run: copier(`#${room.name}`) }],
  ]
}

export function directGroups(ctx: MenuContext, actions: Actions, open: boolean, direct: { with: string; unread: number }, who: Person | undefined): MenuGroups {
  return [
    [
      ...(direct.unread > 0 ? [{ label: t("chat.menus.mark.read"), run: () => actions.markRead(ctx.channel.code, { kind: "dm", with: direct.with }) }] : []),
      hideItem(ctx, actions, { kind: "dm", with: direct.with }, t("chat.menus.conversation"), open),
    ],
    versionsItems(ctx, { kind: "dm", with: direct.with }, t("chat.menus.this.conversation")),
    who ? personItems(ctx, who).slice(0, 1) : [],
  ]
}
