import { signRequest } from "@kiwi/core/auth.ts";
import { b64url, decodeJoinCode } from "@kiwi/core/crypto.ts";
import { PUSH_PATH, type PushRegistration } from "@kiwi/core/push.ts";

import type { ChannelIdentityView } from "../../desktop/src/bridge.ts";

interface PushTag {
  tag: string;
  code: string;
  label: string;
}

export interface PushSeatResult extends PushTag {
  ok: boolean;
  error?: string;
}

const newTag = (): string => b64url(crypto.getRandomValues(new Uint8Array(16)));

const roomOf = (seat: ChannelIdentityView): string | null => {
  if (seat.roomId) return seat.roomId;
  try {
    return seat.code ? decodeJoinCode(seat.code).roomId : null;
  } catch {
    // a seat whose code doesn't decode has no room to register with
    return null;
  }
};

export async function registerPush(relay: string, seats: readonly ChannelIdentityView[], token: string, sandbox: boolean, f: typeof fetch = fetch): Promise<PushSeatResult[]> {
  const ready = seats.filter((s) => s.code && s.access);
  return Promise.all(
    ready.map(async (seat): Promise<PushSeatResult> => {
      const tag = newTag();
      const base = { tag, code: seat.code!, label: seat.name ?? seat.label };
      const roomId = roomOf(seat);
      if (!roomId) return { ...base, ok: false, error: "no room" };
      const reg: PushRegistration = { platform: "apns", token, tag, ...(sandbox ? { sandbox: true } : {}) };
      const body = JSON.stringify(reg);
      try {
        const auth = await signRequest({ name: seat.idName ?? seat.label, pk: seat.pk, sk: seat.sk }, roomId, "PUT", PUSH_PATH, body);
        const res = await f(new URL(`/v1/rooms/${roomId}${PUSH_PATH}`, relay), { method: "PUT", body, headers: { "content-type": "application/json", authorization: `Bearer ${auth}` } });
        return res.ok ? { ...base, ok: true } : { ...base, ok: false, error: `the relay returned ${res.status}` };
      } catch (err) {
        return { ...base, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}
