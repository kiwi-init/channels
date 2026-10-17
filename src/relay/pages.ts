import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { verifyRequest } from "@kiwi/core/auth.ts";
import { b64url, fromB64url } from "@kiwi/core/crypto.ts";
import { PAGE_LIMIT, type Envelope } from "@kiwi/core/protocol.ts";
import { Forbidden, NotFound, Unauthorized } from "./failures.ts";
import { Request_ } from "./http.ts";
import { Policy } from "./policy.ts";
import { errorResponse, requestToken, RoomStore } from "./room.ts";

export const PAGE_CAP_MS = 5 * 60_000;

const CAP_SKEW_MS = 60_000;

export const PAGE_CACHE_SECONDS = 3600;

export const PAGE_PATH = /^\/pages\/(\d{1,9})$/;

const PAGE_REFUSED = "page capability expired or invalid; read /messages instead";

interface PageOffer {
  cap: string;
  exp: number;
  next: number;
}

export interface PageCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    hmacKeys.set(secret, key);
  }
  return key;
}

interface PageGrant {
  gen: string;
  exp: number;
  pages: number;
}

const capText = (roomId: string, pk: string, g: PageGrant) => new TextEncoder().encode(`kiwi-page\n${roomId}\n${pk}\n${g.gen}\n${g.exp}\n${g.pages}`);

async function issuePageCap(secret: string, roomId: string, pk: string, gen: string, head: number, now: number): Promise<{ cap: string; exp: number }> {
  const grant: PageGrant = { gen, exp: now + PAGE_CAP_MS, pages: Math.floor(head / PAGE_LIMIT) };
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), capText(roomId, pk, grant)));
  return { cap: `p1.${grant.gen}.${grant.exp}.${grant.pages}.${b64url(mac)}`, exp: grant.exp };
}

async function verifyPageCap(secret: string, cap: string, roomId: string, pk: string, page: number, now: number): Promise<string | null> {
  const m = /^p1\.([0-9a-f]{32})\.(\d{1,16})\.(\d{1,9})\.([A-Za-z0-9_-]{43})$/.exec(cap);
  if (!m) return null;
  const grant: PageGrant = { gen: m[1]!, exp: Number(m[2]), pages: Number(m[3]) };
  if (grant.exp <= now || grant.exp > now + PAGE_CAP_MS + CAP_SKEW_MS || page >= grant.pages) return null;
  return (await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(m[4]!), capText(roomId, pk, grant))) ? grant.gen : null;
}

export const offerPages = Effect.fn("Room.offerPages")(function* (pk: string, since: number, head: number, messages: Envelope[]) {
  const db = yield* RoomStore;
  const secret = (yield* Policy).pageKey;
  const last = messages.at(-1)?.seq;
  if (!secret || last === undefined) return null;
  const next = Math.floor(last / PAGE_LIMIT) * PAGE_LIMIT;
  if (next < since || next + PAGE_LIMIT > head) return null;
  const now = yield* Clock.currentTimeMillis;
  const { cap, exp } = yield* Effect.promise(() => issuePageCap(secret, db.roomId, pk, db.pageGen(), head, now));
  const offer: PageOffer = { cap, exp, next };
  return { messages: messages.filter((e) => e.seq <= next), offer };
});

export const servePage = Effect.fn("Room.servePage")(function* (pk: string, page: number) {
  const db = yield* RoomStore;
  const { url } = yield* Request_;
  const secret = (yield* Policy).pageKey;
  if (!secret) return yield* new NotFound({ message: "not found" });
  const now = yield* Clock.currentTimeMillis;
  const gen = yield* Effect.promise(() => verifyPageCap(secret, url.searchParams.get("cap") ?? "", db.roomId, pk, page, now));
  if (!gen || gen !== db.storedPageGen()) return yield* new Forbidden({ message: PAGE_REFUSED });
  return { messages: db.range(page * PAGE_LIMIT, (page + 1) * PAGE_LIMIT) };
});

export async function edgePage(req: Request, roomId: string, rest: string, secret: string | null, cache: PageCache | null, forward: () => Promise<Response>, now: number): Promise<Response> {
  const page = PAGE_PATH.exec(rest)?.[1];
  if (!secret || !cache || req.method !== "GET" || page === undefined) return forward();
  const url = new URL(req.url);
  const pk = await verifyRequest(requestToken(req), roomId, "GET", rest + url.search, "");
  if (!pk) return errorResponse(new Unauthorized({ message: "bad or expired signature" }));
  const gen = await verifyPageCap(secret, url.searchParams.get("cap") ?? "", roomId, pk, Number(page), now);
  if (!gen) return errorResponse(new Forbidden({ message: PAGE_REFUSED }));
  const key = `${url.origin}/__kiwi/pages/${roomId}/${gen}/${Number(page)}`;
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, { status: 200, headers: { "content-type": "application/json", "x-kiwi-cache": "hit" } });
  const res = await forward();
  if (res.status !== 200) return res;
  const body = await res.text();
  await cache.put(key, new Response(body, { headers: { "content-type": "application/json", "cache-control": `max-age=${PAGE_CACHE_SECONDS}` } }));
  const headers = new Headers(res.headers);
  headers.set("x-kiwi-cache", "miss");
  return new Response(body, { status: 200, headers });
}
