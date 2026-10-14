// The shapes of request bodies the relay accepts, as Effect Schemas: one place
// for what a well-formed body is, instead of typeof checks at each route. Each
// route still answers a malformed body with the same status and text as before
// (the texts are API; see test/error-texts.test.ts).

import * as Schema from "effect/Schema";
import { NONCE_RE } from "../sas.ts";

/** A join request: the requester's keys, its sealed name and role, and its commit to the code check. */
export const JoinRequest = Schema.Struct({
  pk: Schema.String,
  xpk: Schema.String,
  box: Schema.String,
  sig: Schema.String,
  ts: Schema.Number,
  commit: Schema.String.check(Schema.isPattern(NONCE_RE)),
});

/** A member record as the owner sends it: keys, the sealed record, and wrapped channel keys by epoch. */
export const MemberRecord = Schema.Struct({
  pk: Schema.String,
  xpk: Schema.String,
  rec: Schema.String,
  keys: Schema.optional(Schema.Record(Schema.String, Schema.String)),
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
