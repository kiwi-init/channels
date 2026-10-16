import * as Effect from "effect/Effect";
import { encodeJoinCode, ownerFingerprint } from "../../crypto.ts";
import { verify } from "../../identity.ts";
import { BadRequest, Conflict, TooMany, Unauthorized, type ChannelGone } from "../failures.ts";
import { Policy } from "../policy.ts";
import { fits, SealedIcon } from "../schema.ts";
import { readMeta } from "./auth.ts";
import { RoomStore } from "./db.ts";
import type { DirectoryUpdate } from "./directory.ts";
import { putMember, type MemberBody } from "./members.ts";

export const create = Effect.fn("Room.create")(function* (signer: string | null, body: CreateBody, ownerUser: string | null = null) {
  const db = yield* RoomStore;
  if (db.exists()) return yield* new Conflict({ message: "channel already exists" });
  const { owner, members } = body;
  if (!owner || signer !== owner.pk) return yield* new Unauthorized({ message: "create must be signed by the owner" });
  const signed = yield* Effect.promise(
    async () =>
      (await verify({ room: db.roomId, pk: owner.pk, xpk: owner.xpk, v: 2, sig: owner.sig })) || (await verify({ room: db.roomId, pk: owner.pk, xpk: owner.xpk, sig: owner.sig })),
  );
  if (!signed) return yield* new BadRequest({ message: "bad owner signature" });
  if (!members?.some((m) => m.pk === owner.pk)) return yield* new BadRequest({ message: "the owner must be a member" });
  const most = (yield* Policy).membersPerChannel;
  if (most && new Set(members.map((m) => m.pk)).size > most) return yield* new TooMany({ message: `a channel may have at most ${most} members on this relay` });
  db.init();
  db.set("owner_pk", owner.pk);
  db.set("owner_xpk", owner.xpk);
  db.set("owner_sig", owner.sig);
  if (typeof owner.titlesSig === "string" && owner.titlesSig.length > 0 && owner.titlesSig.length < 200) db.set("titles_sig", owner.titlesSig);
  db.set("epoch", 0);
  db.set("created", Date.now());
  if (ownerUser) db.set("owner_user", ownerUser);
  db.changed("roster");
  db.changed("info");
  if (body.title && typeof body.title.iv === "string" && typeof body.title.ct === "string" && body.title.ct.length < 2048) db.set("title", JSON.stringify(body.title));
  for (const m of members) yield* putMember(m.pk === owner.pk ? { ...m, post: true } : m, 0);
});

export const setIcon = Effect.fn("Room.setIcon")(function* (icon: unknown) {
  const db = yield* RoomStore;
  const at = Date.now();
  if (icon === null) db.set("icon", "");
  else {
    if (!fits(SealedIcon, icon) || icon.e > (yield* readMeta).epoch) return yield* new BadRequest({ message: "bad icon (at most 32KB, sealed with a channel key)" });
    db.set("icon", JSON.stringify({ e: icon.e, iv: icon.iv, ct: icon.ct }));
  }
  db.set("icon_at", at);
  db.changed("info");
  return at;
});

const sealedUnder = (x: unknown, max: number): { iv: string; ct: string } | null => {
  const t = x as { iv?: unknown; ct?: unknown };
  return typeof t?.iv !== "string" || typeof t.ct !== "string" || t.ct.length === 0 || t.ct.length >= max ? null : { iv: t.iv, ct: t.ct };
};

export const setTitle = Effect.fn("Room.setTitle")(function* (title: unknown) {
  const db = yield* RoomStore;
  const t = sealedUnder(title, 2048);
  if (!t) return yield* new BadRequest({ message: "bad title" });
  db.set("title", JSON.stringify(t));
  db.changed("info");
});

export const setSettings = Effect.fn("Room.setSettings")(function* (settings: unknown) {
  const db = yield* RoomStore;
  const t = sealedUnder(settings, 16_384);
  if (!t) return yield* new BadRequest({ message: "bad settings" });
  db.set("settings", JSON.stringify(t));
  db.changed("info");
});

export const directory: Effect.Effect<DirectoryUpdate[], ChannelGone, RoomStore> = Effect.gen(function* () {
  const db = yield* RoomStore;
  const owner = db.ownerUser();
  if (!owner) return [];
  const { ownerPk } = yield* readMeta;
  const code = encodeJoinCode({ roomId: db.roomId, ownerFp: yield* Effect.promise(() => ownerFingerprint(ownerPk)) });
  const at = Number(db.get("created") ?? Date.now());
  return [{ user: owner, room: db.roomId, entry: { room: db.roomId, code, owner: true, member: true, agents: 0, at } }];
});

export interface CreateBody {
  title?: { iv: string; ct: string };
  owner: { pk: string; xpk: string; sig: string; titlesSig?: string };
  members: MemberBody[];
}
