import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { openFrom, sealTo } from "../crypto.ts";
import { readDelegation } from "../delegation.ts";
import { signText, verify, verifyText, type Identity } from "../identity.ts";
import type { ChannelCore } from "./core.ts";
import type { MemberRefusal } from "./errors.ts";
import type { Relay } from "./relay.ts";
import { keepHeld } from "./sealed.ts";

const keyInfo = (room: string, e: number | string) => `mc/key\n${room}\n${e}`;
export const requestInfo = (room: string) => `mc/request\n${room}`;

export async function ownerStatement(roomId: string, info: { ownerPk: string; ownerXpk: string; ownerSig: string }): Promise<"signed-keys" | "legacy" | null> {
  if (await verify({ room: roomId, pk: info.ownerPk, xpk: info.ownerXpk, v: 2, sig: info.ownerSig })) return "signed-keys";
  if (await verify({ room: roomId, pk: info.ownerPk, xpk: info.ownerXpk, sig: info.ownerSig })) return "legacy";
  return null;
}

export async function titlesSigned(roomId: string, ownerPk: string, titlesSig: string | null | undefined): Promise<boolean> {
  if (!titlesSig) return false;
  return verify({ room: roomId, pk: ownerPk, titles: "signed", sig: titlesSig });
}

const keyStatement = (room: string, e: number | string, memberPk: string, box: string) => `kiwi-key\n${room}\n${e}\n${memberPk}\n${box}`;

export async function wrapFor(owner: Identity, roomId: string, e: number | string, memberPk: string, memberXpk: string, key: string): Promise<string> {
  const box = await sealTo(memberXpk, key, keyInfo(roomId, e));
  return JSON.stringify({ box, sig: await signText(owner, keyStatement(roomId, e, memberPk, box)) });
}

export async function wrapAllFor(owner: Identity, roomId: string, keys: Record<string, string>, memberPk: string, memberXpk: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [e, k] of Object.entries(keys)) out[e] = await wrapFor(owner, roomId, e, memberPk, memberXpk, k);
  return out;
}

export async function unwrapKeys(id: Identity, roomId: string, wrapped: Record<string, string>, ownerPk: string, delegation?: unknown): Promise<Record<string, string>> {
  const delegate = delegation ? (await readDelegation(delegation, roomId, ownerPk))?.delegate : undefined;
  if (!id.xsk) throw new Error("identity has no exchange key");
  const out: Record<string, string> = {};
  for (const [e, w] of Object.entries(wrapped)) {
    if (!w.startsWith("{")) continue;
    let box: string | null = null;
    try {
      const parsed = JSON.parse(w) as { box?: unknown; sig?: unknown };
      if (typeof parsed.box === "string" && typeof parsed.sig === "string") {
        const statement = keyStatement(roomId, e, id.pk, parsed.box);
        if ((await verifyText(ownerPk, parsed.sig, statement)) || (delegate && (await verifyText(delegate, parsed.sig, statement)))) box = parsed.box;
      }
    } catch {
      // A wrapped key that isn't a signed box stays shut: nobody but the owner's signature opens one.
    }
    if (box === null) continue;
    const k = await openFrom(id.xsk, box, keyInfo(roomId, e));
    if (k) out[e] = k;
  }
  return out;
}

export interface KeysFx {
  refreshKeys(): Effect.Effect<void, MemberRefusal, Relay>;
}

export class ChannelKeys {
  private refreshing: Fiber.Fiber<void, MemberRefusal> | null = null;

  constructor(private readonly ch: ChannelCore) {}

  readonly fx: KeysFx = {
    refreshKeys: Effect.fn("Channel.refreshKeys")({ self: this }, function* (this: ChannelKeys) {
      let shared = this.refreshing;
      if (!shared) {
        const fiber = yield* Effect.forkDetach(this.fetchKeys());
        shared = this.refreshing = fiber;
        fiber.addObserver(() => {
          if (this.refreshing === fiber) this.refreshing = null;
        });
      }
      return yield* Fiber.join(shared);
    }),
  };

  private fetchKeys(): Effect.Effect<void, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const r = yield* this.ch.request<{ epoch: number; keys: Record<string, string>; delegation?: string }>("/keys");
      const keys = yield* Effect.promise(() => unwrapKeys(this.ch.identity, this.ch.roomId, r.keys, this.ch.access.ownerPk, r.delegation));
      this.ch.access = { ...this.ch.access, ...keepHeld(this.ch.access, { epoch: r.epoch, keys }) };
      this.ch.onAccess?.(this.ch.access);
    });
  }
}
