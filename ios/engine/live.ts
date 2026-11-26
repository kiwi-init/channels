import { signRequest } from "@kiwi/core/auth.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import { LIVE_TOKEN_PATH, type LiveTokens } from "@kiwi/core/live.ts";

import type { ChannelIdentityView } from "../../desktop/src/bridge.ts";
import { roomOf } from "./push.ts";

export interface LiveTokenAsk {
  start?: string;
  update?: string;
  room?: string;
  sandbox: boolean;
}

export interface LiveTokenResult {
  room: string;
  ok: boolean;
  error?: string;
}

export interface LiveKeys {
  room: string;
  keys: string[];
}

const ready = (seats: readonly ChannelIdentityView[]) => seats.filter((s) => s.code && s.access);

async function call(relay: string, seat: ChannelIdentityView, roomId: string, method: "PUT" | "DELETE", body: string, f: typeof fetch): Promise<LiveTokenResult> {
  try {
    const auth = await signRequest({ name: seat.idName ?? seat.label, pk: seat.pk, sk: seat.sk }, roomId, method, LIVE_TOKEN_PATH, body);
    const headers: Record<string, string> = { authorization: `Bearer ${auth}` };
    if (body) headers["content-type"] = "application/json";
    const res = await f(new URL(`/v1/rooms/${roomId}${LIVE_TOKEN_PATH}`, relay), { method, headers, ...(body ? { body } : {}) });
    return res.ok ? { room: roomId, ok: true } : { room: roomId, ok: false, error: `the relay returned ${res.status}` };
  } catch (err) {
    return { room: roomId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function registerLive(relay: string, seats: readonly ChannelIdentityView[], ask: LiveTokenAsk, f: typeof fetch = fetch): Promise<LiveTokenResult[]> {
  const tokens: LiveTokens = { ...(ask.start ? { start: ask.start } : {}), ...(ask.update ? { update: ask.update } : {}), ...(ask.sandbox ? { sandbox: true } : {}) };
  if (!tokens.start && !tokens.update) return [];
  const body = JSON.stringify(tokens);
  const to = ready(seats).flatMap((seat) => {
    const roomId = roomOf(seat);
    return roomId && (!ask.update || ask.room === roomId) ? [{ seat, roomId }] : [];
  });
  return Promise.all(to.map(({ seat, roomId }) => call(relay, seat, roomId, "PUT", body, f)));
}

export async function unregisterLive(relay: string, seats: readonly ChannelIdentityView[], f: typeof fetch = fetch): Promise<LiveTokenResult[]> {
  const to = ready(seats).flatMap((seat) => {
    const roomId = roomOf(seat);
    return roomId ? [{ seat, roomId }] : [];
  });
  return Promise.all(to.map(({ seat, roomId }) => call(relay, seat, roomId, "DELETE", "", f)));
}

export function liveKeys(seats: readonly ChannelIdentityView[]): LiveKeys[] {
  return ready(seats).flatMap((seat) => {
    const roomId = roomOf(seat);
    const access = seat.access as Partial<ChannelAccess>;
    if (!roomId || !access.keys || typeof access.epoch !== "number") return [];
    const epochs = Object.keys(access.keys).sort((a, b) => Number(b) - Number(a));
    const all = access.keys;
    const keys = [all[String(access.epoch)], ...epochs.filter((e) => e !== String(access.epoch)).map((e) => all[e])].filter((k): k is string => !!k);
    return keys.length ? [{ room: roomId, keys }] : [];
  });
}
