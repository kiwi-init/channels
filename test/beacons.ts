import { signRequest } from "@kiwi/core/auth.ts";
import { seal, type ChannelAccess } from "@kiwi/core/crypto.ts";
import { sign, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION, WS_PROTOCOL, type Presence } from "@kiwi/core/protocol.ts";

export async function beaconFrame(access: ChannelAccess, id: Identity, fields: Partial<Presence> = {}, after: Partial<Presence> = {}): Promise<string> {
  const signed = await sign(id, { v: PROTOCOL_VERSION, type: "presence", from: id.name, client: "test", ts: Date.now(), ...fields } satisfies Presence);
  const e = access.epoch;
  const sealed = await seal(access.keys[String(e)]!, access.roomId, { ...signed, ...after, e });
  return JSON.stringify({ t: "eph", ...sealed });
}

export async function ephSocket(relay: string, roomId: string, id: Identity): Promise<{ send: (frame: string) => void; close: () => void }> {
  const auth = await signRequest(id, roomId, "GET", "/ws");
  const u = new URL(`/v1/rooms/${roomId}/ws`, relay);
  u.searchParams.set("presence", "0");
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(u, [WS_PROTOCOL, auth]);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onclose = (ev) => reject(new Error(`the relay closed the beacon socket: ${ev.code} ${ev.reason}`));
  });
  return { send: (frame) => ws.send(frame), close: () => ws.close(1000, "done") };
}
