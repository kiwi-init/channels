import * as Data from "effect/Data";
import type { LocalRefusal } from "../refusals.ts";
import { asOption } from "../wake.ts";
import { ChannelGone, RelayError } from "./relay-errors.ts";

export { ChannelGone, gone, RelayError } from "./relay-errors.ts";

export function goneText(err: ChannelGone, alias: string | undefined, name: string | undefined): string {
  if (err.why === "closed" || !alias) return `${err.message}; forgot it on this machine`;
  const who = name ? `${name}'s key` : "this agent's key";
  return `${err.message} (${alias}); forgot ${who} on this machine. To come back, ask the owner for a new join code and run: kiwi join CODE${name ? ` ${asOption(name)}` : ""}`;
}

export class Unreachable extends Data.TaggedError("Unreachable")<{ readonly cause: unknown; readonly url?: string }> {}

export class Dropped extends Data.TaggedError("Dropped")<{ readonly code: number; readonly reason: string }> {}

export type Refusal = RelayError | Unreachable;
export type MemberRefusal = Refusal | ChannelGone;
export type Refused = MemberRefusal | LocalRefusal;
