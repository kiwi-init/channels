// A room's HTTP API on Effect: one table of routes, each declaring the check it
// needs (public, a request signature, a member, the owner), and one dispatcher
// that runs the check before the handler. A route can't forget its owner()
// check: it's in the table, and test/auth-table.test.ts asserts every row.
//
// Shared by the Cloudflare and Bun relays. Each builds its services once from a
// Layer (makeRelay: sign-in, policy, people's channel lists, linked computers,
// and on Bun a test clock), then hands each request, socket or alarm the room
// it's for (RoomStore) and applies the returned effects (fan-out, disconnects,
// wipes). Statuses, texts and tags are exactly what they were
// (test/error-texts.test.ts).

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import { verifyRequest } from "@kiwi/core/auth.ts";
import { ownerFingerprint } from "@kiwi/core/crypto.ts";
import { MAX_BLOB_BYTES, PAGE_LIMIT } from "@kiwi/core/protocol.ts";
import { ChannelGone, BadRequest, Forbidden, NotFound, NotOwner, SignInRequired, TooLarge, TooMany, Unauthorized, UpdateRequired, type Refusal } from "./failures.ts";
import { answer, buildContext, describeRoutes, dispatch, incoming, json, readCapped, Request_, type Route } from "./http.ts";
import { Human, HUMAN_HEADER } from "./human.ts";
import { betaMessage, inBeta, Policy } from "./policy.ts";
import { offerPages, PAGE_PATH, servePage } from "./pages.ts";
import {
  allow,
  append,
  approve,
  authenticate,
  BLOBS_PER_MINUTE,
  create,
  directory,
  Directory,
  errorResponse,
  frame,
  keysFor,
  markRead,
  MESSAGES_PER_MINUTE,
  missingFingerprint,
  msgFrame,
  readMeta,
  READS_PER_MINUTE,
  remove,
  request,
  requestStatus,
  requestToken,
  requireChecked,
  reveal,
  rotate,
  RoomStore,
  setCanPost,
  setIcon,
  setOwnerNonce,
  setRecord,
  setSettings,
  setSnapshot,
  setTitle,
  watchFrame,
  storeBlob,
  touch,
  UPDATE_KIWI,
  type CreateBody,
  type Effects,
  type MemberBody,
  type RequestBody,
  type RoomDb,
  type RoomServices,
} from "./room.ts";

// ---------- the relay's services ----------

/** What a relay runs its rooms with, from its adapter. */
export type RelayServices = Human | Policy | Directory;

/** The relay's services, built once from the adapter's Layer. */
export type Relay = Context.Context<RelayServices>;

export const makeRelay = (layer: Layer.Layer<RelayServices>): Relay => buildContext(layer);

const inRoom = (relay: Relay, db: RoomDb) => Context.add(relay, RoomStore, db);

/** Run a room Effect that does no I/O (a frame, the welcome, an expiry check) at once. */
export const runRoomSync = <A, E>(relay: Relay, db: RoomDb, effect: Effect.Effect<A, E, RoomServices | RelayServices>): A => Effect.runSyncWith(inRoom(relay, db))(effect);

/** Run a room Effect; a refusal rejects with the tagged failure, which errorResponse answers. */
export const runRoom = <A, E>(relay: Relay, db: RoomDb, effect: Effect.Effect<A, E, RoomServices | RelayServices>): Promise<A> => Effect.runPromiseWith(inRoom(relay, db))(effect);

// ---------- the checks a route can ask for ----------

/**
 * The checks. Only GET /info is public; every other row names one of these, so
 * test/route-table.test.ts and the auth table can see what each route needs.
 */
type Guard = "public" | "creator" | "joiner" | "requester" | "member" | "owner";

/** Who a check found: the key that signed, and the signed-in person creating a channel. */
interface Who {
  me: string;
  signer: string | null;
  user: string | null;
  person: { user: string; name: string } | null;
}
const nobody: Who = { me: "", signer: null, user: null, person: null };

/** The signed-in person behind this request, when the relay requires sign-in. */
const signedIn = Effect.gen(function* () {
  const human = yield* Human;
  const { req } = yield* Request_;
  if (!human) return null;
  const user = yield* Effect.promise(() => human.verify(req.headers.get(HUMAN_HEADER) ?? ""));
  if (!user) return yield* new SignInRequired({ message: "sign in required: channels on this relay are owned and run by a signed-in human (sign in from the Channels app)" });
  return user;
});

/** The key that signed this request (for requesters, who aren't members yet). */
const requester = Effect.gen(function* () {
  const db = yield* RoomStore;
  const { req, method, path, url, body } = yield* Request_;
  const pk = yield* Effect.promise(() => verifyRequest(requestToken(req), db.roomId, method, path + url.search, body));
  if (!pk) return yield* new Unauthorized({ message: "bad or expired signature" });
  return pk;
});

/** The member key that signed this request. */
const member = Effect.gen(function* () {
  const { req, method, path, url, body } = yield* Request_;
  return yield* authenticate(req, method, path + url.search, body);
});

/**
 * The owner: the owner key's signature, and nothing else. Since 0.11 the relay never sees a
 * session on owner routes: whoever holds the owner key runs the channel (the app keeps it, and
 * agents never see it).
 */
const owner = Effect.gen(function* () {
  const me = yield* member;
  if (me !== (yield* readMeta).ownerPk) return yield* new NotOwner({ message: "only the channel owner can do that" });
  return me;
});

/** Creating a channel: the creator's signature (the room checks it is the owner key's) and, on sign-in relays, a session. */
const creator = Effect.gen(function* () {
  const db = yield* RoomStore;
  const { req, method, path, url, body } = yield* Request_;
  const signer = yield* Effect.promise(() => verifyRequest(requestToken(req), db.roomId, method, path + url.search, body));
  const user = yield* signedIn;
  return { ...nobody, signer, user };
});

/** Asking to join: anyone holding the join code may ask. Who vouches for whom is the owner's call. */
const joiner = Effect.succeed(nobody);

const asKey = <E, R>(check: Effect.Effect<string, E, R>) => Effect.map(check, (me): Who => ({ ...nobody, me }));

type Services = RoomServices | RelayServices | Request_;

const guards: Record<Guard, Effect.Effect<Who, Refusal, Services>> = {
  public: Effect.succeed(nobody),
  creator,
  joiner,
  requester: asKey(requester),
  member: asKey(member),
  owner: asKey(owner),
};

// ---------- the routes ----------

type RoomRoute = Route<Guard, Who, Effects, Services>;

const ID = "([0-9a-f-]{36})";

const BLOB = /^\/blobs\/([0-9a-f]{64})$/;

/** A handler that only reads the room. */
const withRoom = <A>(f: (db: RoomDb) => A) => Effect.map(RoomStore, f);

const holds = (req: Request, etag: string) => (req.headers.get("if-none-match") ?? "").split(",").some((t) => t.trim() === "*" || t.trim().replace(/^W\//, "") === etag);

const tagged = (etag: string, data: () => unknown) =>
  Effect.map(Request_, ({ req }) => ({ res: holds(req, etag) ? new Response(null, { status: 304, headers: { etag } }) : Response.json(data(), { headers: { etag } }) }));

const routes: RoomRoute[] = [
  {
    method: "GET",
    path: "/info",
    guard: "public",
    run: () =>
      Effect.gen(function* () {
        const db = yield* RoomStore;
        const { url } = yield* Request_;
        const m = yield* readMeta;
        // The join code's second half is the owner key's fingerprint. A wrong one is answered like a
        // missing room. Calls with no fp never reach here (missingFingerprint).
        if (url.searchParams.get("fp") !== (yield* Effect.promise(() => ownerFingerprint(m.ownerPk)))) return yield* new ChannelGone({ message: "no such channel" });
        return yield* tagged(db.etag("info"), () => ({
          ownerPk: m.ownerPk,
          ownerXpk: m.ownerXpk,
          ownerSig: m.ownerSig,
          titlesSig: db.getTitlesSig(),
          epoch: m.epoch,
          rotate: m.rotate,
          title: db.title(),
          settings: db.settings(),
          iconAt: db.iconAt(),
          blobs: true,
        }));
      }),
  },
  {
    method: "POST",
    path: "/create",
    guard: "creator",
    run: ({ signer, user }) =>
      Effect.gen(function* () {
        const policy = yield* Policy;
        const people = yield* Directory;
        // During a private beta only listed people create channels; anyone may still join one.
        if (user && !(yield* inBeta(user))) return yield* new Forbidden({ message: betaMessage(policy) });
        const most = policy.channelsPerOwner;
        const { roomId } = yield* RoomStore;
        // One step in the owner's own store counts their channels and holds a slot for this one, so
        // creates running at once (on other rooms) can't all pass. A failed create gives the slot back.
        const quota = user && most ? { user, most } : null;
        if (quota && !(yield* Effect.promise(() => people.reserve(quota.user, roomId, quota.most)))) {
          return yield* new TooMany({ message: `you own ${most} channels, the most this relay allows per person; close one to create another` });
        }
        yield* Effect.gen(function* () {
          const b = yield* json<CreateBody>();
          yield* create(signer, b, user);
        }).pipe(Effect.onError(() => (quota ? Effect.promise(() => people.release(quota.user, roomId)) : Effect.void)));
        const updates = user ? yield* directory : undefined;
        return { data: { head: 0 }, fx: { ...(updates ? { directory: updates } : {}), expireAt: (yield* touch) ?? undefined } };
      }),
  },
  {
    method: "POST",
    path: "/requests",
    guard: "joiner",
    run: () =>
      Effect.gen(function* () {
        // Only the join code's holder may ask, as for GET /info: a wrong fingerprint is a missing room.
        const { url } = yield* Request_;
        const m = yield* readMeta;
        if (url.searchParams.get("fp") !== (yield* Effect.promise(() => ownerFingerprint(m.ownerPk)))) return yield* new ChannelGone({ message: "no such channel" });
        const b = yield* json<RequestBody>();
        const { id, fresh } = yield* request(b);
        return { data: { id }, fx: fresh ? { broadcast: [frame({ t: "request" })] } : undefined };
      }),
  },
  {
    method: "POST",
    path: new RegExp(`^/requests/${ID}/reveal$`),
    guard: "requester", // the joiner reveals its half of the code, signed by the key that's asking
    run: ({ me: pk }, m) =>
      Effect.gen(function* () {
        const { nonce } = yield* json<{ nonce?: unknown }>();
        const fresh = yield* reveal(m[1]!, pk, nonce);
        return { data: { revealed: true }, fx: fresh ? { broadcast: [frame({ t: "request" })] } : undefined };
      }),
  },
  {
    method: "GET",
    path: new RegExp(`^/requests/${ID}$`),
    guard: "requester", // signed by the requester's key, which isn't a member yet
    run: ({ me: pk }, m) => Effect.map(requestStatus(m[1]!, pk), (data) => ({ data })),
  },
  { method: "GET", path: "/", guard: "member", run: () => withRoom((db) => ({ data: { head: db.head() } })) },
  {
    method: "GET",
    path: "/messages",
    guard: "member",
    run: ({ me }) =>
      Effect.gen(function* () {
        const db = yield* RoomStore;
        const { url } = yield* Request_;
        const since = Number(url.searchParams.get("since") ?? 0) || 0;
        const limit = Number(url.searchParams.get("limit") ?? PAGE_LIMIT) || PAGE_LIMIT;
        const head = db.head();
        const messages = db.since(since, limit);
        const paged = url.searchParams.get("pages") === "1" ? yield* offerPages(me, since, head, messages) : null;
        return { data: paged ? { head, messages: paged.messages, pages: paged.offer } : { head, messages } };
      }),
  },
  { method: "GET", path: PAGE_PATH, guard: "member", run: ({ me }, m) => Effect.map(servePage(me, Number(m[1])), (data) => ({ data })) },
  {
    method: "POST",
    path: "/messages",
    guard: "member",
    run: ({ me }) =>
      Effect.gen(function* () {
        const db = yield* RoomStore;
        if (!allow(`${db.roomId}:${me}`, MESSAGES_PER_MINUTE)) return yield* new TooMany({ message: "too many messages; wait a minute" });
        const b = yield* json<{ iv?: string; ct?: string; e?: number }>();
        const e = yield* append(b.iv as string, b.ct as string, Number(b.e ?? 0), me);
        return { data: { seq: e.seq, ts: e.ts }, fx: { broadcast: [msgFrame(e)], ...watchFrame(e), expireAt: (yield* touch) ?? undefined } };
      }),
  },
  {
    // A member read everything up to seq: everyone's clients hear it, so a sender sees "Read".
    method: "POST",
    path: "/read",
    guard: "member",
    run: ({ me }) =>
      Effect.gen(function* () {
        const db = yield* RoomStore;
        if (!allow(`read:${db.roomId}:${me}`, READS_PER_MINUTE)) return yield* new TooMany({ message: "too many read marks; one a second is plenty" });
        const b = yield* json<{ seq?: unknown }>();
        const mark = yield* markRead(me, b.seq);
        return { data: { seq: mark?.seq ?? null }, fx: mark ? { readers: [frame({ t: "read", ...mark })] } : undefined };
      }),
  },
  {
    method: "PUT",
    path: BLOB,
    guard: "member",
    run: ({ me }, m) =>
      Effect.gen(function* () {
        const db = yield* RoomStore;
        if (!allow(`blob:${db.roomId}:${me}`, BLOBS_PER_MINUTE)) return yield* new TooMany({ message: "too many images; wait a minute" });
        const { req } = yield* Request_;
        const bytes = yield* Effect.tryPromise({ try: () => readCapped(req, MAX_BLOB_BYTES), catch: () => new BadRequest({ message: "send the image's encrypted bytes" }) });
        if (!bytes) return yield* new TooLarge({ message: "image too large" });
        yield* storeBlob(m[1]!, bytes, me);
        return { data: { id: m[1]! }, fx: { expireAt: (yield* touch) ?? undefined } };
      }),
  },
  {
    method: "GET",
    path: BLOB,
    guard: "member",
    run: (_, m) =>
      Effect.gen(function* () {
        const bytes = (yield* RoomStore).blob(m[1]!);
        if (!bytes) return yield* new NotFound({ message: "no such image" });
        return { res: new Response(bytes, { headers: { "content-type": "application/octet-stream", "cache-control": "private, max-age=31536000, immutable" } }) };
      }),
  },
  { method: "GET", path: "/keys", guard: "member", run: ({ me }) => Effect.map(keysFor(me), (data) => ({ data })) },
  { method: "GET", path: "/icon", guard: "member", run: () => withRoom((db) => ({ data: { icon: db.icon(), at: db.iconAt() } })) },
  {
    method: "PUT",
    path: "/icon",
    guard: "owner",
    run: () =>
      Effect.gen(function* () {
        const { icon } = yield* json<{ icon?: unknown }>();
        const at = yield* setIcon(icon ?? null);
        return { data: { at }, fx: { broadcast: [frame({ t: "info" })] } };
      }),
  },
  {
    method: "PUT",
    path: "/title",
    guard: "owner",
    run: () =>
      Effect.gen(function* () {
        const { title } = yield* json<{ title?: unknown }>();
        yield* setTitle(title);
        return { data: { ok: true }, fx: { broadcast: [frame({ t: "info" })] } };
      }),
  },
  {
    method: "PUT",
    path: "/settings",
    guard: "owner",
    run: () =>
      Effect.gen(function* () {
        const { settings } = yield* json<{ settings?: unknown }>();
        yield* setSettings(settings);
        return { data: { ok: true }, fx: { broadcast: [frame({ t: "info" })] } };
      }),
  },
  {
    method: "GET",
    path: "/snapshot",
    guard: "member",
    run: () =>
      Effect.gen(function* () {
        const db = yield* RoomStore;
        const { url } = yield* Request_;
        const s = db.snapshot();
        return { data: { snapshot: s && url.searchParams.get("only") === "n" ? { n: s.n, e: s.e, at: s.at } : s } };
      }),
  },
  {
    method: "PUT",
    path: "/snapshot",
    guard: "owner",
    run: () =>
      Effect.gen(function* () {
        const { snapshot } = yield* json<{ snapshot?: unknown }>();
        return { data: { n: yield* setSnapshot(snapshot) } };
      }),
  },
  { method: "GET", path: "/members", guard: "member", run: () => Effect.flatMap(RoomStore, (db) => tagged(db.etag("roster"), () => ({ members: db.members() }))) },
  {
    method: "DELETE",
    path: "/members/me",
    guard: "member",
    run: ({ me }) =>
      Effect.gen(function* () {
        yield* remove(me, "left");
        return { data: { left: true }, fx: { disconnect: { pk: me, how: "left" }, broadcast: [frame({ t: "roster" })] } };
      }),
  },
  {
    method: "GET",
    path: "/requests",
    guard: "member", // owner, after the version check: clients from before the join check get told to update
    run: () =>
      Effect.gen(function* () {
        const db = yield* RoomStore;
        const { url } = yield* Request_;
        if (url.searchParams.get("v") !== "2") return yield* new UpdateRequired({ message: UPDATE_KIWI });
        yield* owner;
        return { data: { requests: db.pendingRequests() } };
      }),
  },
  {
    method: "POST",
    path: new RegExp(`^/requests/${ID}/nonce$`),
    guard: "owner",
    run: (_, m) =>
      Effect.gen(function* () {
        const { nonce } = yield* json<{ nonce?: unknown }>();
        yield* setOwnerNonce(m[1]!, nonce);
        return { data: { set: true } };
      }),
  },
  {
    method: "POST",
    path: new RegExp(`^/requests/${ID}/deny$`),
    guard: "owner",
    run: (_, m) => withRoom((db) => (db.deny(m[1]!), { data: { denied: true } })),
  },
  {
    method: "POST",
    path: "/members",
    guard: "owner",
    run: () =>
      Effect.gen(function* () {
        const b = yield* json<MemberBody & { request?: string }>();
        // The checks and the admission run as one step, with no await in between.
        yield* requireChecked(b.request, b.pk);
        yield* approve(b);
        return { data: { approved: true }, fx: { broadcast: [frame({ t: "roster" })] } };
      }),
  },
  {
    method: "DELETE",
    path: /^\/members\/([A-Za-z0-9_-]{20,})$/,
    guard: "owner",
    run: (_, m) =>
      Effect.gen(function* () {
        yield* remove(m[1]!, "owner");
        return { data: { removed: true }, fx: { disconnect: { pk: m[1]!, how: "owner" }, broadcast: [frame({ t: "roster" })] } };
      }),
  },
  {
    method: "PUT",
    path: /^\/members\/([A-Za-z0-9_-]{20,})\/record$/,
    guard: "owner",
    run: (_, m) =>
      Effect.gen(function* () {
        const b = yield* json<{ rec?: unknown; e?: unknown; post?: unknown }>();
        if (typeof b.rec !== "string" || typeof b.e !== "number" || typeof b.post !== "boolean")
          return yield* new BadRequest({ message: "send the sealed record, its epoch, and whether they may post" });
        yield* setRecord(m[1]!, b.rec, b.e, b.post);
        // Everyone re-reads the roster, so the new record (and what it lets them do) lands at once.
        return { data: { ok: true }, fx: { broadcast: [frame({ t: "roster" })] } };
      }),
  },
  {
    method: "PUT",
    path: /^\/members\/([A-Za-z0-9_-]{20,})\/post$/,
    guard: "owner",
    run: (_, m) =>
      Effect.gen(function* () {
        const b = yield* json<{ post?: unknown }>();
        if (typeof b.post !== "boolean") return yield* new BadRequest({ message: "say whether they may post" });
        yield* setCanPost(m[1]!, b.post);
        return { data: { post: b.post } };
      }),
  },
  {
    method: "POST",
    path: "/epochs",
    guard: "owner",
    run: () =>
      Effect.gen(function* () {
        const b = yield* json<{ epoch: number; keys: Record<string, string> }>();
        yield* rotate(b.epoch, b.keys);
        return { data: { epoch: b.epoch }, fx: { broadcast: [frame({ t: "epoch", epoch: b.epoch })] } };
      }),
  },
  {
    method: "DELETE",
    path: "/",
    guard: "owner",
    run: () => withRoom((db) => ({ data: { closed: true }, fx: { directory: db.unlinkAll(), wipe: true } })),
  },
];

/** The table, for tests that check every route declares a guard. */
export const routeTable = describeRoutes(routes);

// The whole request handling, built once: each request only supplies its context.
// An unknown path still asks for a member first, as it always has.
const program = answer(
  dispatch(
    routes,
    guards,
    Effect.flatMap(member, () => Effect.fail(new NotFound({ message: "not found" }))),
  ),
);

/** Handle one HTTP request to a room. Adapters apply `fx`. */
export async function onHttp(relay: Relay, db: RoomDb, req: Request, path: string): Promise<{ res: Response; fx?: Effects }> {
  // Missing fingerprint: 426 before this reads or wipes the room. The adapters also refuse
  // before they open the room at all.
  const early = missingFingerprint(req.method, path, new URL(req.url));
  if (early) return { res: errorResponse(early) };
  // Shared-code rooms from before owners existed: delete them outright the first time anything touches them.
  if (db.isLegacy()) return { res: Response.json({ error: "no such channel", tag: "ChannelGone" }, { status: 404 }), fx: { wipe: true } };
  // One context for this request, handed to the runtime as is (cheaper than layering provides).
  const context = inRoom(relay, db).pipe(Context.add(Request_, await incoming(req, path)));
  // Anything else (a bug, a storage error) propagates, and the adapter answers 500 as before.
  return Effect.runPromiseWith(context)(program);
}
