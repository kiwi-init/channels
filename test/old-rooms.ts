import type { Channel } from "@kiwi/core/client.ts";
import { b64url, fromB64url, newChannelKey, newRoomId, seal, sealTo } from "@kiwi/core/crypto.ts";
import { sign, type Identity } from "@kiwi/core/identity.ts";
import { PROTOCOL_VERSION } from "@kiwi/core/protocol.ts";
import type { RoomMeta, RoomSeal } from "@kiwi/core/room-rules.ts";

export type OldPick = { name: string; pk: string; xpk: string };

const enc = new TextEncoder();
const boxInfo = (channel: string, id: string, n: number): string => `mc/room/${channel}/${id}/${n}`;
const bound = (channel: string, id: string, n: number): string => `${channel}/room/${id}/${n}`;
const digest = (channel: string, s: Omit<RoomSeal, "proof">): Uint8Array<ArrayBuffer> =>
  new Uint8Array(enc.encode(JSON.stringify(["kiwi-room-seal", channel, s.id, s.n, [...s.keys].sort(), s.meta.iv, s.meta.ct])));
const hmac = (key: string): Promise<CryptoKey> => crypto.subtle.importKey("raw", fromB64url(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const prove = async (channel: string, s: Omit<RoomSeal, "proof">, key: string): Promise<RoomSeal> => ({
  ...s,
  proof: b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmac(key), digest(channel, s)))),
});

export class OldRoom {
  readonly id = newRoomId();
  n = 0;
  key = "";
  meta: RoomMeta = { name: "", members: [] };
  private keys: string[] = [];

  constructor(
    private readonly ch: Channel,
    private readonly channel: string,
  ) {}

  async seal(name: string, who: readonly OldPick[], extra: Pick<RoomMeta, "dm" | "self"> = {}): Promise<number> {
    const replaces = this.n ? this.key : undefined;
    this.n++;
    this.key = newChannelKey();
    this.meta = { name, members: who.map(({ name, pk }) => ({ name, pk })), ...extra };
    this.keys = (await Promise.all(who.map((w) => sealTo(w.xpk, this.key, boxInfo(this.channel, this.id, this.n))))).sort();
    const sealed = { id: this.id, n: this.n, keys: this.keys, meta: await seal(this.key, bound(this.channel, this.id, this.n), replaces ? { ...this.meta, prev: replaces } : this.meta) };
    const ev = replaces ? await prove(this.channel, sealed, replaces) : sealed;
    return this.ch.send("made a private room", { kind: "event", ev: { op: "room.seal", ...ev } });
  }

  async add(who: readonly OldPick[]): Promise<number> {
    this.meta = { ...this.meta, members: who.map(({ name, pk }) => ({ name, pk })) };
    this.keys = (await Promise.all(who.map((w) => sealTo(w.xpk, this.key, boxInfo(this.channel, this.id, this.n))))).sort();
    return this.rename(this.meta.name);
  }

  async rename(name: string): Promise<number> {
    this.meta = { ...this.meta, name };
    const sealed = { id: this.id, n: this.n, keys: this.keys, meta: await seal(this.key, bound(this.channel, this.id, this.n), this.meta) };
    return this.ch.send("changed a private room", { kind: "event", ev: { op: "room.seal", ...(await prove(this.channel, sealed, this.key)) } });
  }

  async letter(from: Identity, body: string): Promise<number> {
    const inner = await sign(from, { v: PROTOCOL_VERSION, id: crypto.randomUUID(), from: from.name, kind: "msg" as const, body, room: this.id, ts: Date.now() });
    const letter = { room: this.id, n: this.n, ...(await seal(this.key, bound(this.channel, this.id, this.n), inner)) };
    return this.ch.send("A message in a private room. Update Kiwi to read it.", { kind: "event", ev: { op: "room.msg", ...letter } });
  }
}
