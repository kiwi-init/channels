import { isErrorTag, tagForStatus, type ErrorTag } from "../errors.ts";
import { goneHow, type GoneHow } from "../protocol.ts";

export class RelayError extends Error {
  readonly tag: ErrorTag;
  readonly tagged: boolean;
  readonly retryAfter: number | null;
  constructor(
    readonly status: number,
    message: string,
    tag?: unknown,
    retryAfter?: unknown,
  ) {
    super(message);
    this.tagged = isErrorTag(tag);
    this.tag = isErrorTag(tag) ? tag : tagForStatus(status);
    const secs = typeof retryAfter === "string" ? Number(retryAfter) : retryAfter;
    this.retryAfter = typeof secs === "number" && Number.isFinite(secs) && secs >= 0 ? secs : null;
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
    super(
      why === "closed"
        ? "the owner closed this channel"
        : how === "owner"
          ? "the owner removed you from this channel"
          : how === "left"
            ? "you left this channel"
            : "you are no longer a member of this channel",
    );
  }
  get _tag(): "ChannelGone" {
    return "ChannelGone";
  }
}

export function gone<E>(err: E): E | ChannelGone {
  if (!(err instanceof RelayError)) return err;
  if (err.tag === "NotMember" || (err.status === 403 && /not a member/.test(err.message))) return new ChannelGone("removed", goneHow(err.message));
  if (err.tag === "ChannelGone" || (err.status === 404 && /no such channel/.test(err.message))) return new ChannelGone("closed");
  return err;
}
