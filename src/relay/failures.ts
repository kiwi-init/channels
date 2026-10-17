// What the relay refuses with, by meaning: one tagged failure per tag in
// src/errors.ts that the room uses, each carrying the text the client gets.
// The status each tag answers with is in STATUS below, and the response a
// refusal becomes is built in refusalResponse: here, and nowhere else.
//
// The texts are API (test/error-texts.test.ts); so is the tag on the wire.

import * as Schema from "effect/Schema";
import type { ErrorTag } from "@kiwi/core/errors.ts";

const text = { message: Schema.String };

/** The body isn't what this route takes. */
export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", text) {}
/** No valid signature: a bad or expired request token, or the wrong key. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", text) {}
/** The relay needs a signed-in person's live session, and none came (or it isn't valid). */
export class SignInRequired extends Schema.TaggedError<SignInRequired>()("SignInRequired", text) {}
/** Only the channel's owner (key, and on sign-in relays the person) may do this. */
export class NotOwner extends Schema.TaggedError<NotOwner>()("NotOwner", text) {}
/** The key that signed isn't an active member. */
export class NotMember extends Schema.TaggedError<NotMember>()("NotMember", text) {}
/** The key was removed from this channel; it has to join with a new identity. */
export class Removed extends Schema.TaggedError<Removed>()("Removed", text) {}
/** The owner denied this key's request. */
export class Denied extends Schema.TaggedError<Denied>()("Denied", text) {}
/** Not allowed, for a reason the text gives (the beta, an unlinked computer, someone else's usage). */
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", text) {}
/** The owner lets this member only read. */
export class ReadOnly extends Schema.TaggedError<ReadOnly>()("ReadOnly", text) {}
/** The channel was closed, expired, or never existed. */
export class ChannelGone extends Schema.TaggedError<ChannelGone>()("ChannelGone", text) {}
/** No such request, member or route. */
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", text) {}
/** The path is right, the method isn't (the vault takes GET, PUT and DELETE). */
class MethodNotAllowed extends Schema.TaggedError<MethodNotAllowed>()("MethodNotAllowed", text) {}
/** The room moved on (an epoch, a check, an existing member): read again and retry. */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", text) {}
/** More than the relay stores at once. */
export class TooLarge extends Schema.TaggedError<TooLarge>()("TooLarge", text) {}
/** The client speaks an old path; it has to update kiwi. */
export class UpdateRequired extends Schema.TaggedError<UpdateRequired>()("UpdateRequired", text) {}
/** A rate limit or quota: the text says when or what frees it. */
export class TooMany extends Schema.TaggedError<TooMany>()("TooMany", text) {}

export type Failure =
  | BadRequest
  | Unauthorized
  | SignInRequired
  | NotOwner
  | NotMember
  | Removed
  | Denied
  | Forbidden
  | ReadOnly
  | ChannelGone
  | NotFound
  | MethodNotAllowed
  | Conflict
  | TooLarge
  | UpdateRequired
  | TooMany;

/** The status each failure answers with: the one it always had. */
export const STATUS = {
  BadRequest: 400,
  Unauthorized: 401,
  SignInRequired: 401,
  NotOwner: 403,
  NotMember: 403,
  Removed: 403,
  Denied: 403,
  Forbidden: 403,
  ReadOnly: 403,
  ChannelGone: 404,
  NotFound: 404,
  MethodNotAllowed: 405,
  Conflict: 409,
  TooLarge: 413,
  UpdateRequired: 426,
  TooMany: 429,
} as const satisfies Record<Failure["_tag"] & ErrorTag, number>;

/** A refusal whose status doesn't follow from a tag: the Worker's 503 (tagged Internal, like a 500). */
export class Refused extends Schema.TaggedError<Refused>()("Refused", {
  status: Schema.Number,
  message: Schema.String,
  tag: Schema.String,
}) {}

/** Anything the relay refuses a request with. */
export type Refusal = Failure | Refused;

export const isRefusal = (u: unknown): u is Refusal => u instanceof Refused || (u instanceof Error && Object.hasOwn(STATUS, (u as { _tag?: unknown })._tag as string));

/** A refusal as the response it has always been: { error, tag } and its status. */
export function refusalResponse(r: Refusal): Response {
  if (r._tag === "Refused") return Response.json({ error: r.message, tag: r.tag }, { status: r.status });
  return Response.json({ error: r.message, tag: r._tag }, { status: STATUS[r._tag] });
}
