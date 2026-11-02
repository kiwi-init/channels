import * as Effect from "effect/Effect";
import { delegateStatement } from "@kiwi/core/delegation.ts";
import { verify, verifyText } from "@kiwi/core/identity.ts";
import { commitTo, NONCE_RE, ownerNonceStatement } from "@kiwi/core/sas.ts";
import { BadRequest, Conflict, Denied, NotFound, Removed, TooLarge, TooMany, UpdateRequired } from "../failures.ts";
import { fits, JoinRequest } from "../schema.ts";
import { readMeta, UPDATE_KIWI } from "./auth.ts";
import { RoomStore } from "./db.ts";
import { MAX_PENDING, REQUEST_TTL_MS } from "./limits.ts";
import { liveDelegation } from "./delegations.ts";
import { keysFor } from "./members.ts";

export const request = Effect.fn("Room.request")(function* (body: RequestBody) {
  const db = yield* RoomStore;
  yield* readMeta;
  db.migrate();
  const { pk, xpk, box, ts, sig, commit } = body ?? ({} as RequestBody);
  if (typeof commit !== "string") return yield* new UpdateRequired({ message: UPDATE_KIWI });
  if (!fits(JoinRequest, body)) return yield* new BadRequest({ message: "bad request" });
  if (box.length > 4096) return yield* new TooLarge({ message: "request too large" });
  if (!(yield* Effect.promise(() => verify({ room: db.roomId, pk, xpk, box, ts, commit, sig })))) return yield* new BadRequest({ message: "bad request signature" });
  if (Math.abs(Date.now() - ts) > REQUEST_TTL_MS) return yield* new BadRequest({ message: "request timestamp out of range" });
  const toDelegate = yield* delegateBox(db.roomId, body);
  if (db.isMember(pk)) return yield* new Conflict({ message: "already a member" });
  db.sql.run("DELETE FROM requests WHERE COALESCE(received, ts) < ?", Date.now() - REQUEST_TTL_MS);
  const existing = db.sql.all<{ id: string; status: string }>("SELECT id, status FROM requests WHERE pk = ?", pk)[0];
  if (existing?.status === "denied") return yield* new Denied({ message: "this key was denied" });
  if (db.sql.all("SELECT 1 FROM members WHERE pk = ? AND active = 0", pk).length) return yield* new Removed({ message: "this key was removed; join with a new identity" });
  if (existing) {
    db.sql.run(
      "UPDATE requests SET commit_to = ?, box = ?, sig = ?, ts = ?, owner_nonce = NULL, reveal = NULL, dpk = ?, dbox = ?, dsig = ? WHERE id = ? AND status = 'pending' AND commit_to IS NOT ?",
      commit,
      box,
      sig,
      ts,
      toDelegate?.dpk ?? null,
      toDelegate?.dbox ?? null,
      toDelegate?.dsig ?? null,
      existing.id,
      commit,
    );
    return { id: existing.id, fresh: false };
  }
  const pending = db.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'")[0]!.n;
  if (pending >= MAX_PENDING) return yield* new TooMany({ message: "too many pending join requests" });
  const id = crypto.randomUUID();
  db.sql.run(
    "INSERT INTO requests (id, pk, xpk, box, sig, ts, status, kind, received, commit_to, dpk, dbox, dsig) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'agent', ?, ?, ?, ?, ?)",
    id,
    pk,
    xpk,
    box,
    sig,
    ts,
    Date.now(),
    commit,
    toDelegate?.dpk ?? null,
    toDelegate?.dbox ?? null,
    toDelegate?.dsig ?? null,
  );
  return { id, fresh: true };
});

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const SIG_RE = /^[A-Za-z0-9_-]{86}$/;

const delegateBox = Effect.fn("Room.delegateBox")(function* (room: string, body: RequestBody) {
  const { pk, dpk, dbox, dsig } = body;
  if (dpk === undefined && dbox === undefined && dsig === undefined) return null;
  if (typeof dpk !== "string" || !KEY_RE.test(dpk) || typeof dbox !== "string" || typeof dsig !== "string" || !SIG_RE.test(dsig)) return yield* new BadRequest({ message: "bad request" });
  if (dbox.length > 4096) return yield* new TooLarge({ message: "request too large" });
  if (!(yield* Effect.promise(() => verifyText(pk, dsig, delegateStatement(room, pk, dpk, dbox))))) return yield* new BadRequest({ message: "bad request signature" });
  return { dpk, dbox, dsig };
});

export const requestStatus = Effect.fn("Room.requestStatus")(function* (id: string, pk: string) {
  const db = yield* RoomStore;
  yield* readMeta;
  db.migrate();
  const r = db.sql.all<{ pk: string; status: string; owner_nonce: string | null; reveal: string | null; dpk: string | null }>(
    "SELECT pk, status, owner_nonce, reveal, dpk FROM requests WHERE id = ?",
    id,
  )[0];
  if (!r || r.pk !== pk) return yield* new NotFound({ message: "no such request" });
  if (r.status === "pending") {
    const delegation = r.owner_nonce && r.dpk ? (yield* liveDelegation(r.dpk))?.d : undefined;
    return { status: r.status, ownerNonce: r.owner_nonce, revealed: !!r.reveal, ...(delegation ? { delegation } : {}) } satisfies RequestStatus;
  }
  if (r.status !== "approved" || !db.isMember(pk)) return { status: r.status } satisfies RequestStatus;
  return { status: "approved", ...(yield* keysFor(pk)) } satisfies RequestStatus;
});

type RequestStatus = { status: string; ownerNonce?: string | null; revealed?: boolean; epoch?: number; keys?: Record<string, string>; delegation?: string };

const pendingCheck = Effect.fn("Room.pendingCheck")(function* (id: string) {
  const db = yield* RoomStore;
  db.migrate();
  const r = db.sql.all<{ pk: string; commit: string | null; ownerNonce: string | null; reveal: string | null; dpk: string | null }>(
    "SELECT pk, commit_to AS \"commit\", owner_nonce AS ownerNonce, reveal, dpk FROM requests WHERE id = ? AND status = 'pending'",
    id,
  )[0];
  if (!r?.commit) return yield* new NotFound({ message: "no such pending request" });
  return r as { pk: string; commit: string; ownerNonce: string | null; reveal: string | null; dpk: string | null };
});

export const setOwnerNonce = Effect.fn("Room.setOwnerNonce")(function* (id: string, nonce: unknown, delegate?: string) {
  const db = yield* RoomStore;
  const r = yield* pendingCheck(id);
  if (delegate && r.dpk !== delegate) return yield* new NotFound({ message: "no such pending request" });
  const signer = delegate ?? (yield* readMeta).ownerPk;
  if (typeof nonce !== "string" || !(yield* Effect.promise(() => verifyText(signer, nonce, ownerNonceStatement(db.roomId, r.pk, r.commit))))) {
    return yield* new BadRequest({ message: "that isn't the owner's signature over this request" });
  }
  if (r.ownerNonce && r.ownerNonce !== nonce) return yield* new Conflict({ message: "this request already has the owner's nonce" });
  db.sql.run("UPDATE requests SET owner_nonce = ? WHERE id = ?", nonce, id);
});

export const reveal = Effect.fn("Room.reveal")(function* (id: string, pk: string, nonce: unknown) {
  const db = yield* RoomStore;
  const r = yield* pendingCheck(id);
  if (r.pk !== pk) return yield* new NotFound({ message: "no such pending request" });
  if (!r.ownerNonce) return yield* new Conflict({ message: "wait for the owner's half of the check" });
  if (typeof nonce !== "string" || !NONCE_RE.test(nonce) || (yield* Effect.promise(() => commitTo(db.roomId, pk, nonce))) !== r.commit) {
    return yield* new BadRequest({ message: "that nonce doesn't match the request" });
  }
  if (r.reveal === nonce) return false;
  db.sql.run("UPDATE requests SET reveal = ? WHERE id = ?", nonce, id);
  return true;
});

export const requireChecked = Effect.fn("Room.requireChecked")(function* (request: string | undefined, pk: string, delegate?: string) {
  const db = yield* RoomStore;
  db.migrate();
  const r = request ? db.sql.all<{ pk: string; reveal: string | null; dpk: string | null }>("SELECT pk, reveal, dpk FROM requests WHERE id = ? AND status = 'pending'", request)[0] : undefined;
  if (!r || r.pk !== pk || (delegate && r.dpk !== delegate)) return yield* new BadRequest({ message: "approve a pending request" });
  if (!r.reveal) return yield* new Conflict({ message: "this request hasn't finished its code check yet" });
});

export interface RequestBody {
  id?: string;
  pk: string;
  xpk: string;
  box: string;
  ts: number;
  commit: string;
  sig: string;
  dpk?: string;
  dbox?: string;
  dsig?: string;
}
