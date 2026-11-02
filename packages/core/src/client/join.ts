import * as Effect from "effect/Effect";
import { decodeJoinCode, encodeJoinCode, newChannelKey, newRoomId, ownerFingerprint, seal, sealTo, type ChannelAccess } from "../crypto.ts";
import { delegateStatement, readDelegation } from "../delegation.ts";
import { readDeviceList } from "../devices.ts";
import { sign, signText, verifyText, type Identity } from "../identity.ts";
import { makeRecord, sealRecord, type JoinClaims, type MemberInfo } from "../membership.ts";
import { MissingKey } from "../refusals.ts";
import { commitTo, joinCheckCode, joinNonce, ownerNonceStatement } from "../sas.ts";
import { canPost, scopesOf } from "../scopes.ts";
import type { Refusal } from "./errors.ts";
import type { Info } from "./info.ts";
import { ownerStatement, requestInfo, unwrapKeys, wrapFor } from "./keys.ts";
import { callRelay, type Relay } from "./relay.ts";
import { keepHeld } from "./sealed.ts";

const pinnedInfo = Effect.fn("Channel.pinnedInfo")(function* (relay: string, code: string) {
  const { roomId, ownerFp } = decodeJoinCode(code);
  const info = yield* callRelay<Info>(relay, roomId, "/info", {}, { fp: ownerFp });
  if ((yield* Effect.promise(() => ownerFingerprint(info.ownerPk))) !== ownerFp) throw new Error("this relay is serving a different owner than the join code names; refusing");
  const statement = yield* Effect.promise(() => ownerStatement(roomId, info));
  if (statement === "legacy") throw new Error("this channel was made before channel keys were signed: its owner's app upgrades it the first time it opens, and nothing joins it until then");
  if (!statement) throw new Error("the channel owner's keys aren't signed; refusing");
  return { roomId, ownerFp, info, signedKeys: statement === "signed-keys" };
});

async function computerOf(claims?: JoinClaims): Promise<{ pk: string; xpk: string } | null> {
  if (claims?.computer) return { pk: claims.computer.cert.machine, xpk: claims.computer.cert.mxpk };
  if (!claims?.device || claims.person) return null;
  const read = await readDeviceList(claims.device.links);
  const d = read.ok ? read.list.devices.find((x) => x.device === claims.device!.device && x.as === "computer") : undefined;
  return d ? { pk: d.device, xpk: d.dxpk } : null;
}

async function delegateNonce(roomId: string, ownerPk: string, delegation: unknown, nonce: string, statement: string): Promise<boolean> {
  const d = delegation ? await readDelegation(delegation, roomId, ownerPk) : null;
  return !!d && (await verifyText(d.delegate, nonce, statement));
}

export type JoinStatus = { status: "pending"; code: string | null } | { status: "denied" } | { status: "approved"; access: ChannelAccess };

export const joinFx = {
  create: Effect.fn("Channel.create")(function* (
    relay: string,
    owner: Identity,
    ownerInfo: MemberInfo,
    agents: (Identity & { info: MemberInfo })[] = [],
    roomId: string = newRoomId(),
    human?: string | null,
    title?: string,
  ) {
    if (!owner.xpk) return yield* new MissingKey("owner identity has no exchange key");
    const xpk = owner.xpk;
    const key = newChannelKey();
    const ownerSig = yield* Effect.promise(() => sign(owner, { room: roomId, xpk, v: 2 }));
    const titlesSig = yield* Effect.promise(() => sign(owner, { room: roomId, titles: "signed" }));
    const enroll = async (id: Identity, info: MemberInfo, isOwner: boolean) => ({
      pk: id.pk,
      xpk: id.xpk!,
      rec: await sealRecord(key, await makeRecord(owner, roomId, { ...info, pk: id.pk, xpk: id.xpk!, owner: isOwner })),
      keys: { "0": await wrapFor(owner, roomId, 0, id.pk, id.xpk!, key) },
      ...(!isOwner && !canPost(scopesOf(info)) ? { post: false } : {}),
    });
    const members = yield* Effect.promise(async () => [await enroll(owner, ownerInfo, true), ...(await Promise.all(agents.map((a) => enroll(a, a.info, false))))]);
    const sealedTitle = title ? yield* Effect.promise(async () => seal(key, roomId, await sign(owner, { what: "channel-title", room: roomId, name: title.slice(0, 80), at: Date.now() }))) : undefined;
    yield* callRelay(relay, roomId, "/create", {
      method: "POST",
      identity: owner,
      human,
      body: JSON.stringify({ owner: { pk: owner.pk, xpk, sig: ownerSig.sig, titlesSig: titlesSig.sig }, members, ...(sealedTitle ? { title: sealedTitle } : {}) }),
    });
    const access: ChannelAccess = { roomId, ownerPk: owner.pk, ownerXpk: xpk, epoch: 0, keys: { "0": key }, signedKeys: true };
    return { code: encodeJoinCode({ roomId, ownerFp: yield* Effect.promise(() => ownerFingerprint(owner.pk)) }), access };
  }),

  requestJoin: Effect.fn("Channel.requestJoin")(function* (relay: string, code: string, id: Identity, info: MemberInfo, claims?: JoinClaims) {
    const { roomId, ownerFp, info: room } = yield* pinnedInfo(relay, code);
    if (!id.xpk) return yield* new MissingKey("identity has no exchange key");
    const xpk = id.xpk;
    const sealed = JSON.stringify({ ...info, ...claims });
    const box = yield* Effect.promise(() => sealTo(room.ownerXpk, sealed, requestInfo(roomId)));
    const commit = yield* Effect.promise(async () => commitTo(roomId, id.pk, await joinNonce(id, roomId)));
    const body = yield* Effect.promise(() => sign(id, { room: roomId, xpk, box, ts: Date.now(), commit }));
    const computer = yield* Effect.promise(() => computerOf(claims));
    const toComputer = computer
      ? yield* Effect.promise(async () => {
          const dbox = await sealTo(computer.xpk, sealed, requestInfo(roomId));
          return { dpk: computer.pk, dbox, dsig: await signText(id, delegateStatement(roomId, id.pk, computer.pk, dbox)) };
        })
      : {};
    const { id: requestId } = yield* callRelay<{ id: string }>(relay, roomId, "/requests", { method: "POST", body: JSON.stringify({ ...body, ...toComputer }) }, { fp: ownerFp });
    return { roomId, requestId, ownerPk: room.ownerPk, computer: computer?.pk ?? null };
  }),

  joinStatus: Effect.fn("Channel.joinStatus")(function* (relay: string, code: string, id: Identity, requestId: string): Effect.fn.Return<JoinStatus, Refusal, Relay> {
    const { roomId, info, signedKeys } = yield* pinnedInfo(relay, code);
    const r = yield* callRelay<{ status: string; ownerNonce?: string | null; revealed?: boolean; epoch?: number; keys?: Record<string, string>; delegation?: string }>(
      relay,
      roomId,
      `/requests/${requestId}`,
      { identity: id },
    );
    if (r.status === "denied") return { status: "denied" };
    if (r.status !== "approved") {
      const ownerNonce = r.ownerNonce;
      if (!ownerNonce) return { status: "pending", code: null };
      const nonce = yield* Effect.promise(() => joinNonce(id, roomId));
      const statement = yield* Effect.promise(async () => ownerNonceStatement(roomId, id.pk, await commitTo(roomId, id.pk, nonce)));
      if (!(yield* Effect.promise(async () => (await verifyText(info.ownerPk, ownerNonce, statement)) || (await delegateNonce(roomId, info.ownerPk, r.delegation, ownerNonce, statement))))) {
        throw new Error("the relay passed on an owner signature that doesn't check out: don't let the owner approve this request, and tell them");
      }
      if (!r.revealed) yield* callRelay(relay, roomId, `/requests/${requestId}/reveal`, { method: "POST", identity: id, body: JSON.stringify({ nonce }) });
      return { status: "pending", code: yield* Effect.promise(() => joinCheckCode(roomId, id.pk, ownerNonce, nonce)) };
    }
    const keys = yield* Effect.promise(() => unwrapKeys(id, roomId, r.keys ?? {}, info.ownerPk, r.delegation));
    return { status: "approved", access: { roomId, ownerPk: info.ownerPk, ownerXpk: info.ownerXpk, ...keepHeld({ epoch: 0, keys: {} }, { epoch: r.epoch ?? 0, keys }), signedKeys } };
  }),

  resume: Effect.fn("Channel.resume")(function* (relay: string, code: string, id: Identity) {
    const { roomId, info, signedKeys } = yield* pinnedInfo(relay, code);
    const r = yield* callRelay<{ epoch: number; keys: Record<string, string>; delegation?: string }>(relay, roomId, "/keys", { identity: id });
    const keys = yield* Effect.promise(() => unwrapKeys(id, roomId, r.keys, info.ownerPk, r.delegation));
    const access: ChannelAccess = { roomId, ownerPk: info.ownerPk, ownerXpk: info.ownerXpk, ...keepHeld({ epoch: 0, keys: {} }, { epoch: r.epoch, keys }), signedKeys };
    return access;
  }),
};
