// An agent's view of one channel: the operations behind every CLI command
// and MCP tool. Keeps a local cache of the decrypted log so folding shared
// state (tasks, facts, members) costs one incremental fetch.
//
// On Effect (docs/plans/effect.md, step 4). Every operation is an Effect over the
// client's own (`ch.fx`) and over this computer's files as services (Keystore,
// Cache, Cursor in config.ts), so the CLI and the MCP server run them in one
// runtime and a test can stand in for either side. What the session refuses on its
// own is a tagged Rejected (refusals.ts) carrying the text the person sees.
// `listen` follows the channel's live Stream; interrupting it closes the socket and
// stops the presence beacon with it.

import * as Effect from "effect/Effect";
import { keepAnswersIn, keepBlobsIn, keepRecordsIn } from "@kiwi/core/client.ts";
import { Keystore, type ChannelConfig } from "./config.ts";
import type { Presence } from "@kiwi/core/protocol.ts";
import { Rejected } from "@kiwi/core/refusals.ts";
import { runAgent } from "./agent/shared.ts";
import { SessionTasks } from "./agent/tasks.ts";

export { Rejected };
export { AgentLive, holding, MARK_EVERY_MS, oneLook, PRESENCE_TTL_MS, runAgent, type Agent, type Delivery, type Hearing } from "./agent/shared.ts";
export { wants } from "./agent/wants.ts";

export class AgentSession extends SessionTasks {
  /** openSession, as a Promise: for callers outside Effect. */
  static open(alias: string, cfg: ChannelConfig, name: string): Promise<AgentSession> {
    return runAgent(openSession(alias, cfg, name));
  }
}

/** One agent's session on one channel, with its key loaded. Agents never hold an owner key (the app does). */
export const openSession = Effect.fn("AgentSession.open")(function* (alias: string, cfg: ChannelConfig, name: string) {
  const keys = yield* Keystore;
  // Member records: the newest this machine has seen per key wins, across runs.
  keepRecordsIn(keys.records);
  keepAnswersIn(keys.answers ?? null);
  keepBlobsIn(keys.blobs);
  // Join creates the key first (loadIdentity). Everything else must use a name this machine already holds.
  if (!(yield* keys.identitiesIn(cfg.roomId)).includes(name)) {
    return yield* Effect.fail(new Error(`${name} has no key in "${alias}" on this machine`));
  }
  const identity = yield* keys.identity(name, cfg.roomId);
  return new AgentSession(alias, cfg, identity, (a) => Effect.runSync(keys.saveAccess(alias, a)));
});

export type { Presence };
