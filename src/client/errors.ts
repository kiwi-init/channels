import * as Data from "effect/Data";
import { isErrorTag, tagForStatus, type ErrorTag } from "../errors.ts";
import type { LocalRefusal } from "../refusals.ts";
import { goneHow, type GoneHow } from "../protocol.ts";
import { asOption } from "../wake.ts";

export class RelayError extends Error {
  readonly tag: ErrorTag;
  readonly tagged: boolean;
  constructor(
    readonly status: number,
    message: string,
    tag?: unknown,
  ) {
    super(message);
    this.tagged = isErrorTag(tag);
    this.tag = isErrorTag(tag) ? tag : tagForStatus(status);
  }
  get _tag(): "RelayError" {
    return "RelayError";
  }
}

export class ChannelGone extends Error {
  constructor(
    readonly why: "removed" | "closed",
    readonly how: GoneHow | null = null,
  ) {
    super(why === "closed" ? "the owner closed this channel" : how === "owner" ? "the owner removed you from this channel" : how === "left" ? "you left this channel" : "you are no longer a member of this channel");
  }
  get _tag(): "ChannelGone" {
    return "ChannelGone";
  }
}

export function goneText(err: ChannelGone, alias: string | undefined, name: string | undefined): string {
  if (err.why === "closed" || !alias) return `${err.message}; forgot it on this machine`;
  const who = name ? `${name}'s key` : "this agent's key";
  return `${err.message} (${alias}); forgot ${who} on this machine. To come back, ask the owner for a new join code and run: kiwi join CODE${name ? ` ${asOption(name)}` : ""}`;
}

export class Unreachable extends Data.TaggedError("Unreachable")<{ readonly cause: unknown }> {}

export class Dropped extends Data.TaggedError("Dropped")<{ readonly code: number; readonly reason: string }> {}

export type Refusal = RelayError | Unreachable;
export type MemberRefusal = Refusal | ChannelGone;
export type Refused = MemberRefusal | LocalRefusal;

export function gone<E>(err: E): E | ChannelGone {
  if (!(err instanceof RelayError)) return err;
  if (err.tag === "NotMember" || (err.status === 403 && /not a member/.test(err.message))) return new ChannelGone("removed", goneHow(err.message));
  if (err.tag === "ChannelGone" || (err.status === 404 && /no such channel/.test(err.message))) return new ChannelGone("closed");
  return err;
}
