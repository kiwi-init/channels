import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import type { ChannelIdentityView, ChannelView, PublicAccess } from "./bridge.ts";

const str = (v: unknown): v is string => typeof v === "string";

export function publicAccess(a: unknown): PublicAccess | undefined {
  if (!a || typeof a !== "object") return undefined;
  const x = a as Partial<ChannelAccess>;
  if (!str(x.roomId) || !str(x.ownerPk) || !str(x.ownerXpk) || typeof x.epoch !== "number") return undefined;
  return { roomId: x.roomId, ownerPk: x.ownerPk, ownerXpk: x.ownerXpk, epoch: x.epoch, ...(x.signedKeys ? { signedKeys: true } : {}), ...(x.signedTitle ? { signedTitle: true } : {}) };
}

export function publicChannel(c: ChannelIdentityView): ChannelView {
  const access = publicAccess(c.access);
  return {
    label: c.label,
    pk: c.pk,
    ...(c.xpk !== undefined ? { xpk: c.xpk } : {}),
    ...(c.roomId !== undefined ? { roomId: c.roomId } : {}),
    ...(c.code !== undefined ? { code: c.code } : {}),
    ...(c.idName !== undefined ? { idName: c.idName } : {}),
    ...(c.name !== undefined ? { name: c.name } : {}),
    ...(access ? { access } : {}),
    ...(c.at !== undefined ? { at: c.at } : {}),
    ...(c.requestId !== undefined ? { requestId: c.requestId } : {}),
    ...(c.relay !== undefined ? { relay: c.relay } : {}),
  };
}
