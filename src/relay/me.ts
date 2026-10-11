// A signed-in person's own pages on the relay: GET /v1/me/channels (their
// channel list, with what's new) and GET /v1/me/usage (what they use of the
// relay's limits). Their vault, device handovers and computers have modules of
// their own (vault.ts, devices.ts, machines.ts).
//
// All of them run with the relay's people services, which the adapter builds
// once from a Layer (makePeople), the way a room runs with makeRelay's: who is
// signed in (Human), the relay's limits (Policy), people's channel lists
// (Directory), linked computers (Machines), vaults (Vaults), handovers
// (Handovers), and Effect's Clock.

import * as Clock from "effect/Clock";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type { Handovers } from "./devices.ts";
import { NotFound, SignInRequired } from "./failures.ts";
import { buildContext, respond } from "./http.ts";
import { Human, HUMAN_HEADER } from "./human.ts";
import type { Machines } from "./machines.ts";
import { Policy } from "./policy.ts";
import { Directory, type DirectoryEntry, type RoomHead, type RoomUsage } from "./room.ts";
import type { Vaults } from "./vault.ts";

/** What a person's routes run with, from the adapter. */
export type PeopleServices = Human | Policy | Directory | Machines | Vaults | Handovers;

/** The people services, built once from the adapter's Layer. */
export type People = Context.Context<PeopleServices>;

export const makePeople = (layer: Layer.Layer<PeopleServices>): People => buildContext(layer);

/** The signed-in user behind a /v1/me request; without one, the refusal each listing has always given. */
const signedInAs = (req: Request, signInFirst: SignInRequired) =>
  Effect.gen(function* () {
    const human = yield* Human;
    if (!human) return yield* new NotFound({ message: "this relay has no sign-in" });
    const user = yield* Effect.promise(() => human.verify(req.headers.get(HUMAN_HEADER) ?? ""));
    if (!user) return yield* signInFirst;
    return user;
  });

/** A person's channel list, from whatever index the adapter keeps. */
const listOf = (user: string) => Effect.flatMap(Directory, (people) => Effect.promise(() => people.list(user)));

// ---------- GET /v1/me/channels ----------

/** A channel quiet this long gets no head: nothing new to mark. */
const QUIET_AFTER_MS = 7 * 86_400_000;
/** How many channels in one listing get their head read: each read wakes that channel's storage. */
export const HEADS_PER_LISTING = 50;
/** How long a person's heads are reused before the channels are read again. */
export const HEADS_CACHE_SECONDS = 300;

/** Where myChannels gets heads: a pure read per channel, and (on the Worker) a per-person cache. */
export interface HeadSource {
  read: (room: string) => Promise<RoomHead | null>;
  cache?: { get: (user: string) => Promise<Record<string, RoomHead> | null>; put: (user: string, heads: Record<string, RoomHead>) => Promise<void> };
}

/** The signed-in person's channel list; with `heads`, each recently active channel's newest seq. */
export function myChannels(req: Request, people: Context.Context<Human | Directory>, heads?: HeadSource): Promise<Response> {
  return respond(
    people,
    Effect.gen(function* () {
      const user = yield* signedInAs(req, new SignInRequired({ message: "sign in to see your channels" }));
      const sorted = (yield* listOf(user)).sort((a, b) => b.at - a.at);
      if (!heads) return Response.json({ channels: sorted });
      // Each channel's newest seq, so the sidebar can mark the closed ones with news: only for channels
      // in this person's list, the newest HEADS_PER_LISTING of them, read at most once per cache period.
      const known = yield* Effect.promise(() => headsOf(user, sorted, heads));
      const quiet = (yield* Clock.currentTimeMillis) - QUIET_AFTER_MS;
      const channels = sorted.map((c) => {
        const h = known[c.room];
        return h && h.last >= quiet ? { ...c, head: h.head } : c;
      });
      return Response.json({ channels });
    }),
  );
}

/** Each listed channel's head, from the cache when it has them. A read or cache that fails counts as no head. */
async function headsOf(user: string, sorted: DirectoryEntry[], heads: HeadSource): Promise<Record<string, RoomHead>> {
  let known = await heads.cache?.get(user).catch(() => null);
  if (!known) {
    known = {};
    const read = await Promise.all(sorted.slice(0, HEADS_PER_LISTING).map(async (c) => [c.room, await heads.read(c.room).catch(() => null)] as const));
    for (const [room, h] of read) if (h) known[room] = h;
    await heads.cache?.put(user, known).catch(() => {});
  }
  return known;
}

// ---------- GET /v1/me/usage ----------

/**
 * What a signed-in person uses of this relay's limits: channels owned against the cap, and for
 * each one messages today, stored bytes and members. Null limits are unlimited. `usageOf` asks a
 * channel for its own numbers (the adapter knows how to reach it).
 */
export function myUsage(req: Request, people: Context.Context<Human | Policy | Directory>, usageOf: (room: string) => Promise<RoomUsage | null>): Promise<Response> {
  return respond(
    people,
    Effect.gen(function* () {
      const policy = yield* Policy;
      const user = yield* signedInAs(req, new SignInRequired({ message: "sign in to see your usage" }));
      const owned = (yield* listOf(user)).filter((c) => c.owner);
      const channels = yield* Effect.promise(() =>
        Promise.all(owned.map(async (c) => ({ room: c.room, code: c.code, ...((await usageOf(c.room)) ?? { messagesToday: 0, bytes: 0, members: 0 }) }))),
      );
      return Response.json({
        limits: {
          channelsPerOwner: policy.channelsPerOwner,
          membersPerChannel: policy.membersPerChannel,
          messagesPerDay: policy.messagesPerDay,
          bytesPerChannel: policy.bytesPerChannel,
          expireAfterDays: policy.expireAfterDays,
        },
        owned: channels.length,
        channels,
      });
    }),
  );
}
