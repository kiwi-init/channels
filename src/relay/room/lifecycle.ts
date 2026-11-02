import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { encodeJoinCode, ownerFingerprint } from "@kiwi/core/crypto.ts";
import { verify } from "@kiwi/core/identity.ts";
import { BadRequest, Conflict, TooLarge, TooMany, Unauthorized, type ChannelGone } from "../failures.ts";
import { Policy } from "../policy.ts";
import { fits, SealedIcon, SealedSnapshot } from "../schema.ts";
import { readMeta } from "./auth.ts";
import { RoomStore } from "./db.ts";
import type { DirectoryUpdate } from "./directory.ts";
import { formatBytes } from "./limits.ts";
import { memberFits, putMember, type MemberBody } from "./members.ts";

export const create = Effect.fn("Room.create")(function* (signer: string | null, body: CreateBody, ownerUser: string | null = null) {
  const db = yield* RoomStore;
  if (db.exists()) return yield* new Conflict({ message: "channel already exists" });
  const { owner, members } = body;
  if (!owner || signer !== owner.pk) return yield* new Unauthorized({ message: "create must be signed by the owner" });
  const signed = yield* Effect.promise(
    async () => (await verify({ room: db.roomId, pk: owner.pk, xpk: owner.xpk, v: 2, sig: owner.sig })) || (await verify({ room: db.roomId, pk: owner.pk, xpk: owner.xpk, sig: owner.sig })),
  );
  if (!signed) return yield* new BadRequest({ message: "bad owner signature" });
  if (!members?.some((m) => m.pk === owner.pk)) return yield* new BadRequest({ message: "the owner must be a member" });
  const most = (yield* Policy).membersPerChannel;
  if (most && new Set(members.map((m) => m.pk)).size > most) return yield* new TooMany({ message: `a channel may have at most ${most} members on this relay` });
  if (!members.every((m) => memberFits(m.pk === owner.pk ? { ...m, post: true } : m, 0))) return yield* new BadRequest({ message: "bad member" });
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
    const { epoch } = yield* readMeta;
    if (!fits(SealedIcon, icon) || icon.e > epoch) return yield* new BadRequest({ message: "bad icon (at most 32KB, sealed with a channel key)" });
    if (icon.e < epoch) return yield* new BadRequest({ message: "the icon was sealed with an older channel key than this channel's: update Channels and try again" });
    db.set("icon", JSON.stringify({ e: icon.e, iv: icon.iv, ct: icon.ct }));
  }
  db.set("icon_at", at);
  db.changed("info");
  return at;
});

const sealedUnder = (x: unknown, max: number): { e?: number; iv: string; ct: string } | null => {
  const t = x as { e?: unknown; iv?: unknown; ct?: unknown };
  if (typeof t?.iv !== "string" || typeof t.ct !== "string" || t.ct.length === 0 || t.ct.length >= max) return null;
  if (t.e === undefined) return { iv: t.iv, ct: t.ct };
  return typeof t.e === "number" && Number.isSafeInteger(t.e) && t.e >= 0 ? { e: t.e, iv: t.iv, ct: t.ct } : null;
};

const sealedAt = Effect.fn("Room.sealedAt")(function* (x: unknown, max: number) {
  const t = sealedUnder(x, max);
  if (!t) return { why: "shape" as const };
  const { epoch } = yield* readMeta;
  const e = t.e ?? 0;
  return e > epoch ? { why: "ahead" as const } : e < epoch ? { why: "behind" as const } : { why: null, sealed: t };
});

export const setTitle = Effect.fn("Room.setTitle")(function* (title: unknown) {
  const db = yield* RoomStore;
  const t = yield* sealedAt(title, 2048);
  if (t.why === "shape") return yield* new BadRequest({ message: "bad title" });
  if (t.why === "ahead") return yield* new BadRequest({ message: "bad title (sealed with a channel key this channel doesn't have)" });
  if (t.why === "behind") return yield* new BadRequest({ message: "the title was sealed with an older channel key than this channel's: update Channels and try again" });
  db.set("title", JSON.stringify(t.sealed));
  db.changed("info");
});

export const setSettings = Effect.fn("Room.setSettings")(function* (settings: unknown) {
  const db = yield* RoomStore;
  const t = yield* sealedAt(settings, 16_384);
  if (t.why === "shape") return yield* new BadRequest({ message: "bad settings" });
  if (t.why === "ahead") return yield* new BadRequest({ message: "bad settings (sealed with a channel key this channel doesn't have)" });
  if (t.why === "behind") return yield* new BadRequest({ message: "the settings were sealed with an older channel key than this channel's: update Channels and try again" });
  db.set("settings", JSON.stringify(t.sealed));
  db.changed("info");
});

export const setSnapshot = Effect.fn("Room.setSnapshot")(function* (snapshot: unknown) {
  const db = yield* RoomStore;
  const { epoch } = yield* readMeta;
  if (!fits(SealedSnapshot, snapshot) || snapshot.e > epoch || snapshot.n > db.head()) {
    return yield* new BadRequest({ message: "bad snapshot (at most 512KB, sealed with a channel key, at a seq the channel has)" });
  }
  const stored = db.snapshot();
  if (stored && snapshot.n < stored.n) return yield* new Conflict({ message: `this channel has a newer snapshot (#${stored.n})` });
  const cap = (yield* Policy).bytesPerChannel;
  if (snapshot.ct.length > cap) return yield* new TooLarge({ message: `that snapshot is bigger than this channel may hold (${formatBytes(cap)})` });
  const grows = snapshot.ct.length - (stored?.ct.length ?? 0);
  let bytes = db.storedBytes();
  if (bytes + grows > cap) {
    if (bytes + grows - db.bytesThrough(snapshot.n) > cap) return yield* new TooLarge({ message: "the messages that snapshot covers don't free enough room for it" });
    bytes -= db.dropOldest(bytes + grows - cap, snapshot.n);
  }
  const { n, e, iv, ct, hash, sig } = snapshot;
  db.setSnapshot({ n, e, iv, ct, hash, sig, at: yield* Clock.currentTimeMillis });
  db.setCounters({ ...(db.counters() ?? { day: "", n: 0 }), bytes: Math.max(0, bytes + grows) });
  return n;
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

export const reown = (from: string, to: string): Effect.Effect<DirectoryUpdate[], ChannelGone, RoomStore> =>
  Effect.gen(function* () {
    const db = yield* RoomStore;
    if (!db.exists() || db.isLegacy()) return [];
    const owner = db.ownerUser();
    if (owner !== from && owner !== to) return [];
    db.set("owner_user", to);
    return [{ user: from, room: db.roomId, entry: null }, ...(yield* directory)];
  });

export interface CreateBody {
  title?: { iv: string; ct: string };
  owner: { pk: string; xpk: string; sig: string; titlesSig?: string };
  members: MemberBody[];
}
