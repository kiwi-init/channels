// The shapes of request bodies the relay accepts, as Effect Schemas: one place
// for what a well-formed body is, instead of typeof checks at each route. Each
// route still answers a malformed body with the same status and text as before
// (the texts are API; see test/error-texts.test.ts).

import * as Schema from "effect/Schema";
import { NONCE_RE } from "../sas.ts";

/** A public key (Ed25519 or X25519): 32 bytes, base64url without padding. */
const Key = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/));
/** An Ed25519 signature: 64 bytes, base64url without padding. */
const Sig = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{86}$/));
/** The most a sealed member record may be (setRecord's limit too). */
export const MAX_RECORD = 8_192;
/** The most one wrapped channel key may be: a sealed key and the owner's signature, about 250 characters. */
export const MAX_WRAPPED = 1_024;

/** A join request: the requester's keys, its sealed name and role, and its commit to the code check. */
export const JoinRequest = Schema.Struct({
  pk: Key,
  xpk: Key,
  box: Schema.String,
  sig: Sig,
  ts: Schema.Number,
  commit: Schema.String.check(Schema.isPattern(NONCE_RE)),
});

/** A member record as the owner sends it: keys, the sealed record, and wrapped channel keys by epoch. */
export const MemberRecord = Schema.Struct({
  pk: Key,
  xpk: Key,
  rec: Schema.String.check(Schema.isMaxLength(MAX_RECORD)),
  // By epoch. Record keys aren't checked by the schema: putMember checks them against the channel's epoch.
  keys: Schema.optional(Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(MAX_WRAPPED)))),
  post: Schema.optional(Schema.Boolean),
});

/** A message as stored: AES-GCM iv and ciphertext. */
export const StoredEnvelope = Schema.Struct({ iv: Schema.NonEmptyString, ct: Schema.NonEmptyString });

/** A sealed icon: the epoch whose key sealed it, and the sealed bytes (about a 32KB image at most). */
export const SealedIcon = Schema.Struct({
  e: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  iv: Schema.String,
  ct: Schema.String.check(Schema.isMaxLength(48 * 1024)),
});

/** Whether `x` has `schema`'s shape (routes keep their own refusal texts). */
export function fits<S extends Schema.Top>(schema: S, x: unknown): x is S["Type"] {
  return Schema.is(schema)(x);
}
