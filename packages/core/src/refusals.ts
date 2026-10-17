// What a client refuses on its own, before asking the relay: tagged failures,
// each carrying the text the person sees. The CLI prints it as it is, the MCP
// tools answer with it, and a Promise caller (the dashboard) reads `.message`
// as it always has: these are Errors too. The relay's own refusals are
// RelayError (client.ts), tagged by the relay.

import * as Data from "effect/Data";

/** Not something this member may do here: the owner's scopes, the hold, no such task or member. */
export class Rejected extends Data.TaggedError("Rejected")<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}

/** Only the channel's owner may do this, and this key (or this machine) isn't it. */
export class OwnerOnly extends Data.TaggedError("OwnerOnly")<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}

/** A name that can't be used: invalid, reserved, or already someone's. */
export class BadName extends Data.TaggedError("BadName")<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}

/** A key this client needs and doesn't hold: the channel key for an epoch, an exchange key. */
export class MissingKey extends Data.TaggedError("MissingKey")<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}

/** Anything a client refuses before the relay is asked. */
export type LocalRefusal = Rejected | OwnerOnly | BadName | MissingKey;

const LOCAL = new Set(["Rejected", "OwnerOnly", "BadName", "MissingKey"]);

export const isLocalRefusal = (u: unknown): u is LocalRefusal => u instanceof Error && LOCAL.has((u as { _tag?: string })._tag ?? "");
