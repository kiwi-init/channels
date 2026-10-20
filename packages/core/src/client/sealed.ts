import * as Effect from "effect/Effect";
import { open, seal } from "../crypto.ts";
import { Rejected } from "../refusals.ts";
import type { ChannelCore } from "./core.ts";
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

export function openSealed(ch: ChannelCore, blob: SealedBlob): Effect.Effect<unknown, never, Relay> {
  return Effect.gen(function* () {
    const e = String(blob.e ?? 0);
    if (!ch.access.keys[e]) yield* ch.fx.refreshKeys().pipe(Effect.catchCause(() => Effect.void));
    const key = ch.access.keys[e];
    if (!key) return null;
    return yield* Effect.promise(() => open(key, ch.roomId, blob.iv, blob.ct).catch(() => null));
  });
}

export function sealFor(ch: ChannelCore, info: Pick<Info, "epoch" | "sealedEpoch">, payload: object): Effect.Effect<SealedBlob | null, Rejected, Relay> {
  return Effect.gen(function* () {
    if (info.epoch > newestEpoch(ch.access.keys)) yield* ch.fx.refreshKeys().pipe(Effect.catchCause(() => Effect.void));
    const e = newestEpoch(ch.access.keys);
    if (!info.sealedEpoch && e > 0) return yield* new Rejected("this relay can't keep the channel's name and settings from removed members: update it, or ask whoever runs it to");
    if (e < info.epoch) return yield* new Rejected("this device is missing the channel's newest key, so it won't seal the name or settings under an older one: try again in a moment");
    const key = ch.access.keys[String(e)];
    if (!key) return null;
    const sealed = yield* Effect.promise(() => seal(key, ch.roomId, payload));
    return info.sealedEpoch ? { e, ...sealed } : sealed;
  });
}

export function stale(info: Pick<Info, "sealedEpoch" | "title" | "settings">, keys: Readonly<Record<string, string>>): boolean {
  const newest = newestEpoch(keys);
  return !!info.sealedEpoch && [info.title, info.settings].some((blob) => !!blob && (blob.e ?? 0) < newest);
}
