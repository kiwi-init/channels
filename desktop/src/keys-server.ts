import type { PresenceFields } from "@kiwi/core/client.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import type { JoinClaims } from "@kiwi/core/membership.ts";
import type { ChannelIdentityView, KeysPush, KeysReply } from "./bridge.ts";
import { isCall, wireError, type Keyring } from "./keyring.ts";
import { fromWire, toWire } from "./wire.ts";

const text = (v: unknown): string => {
  if (typeof v !== "string") throw new Error("bad request");
  return v;
};

const count = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new Error("bad request");
  return v;
};

function meOf(v: unknown): { name: string } | null {
  if (v === null || v === undefined) return null;
  return { name: text((v as { name?: unknown }).name) };
}

export interface KeysSession {
  handle(raw: unknown): Promise<KeysReply | null>;
  close(): void;
}

export function serveKeys(k: Keyring, push: (p: KeysPush) => void): KeysSession {
  const subs = new Map<number, () => void>();
  const run = async (r: Record<string, unknown>, id: number): Promise<unknown> => {
    switch (r.op) {
      case "call": {
        if (!isCall(r.name)) throw new Error("no such call");
        const args = fromWire(r.args);
        if (!Array.isArray(args)) throw new Error("bad request");
        return k.callRaw(text(r.code), r.name, args);
      }
      case "create":
        return k.create(text(r.name), r.token === null ? null : text(r.token), meOf(r.me));
      case "requestJoin":
        return k.requestJoin(text(r.code), text(r.name));
      case "joinStatus":
        return k.joinStatus(text(r.code));
      case "forget":
        return k.forget(text(r.code));
      case "presence": {
        const p = fromWire(r.p);
        if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("bad request");
        return k.presence(text(r.code), p as PresenceFields);
      }
      case "openRows": {
        const rows = fromWire(r.rows);
        return k.openRows(text(r.code), Array.isArray(rows) ? rows : []);
      }
      case "olderRows":
        return k.olderRows(text(r.code), Number(r.before), Number(r.limit));
      case "keep": {
        const state = fromWire(r.state);
        if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("bad request");
        return k.keep(text(r.code), state);
      }
      case "openKept":
        return k.openKept(text(r.code), fromWire(r.sealed));
      case "follow": {
        const stop = k.follow(text(r.code), count(r.since), (event) => push({ sub: id, event: toWire(event) }), { watch: r.watch === true });
        subs.set(id, stop);
        return id;
      }
      case "nudge":
        k.nudge();
        return null;
      case "unfollow": {
        const sub = count(r.sub);
        subs.get(sub)?.();
        subs.delete(sub);
        return null;
      }
      default:
        throw new Error("bad request");
    }
  };
  return {
    handle: async (raw) => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      if (typeof r.id !== "number") return null;
      const id = r.id;
      try {
        return { id, ok: true, value: toWire(await run(r, id)) };
      } catch (e) {
        return { id, ok: false, error: wireError(e) };
      }
    },
    close: () => {
      for (const stop of subs.values()) stop();
      subs.clear();
    },
  };
}

export type HostToKeys =
  | { type: "init"; relay: string; dir: string; seats: ChannelIdentityView[]; person: string | null; mine: string[] }
  | { type: "seats"; seats: ChannelIdentityView[]; person: string | null; mine: string[] }
  | { type: "flush" }
  | { type: "relay"; relay: string }
  | { type: "nudge" }
  | { type: "port" }
  | { type: "done"; id: number; error?: string; claim?: JoinClaims | null; token?: string | null };

export type KeysToHost =
  | { type: "save"; id: number; entry: ChannelIdentityView }
  | { type: "access"; id: number; code: string; pk: string; access: ChannelAccess }
  | { type: "forget"; id: number; code: string }
  | { type: "prove"; id: number; code: string; memberPk: string }
  | { type: "githubToken"; id: number }
  | { type: "flushed"; id: 0 };
