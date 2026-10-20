import * as Effect from "effect/Effect";
import { open, seal, seenAt, type ChannelAccess, type SeenMark } from "../crypto.ts";
import { verify } from "../identity.ts";
import { Rejected } from "../refusals.ts";
import type { ChannelCore } from "./core.ts";
import type { Refused } from "./errors.ts";
import type { Info } from "./info.ts";
import type { Relay } from "./relay.ts";

export interface SealedBlob {
  e?: number;
  iv: string;
  ct: string;
}

export function newestEpoch(keys: Readonly<Record<string, string>>): number {
  return Math.max(
    0,
    ...Object.keys(keys)
      .filter((k) => String(Number(k)) === k)
      .map(Number)
      .filter((e) => Number.isSafeInteger(e) && e >= 0),
  );
}

export function keepHeld(held: Pick<ChannelAccess, "epoch" | "keys">, fetched: Pick<ChannelAccess, "epoch" | "keys">): Pick<ChannelAccess, "epoch" | "keys"> {
  const keys = { ...fetched.keys, ...held.keys };
  const named = Number.isSafeInteger(fetched.epoch) ? fetched.epoch : held.epoch;
  return { epoch: Math.max(held.epoch, Math.min(named, newestEpoch(keys))), keys };
}

export function openSealed(ch: ChannelCore, blob: SealedBlob): Effect.Effect<unknown, never, Relay> {
  return Effect.gen(function* () {
    const e = String(blob.e ?? 0);
    if (!ch.access.keys[e]) yield* ch.fx.refreshKeys().pipe(Effect.catchCause(() => Effect.void));
    const key = ch.access.keys[e];
    if (!key) return null;
    return yield* Effect.promise(() => open(key, ch.roomId, blob.iv, blob.ct).catch(() => null));
  });
}

export function ownerSigned(ch: ChannelCore, blob: SealedBlob, what: string): Effect.Effect<Record<string, unknown> | null, never, Relay> {
  return Effect.gen(function* () {
    const o = (yield* openSealed(ch, blob)) as Record<string, unknown> | null;
    if (!o || o.what !== what || o.room !== ch.roomId || o.pk !== ch.access.ownerPk || !(yield* Effect.promise(() => verify(o)))) return null;
    return o;
  });
}

export function signedAt(ch: ChannelCore, mark: SeenMark, current: unknown): number {
  return Math.max(Date.now(), seenAt(current) + 1, seenAt(ch.access[mark]) + 1);
}

export function noteSeen(ch: ChannelCore, mark: SeenMark, at: number): void {
  if (at <= seenAt(ch.access[mark])) return;
  const access: ChannelAccess = { ...ch.access };
  access[mark] = at;
  ch.access = access;
  ch.onAccess?.(ch.access);
}

export function notOlder(ch: ChannelCore, mark: SeenMark, at: unknown): boolean {
  const seen = seenAt(ch.access[mark]);
  if (at === undefined) return seen === 0;
  const dated = seenAt(at);
  if (!dated || dated < seen) return false;
  noteSeen(ch, mark, dated);
  return true;
}

export function freshInfo(ch: ChannelCore, forget: () => void): Effect.Effect<Info, Refused, Relay> {
  return Effect.gen(function* () {
    forget();
    const info = yield* ch.fx.info();
    if (!info.rotate || !ch.isOwner || ch.rotating) return info;
    yield* ch.fx.rotate();
    forget();
    return yield* ch.fx.info();
  });
}

export function sealFor(ch: ChannelCore, info: Pick<Info, "epoch" | "sealedEpoch">, payload: object, keepsEpoch = !!info.sealedEpoch): Effect.Effect<SealedBlob | null, Rejected, Relay> {
  return Effect.gen(function* () {
    if (info.epoch > newestEpoch(ch.access.keys)) yield* ch.fx.refreshKeys().pipe(Effect.catchCause(() => Effect.void));
    const e = newestEpoch(ch.access.keys);
    if (!keepsEpoch && e > 0) return yield* new Rejected("this relay can't keep the channel's name and settings from removed members: update it, or ask whoever runs it to");
    if (e < info.epoch) return yield* new Rejected("this device is missing the channel's newest key, so it won't seal the name or settings under an older one: try again in a moment");
    const key = ch.access.keys[String(e)];
    if (!key) return null;
    const sealed = yield* Effect.promise(() => seal(key, ch.roomId, payload));
    return keepsEpoch ? { e, ...sealed } : sealed;
  });
}

export function stale(info: Pick<Info, "sealedEpoch" | "title" | "settings">, keys: Readonly<Record<string, string>>): boolean {
  const newest = newestEpoch(keys);
  return !!info.sealedEpoch && [info.title, info.settings].some((blob) => !!blob && (blob.e ?? 0) < newest);
}
