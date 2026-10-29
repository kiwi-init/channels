import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { openFrom } from "../crypto.ts";
import { delegateStatement, delegationLive, readDelegation, type Delegation } from "../delegation.ts";
import { freeHandle, seededPick } from "../handles.ts";
import { signText, verify, verifyText, type Identity } from "../identity.ts";
import { inlineText, makeRecord, NAME_RE, nameKey, readRecord, RESERVED_NAMES, sealRecord, verifiedComputer, verifiedDevice, type JoinClaims, type Member, type MemberInfo } from "../membership.ts";
import { commitTo, ownerNonceStatement } from "../sas.ts";
import { delegatedRecord, type MemberRow } from "./info.ts";
import { requestInfo, unwrapKeys, wrapAllFor } from "./keys.ts";
import { callRelay, run } from "./relay.ts";

type Row = { id: string; pk: string; xpk: string; box: string; ts: number; commit: string; ownerNonce: string | null; reveal: string | null; sig: string; dbox: string; dsig: string };

interface Held {
  d: Delegation;
  keys: Record<string, string>;
  epoch: number;
}

const held = Effect.fn("Delegate.held")(function* (relay: string, roomId: string, ownerPk: string, machine: Identity) {
  const r = yield* callRelay<{ d: string; keys: Record<string, string>; epoch: number }>(relay, roomId, "/delegation", { identity: machine });
  const d = yield* Effect.promise(() => readDelegation(r.d, roomId, ownerPk));
  if (!d || d.delegate !== machine.pk || !delegationLive(d)) return null;
  const keys = yield* Effect.promise(() => unwrapKeys(machine, roomId, r.keys, ownerPk, true));
  return keys[String(r.epoch)] ? ({ d, keys, epoch: r.epoch } satisfies Held) : null;
});

const roster = Effect.fn("Delegate.roster")(function* (relay: string, roomId: string, ownerPk: string, machine: Identity, h: Held) {
  const { members } = yield* callRelay<{ members: MemberRow[] }>(relay, roomId, "/members", { identity: machine });
  const out: Member[] = [];
  for (const m of members) {
    const key = h.keys[String(m.e)];
    const read = key ? yield* Effect.promise(() => readRecord(key, m.rec, roomId, m.pk, ownerPk)) : null;
    const member = !read ? undefined : read.signer === ownerPk ? read.member : yield* Effect.promise(() => delegatedRecord(read, m.d, roomId, ownerPk));
    out.push(member ? { ...member, active: !!m.active } : { name: `unverified-${m.pk.slice(0, 6)}`, pk: m.pk, xpk: m.xpk, owner: false, at: 0, active: !!m.active, unverified: true });
  }
  return out;
});

async function ownAgent(roomId: string, r: Row, machine: Identity, d: Delegation): Promise<{ info: MemberInfo & JoinClaims; label: string } | null> {
  if (!(await verify({ room: roomId, pk: r.pk, xpk: r.xpk, box: r.box, ts: r.ts, commit: r.commit, sig: r.sig }))) return null;
  if (!(await verifyText(r.pk, r.dsig, delegateStatement(roomId, r.pk, machine.pk, r.dbox)))) return null;
  const raw = await openFrom(machine.xsk!, r.dbox, requestInfo(roomId));
  let info: MemberInfo & JoinClaims;
  try {
    info = JSON.parse(raw ?? "") as MemberInfo & JoinClaims;
  } catch {
    // A box that isn't JSON names nobody: the owner decides.
    return null;
  }
  if (!info || typeof info !== "object" || info.person || info.pin) return null;
  const computer = info.computer ? await verifiedComputer(roomId, r.pk, info.computer) : null;
  const device = !computer && info.device ? await verifiedDevice(roomId, r.pk, info.device) : null;
  const from = computer ? { pk: computer.pk, person: computer.person, label: computer.label } : device?.as === "computer" ? device : null;
  return from && from.pk === machine.pk && from.person === d.person ? { info, label: from.label } : null;
}

const delegateFx = {
  admitOwn: Effect.fn("Delegate.admitOwn")(function* (relay: string, roomId: string, ownerPk: string, machine: Identity) {
    if (!machine.xsk) return [];
    const h = yield* held(relay, roomId, ownerPk, machine).pipe(Effect.catchTag("RelayError", () => Effect.succeed(null)));
    if (!h) return [];
    const { requests } = yield* callRelay<{ requests: Row[] }>(relay, roomId, "/requests", { identity: machine }, { v: 2 });
    const admitted: Member[] = [];
    let members: Member[] | null = null;
    for (const r of requests) {
      const own = yield* Effect.promise(() => ownAgent(roomId, r, machine, h.d));
      if (!own) continue;
      const statement = ownerNonceStatement(roomId, r.pk, r.commit);
      if (!r.ownerNonce) {
        const nonce = yield* Effect.promise(() => signText(machine, statement));
        yield* Effect.ignore(callRelay(relay, roomId, `/requests/${r.id}/nonce`, { method: "POST", identity: machine, body: JSON.stringify({ nonce }) }));
        continue;
      }
      const reveal = r.reveal;
      if (!reveal || (yield* Effect.promise(() => commitTo(roomId, r.pk, reveal))) !== r.commit) continue;
      members ??= yield* roster(relay, roomId, ownerPk, machine, h);
      const owner = members.find((m) => m.owner);
      const asked = inlineText(own.info.name, 40);
      if (!owner || !NAME_RE.test(asked) || RESERVED_NAMES.has(nameKey(asked))) continue;
      const name = members.some((m) => nameKey(m.name) === nameKey(asked)) ? freeHandle(members, seededPick(r.pk)) : asked;
      const display = inlineText(own.info.display, 40);
      const info: MemberInfo = {
        name,
        kind: "agent",
        ...(display ? { display } : {}),
        sponsor: { user: h.d.person, name: owner.display ?? owner.name, handle: owner.name },
        from: { pk: machine.pk, label: own.label },
      };
      const rec = yield* Effect.promise(() => makeRecord(machine, roomId, { ...info, pk: r.pk, xpk: r.xpk }));
      const sealed = yield* Effect.promise(() => sealRecord(h.keys[String(h.epoch)]!, rec));
      const keys = yield* Effect.promise(() => wrapAllFor(machine, roomId, h.keys, r.pk, r.xpk));
      const ok = yield* Effect.exit(callRelay(relay, roomId, "/members", { method: "POST", identity: machine, body: JSON.stringify({ pk: r.pk, xpk: r.xpk, rec: sealed, keys, request: r.id }) }));
      if (!Exit.isSuccess(ok)) continue;
      const member: Member = { pk: r.pk, xpk: r.xpk, ...info, owner: false, at: rec.at, active: true, signedBy: machine.pk };
      members.push(member);
      admitted.push(member);
    }
    return admitted;
  }),
};

export function admitOwn(relay: string, roomId: string, ownerPk: string, machine: Identity): Promise<Member[]> {
  return run(delegateFx.admitOwn(relay, roomId, ownerPk, machine));
}
