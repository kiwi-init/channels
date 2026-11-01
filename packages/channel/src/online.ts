import { opsVersion, type Activity, type Presence, type Reach } from "@kiwi/core/protocol.ts";
import { isWakeVia, wakesInSession } from "@kiwi/core/wake.ts";
import { howHere } from "./presence.ts";

export const PRESENCE_TTL = 150_000;

export interface Online {
  from: string;
  client: string;
  at: number;
  pk: string;
  activity?: Activity;
  reach?: Reach;
  ops?: number;
  wakes: boolean;
}

export function hear(heard: ReadonlyMap<string, Online>, p: Presence & { sigOk: boolean }, at: number): ReadonlyMap<string, Online> {
  if (p.client === "probe" || !p.sigOk || !p.pk) return heard;
  const next = new Map([...heard].filter(([, o]) => at - o.at < PRESENCE_TTL));
  return next.set(p.pk, {
    from: p.from,
    client: p.client,
    at,
    pk: p.pk,
    ...(p.activity ? { activity: p.activity } : {}),
    ...(p.reach ? { reach: p.reach } : {}),
    ...(opsVersion(p.ops) ? { ops: p.ops } : {}),
    wakes: isWakeVia(p.wake) && !wakesInSession(p.wake),
  });
}

export function onlineByName(heard: ReadonlyMap<string, Online>, keyOf: ReadonlyMap<string, string>, now: number): Map<string, Online> {
  return new Map([...heard].filter(([pk, o]) => keyOf.get(o.from) === pk && now - o.at < PRESENCE_TTL && howHere(o) !== null).map(([, o]) => [o.from, o]));
}
