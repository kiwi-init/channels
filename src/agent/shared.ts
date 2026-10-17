import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scoped from "effect/Scope";
import { ChannelGone, fetchRelay, Relay, RelayError, settle } from "@kiwi/core/client.ts";
import { Cache, Cursor, Keystore, LocalFiles } from "../config.ts";
import { holdListening } from "../hooks/listeners.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { isLocalRefusal } from "@kiwi/core/refusals.ts";
import type { ChannelState, GuardFloor, Roster, RoomsFloor } from "@kiwi/core/state.ts";
import type { SessionState } from "./state.ts";

export const MARK_EVERY_MS = 1_000;
export const LAST_MARK_MS = 2_000;
export const EVERYONE = new Set(["all", "everyone", "*"]);
export const PRESENCE_TTL_MS = 150_000;

export interface Delivery {
  all?: boolean;
  chat?: boolean;
  forMe?: boolean;
  thread?: number;
  room?: string;
}

export interface Hearing<R = never> {
  onStatus?: (line: string) => Effect.Effect<void>;
  onNotice?: (text: string) => Effect.Effect<void, never, R>;
  marks?: boolean;
  hold?: boolean;
}

export type Agent = Relay | Keystore | Cache | Cursor;

export const AgentLive: Layer.Layer<Agent> = Layer.mergeAll(Layer.succeed(Relay, fetchRelay), LocalFiles);

export const runAgent = <A, E>(effect: Effect.Effect<A, E, Agent>): Promise<A> => Effect.runPromiseExit(Effect.provide(effect, AgentLive)).then(settle);

export const isAnswer = (err: unknown) => err instanceof ChannelGone || isLocalRefusal(err) || (err instanceof RelayError && err.status < 500 && err.status !== 429);

export const holding = (alias: string, as: string): Effect.Effect<void, never, Scoped.Scope> =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.promise(() => holdListening(alias, as)),
      (held) => Effect.sync(() => held.close()),
    );
  });

interface Seen {
  messages: Message[];
  roster: Roster;
  rooms: RoomsFloor | null | undefined;
  guard: GuardFloor | null | undefined;
  view: { messages: Message[]; state: ChannelState };
}

interface Look {
  fetched: WeakSet<SessionState>;
  seen: WeakMap<SessionState, Seen>;
}

export const Look = Context.Reference<Look | null>("kiwi/AgentSession/Look", { defaultValue: () => null });

export const oneLook = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.service(Look), (look) => (look ? effect : Effect.provideService(effect, Look, { fetched: new WeakSet(), seen: new WeakMap() })));

export const lastSeq = (log: readonly Message[]) => log.at(-1)?.seq ?? 0;

export const orNone = <A, E, R>(e: Effect.Effect<A | null, E, R>) => Effect.catchCause(e, () => Effect.succeed(null));
