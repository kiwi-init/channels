import * as Effect from "effect/Effect";
import { MAX_SECRET_BOX, MAX_SECRET_BYTES, MAX_SECRETS } from "@kiwi/core/secrets.ts";
import { BadRequest, TooLarge, TooMany } from "../failures.ts";
import { RoomStore } from "./db.ts";

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

export const putSecret = Effect.fn("Room.putSecret")(function* (id: string, boxes: unknown) {
  const db = yield* RoomStore;
  const copies = boxes && typeof boxes === "object" && !Array.isArray(boxes) ? Object.entries(boxes as Record<string, unknown>) : [];
  if (!copies.length || copies.some(([pk, box]) => !KEY_RE.test(pk) || typeof box !== "string" || !box))
    return yield* new BadRequest({ message: "send the secret's sealed copies, one per member key" });
  const sealed = copies as [string, string][];
  if (sealed.some(([, box]) => box.length > MAX_SECRET_BOX)) return yield* new TooLarge({ message: "a sealed secret is too large" });
  if (sealed.some(([pk]) => !db.isMember(pk))) return yield* new BadRequest({ message: "a secret goes only to members" });
  if (!db.hasSecret(id) && db.secretCount() >= MAX_SECRETS) return yield* new TooMany({ message: `this channel keeps ${MAX_SECRETS} secrets, the most a channel may; delete one to add another` });
  if (db.secretBytesBesides(id) + sealed.reduce((n, [, box]) => n + box.length, 0) > MAX_SECRET_BYTES)
    return yield* new TooLarge({ message: "this channel's secrets fill all the room it has for them; delete one, or give it to fewer agents" });
  return { held: db.putSecret(id, sealed, Date.now()) };
});
