import { verifyRequest } from "@kiwi/core/auth.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { currentDevice, readDeviceList, type Device, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { accountScope, ENROLL_TTL_MS, readEnrollAnswer, readEnrollAsk, revealMatches, type EnrollAnswer, type EnrollAsk } from "@kiwi/core/enroll.ts";
import { canonical } from "@kiwi/core/identity.ts";
import { BadRequest, Conflict, Forbidden, NotFound, SignInRequired, TooLarge, TooMany, Unauthorized } from "./failures.ts";
import { readCapped } from "./http.ts";
import { HUMAN_HEADER, type HumanAuth } from "./human.ts";
import { corsPreflight, withCors } from "./mailbox.ts";
import { errorResponse } from "./room/http.ts";
import { requestToken } from "./room/auth.ts";

export const ACCOUNT_ASKS_PER_MINUTE = 5;
const LIST_MAX_BYTES = 768 * 1024;
const ASK_MAX_BYTES = 4096;

export interface Enrollment {
  id: string;
  at: number;
  ask: EnrollAsk;
  answer?: EnrollAnswer & { at: number };
  reveal?: { nonce: string; at: number };
}

export interface AccountStore {
  links(user: string): Promise<unknown[]>;
  extend(user: string, from: number, links: DeviceLink[]): Promise<boolean>;
  enrollment(user: string): Promise<Enrollment | null>;
  setEnrollment(user: string, next: Enrollment | null, prev: Enrollment | null): Promise<boolean>;
  revoke(keys: string[]): Promise<void>;
}

const PATH = /^\/v1\/account(?:\/ask(?:\/([A-Za-z0-9_-]{22})(?:\/(answer|reveal))?)?)?$/;

export const isAccountPath = (pathname: string): boolean => PATH.test(pathname);

const enrollmentLive = (e: Enrollment | null, now: number): Enrollment | null => (e && e.at + ENROLL_TTL_MS > now ? e : null);

export const sameEnrollment = (a: Enrollment | null, b: Enrollment | null): boolean => (a === null ? b === null : b !== null && canonical(a) === canonical(b));

const refuse = (err: unknown): Response => withCors(errorResponse(err));
const answer = (data: unknown, status = 200): Response => withCors(Response.json(data, { status }));
const done = (): Response => withCors(new Response(null, { status: 204 }));

function parse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    // Not JSON: refused as a bad request by the caller.
    return null;
  }
}

export async function accountUser(req: Request, human: HumanAuth | null): Promise<string | Response> {
  if (!human) return refuse(new NotFound({ message: "this relay has no sign-in, so it keeps no accounts" }));
  const user = await human.verify(req.headers.get(HUMAN_HEADER) ?? "");
  return user ?? refuse(new SignInRequired({ message: "sign in to reach your account" }));
}

function approver(list: DeviceList | null, pk: string, now: number): Device | null {
  const d = list ? currentDevice(list, pk, now) : null;
  return d && d.approve && d.as !== "computer" ? d : null;
}

async function kept(store: AccountStore, user: string): Promise<{ links: unknown[]; list: DeviceList | null }> {
  const links = await store.links(user);
  if (!links.length) return { links, list: null };
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(`a kept device list doesn't hold up: ${read.why}`);
  return { links, list: read.list };
}

export async function onAccountHttp(
  req: Request,
  store: AccountStore,
  user: string,
  opts: { now?: () => number; perAccount?: (key: string) => boolean | Promise<boolean>; perAddress?: () => boolean | Promise<boolean> } = {},
): Promise<Response | null> {
  const url = new URL(req.url);
  const m = PATH.exec(url.pathname);
  if (!m) return null;
  if (req.method === "OPTIONS") return corsPreflight();
  const now = (opts.now ?? Date.now)();
  const onAsk = url.pathname !== "/v1/account";
  const id = m[1];
  const step = m[2];
  const writes = req.method === "PUT" || req.method === "POST";
  const bytes = writes ? await readCapped(req, onAsk ? ASK_MAX_BYTES : LIST_MAX_BYTES) : new Uint8Array(0);
  if (bytes === null) return refuse(new TooLarge({ message: "that request is too large for an account route" }));
  if (writes && opts.perAddress && !(await opts.perAddress())) return refuse(new TooMany({ message: "too many account requests from this address; try again in a few minutes" }));
  const body = new TextDecoder().decode(bytes);
  const { links, list } = await kept(store, user);

  if (!onAsk && req.method === "GET") return answer({ user, links });

  const token = requestToken(req);
  const signer = token ? await verifyRequest(token, accountScope(user), req.method, url.pathname, body, now) : null;
  if (!signer) return refuse(new Unauthorized({ message: "sign this request for this account and path" }));
  if (list?.revoked.includes(signer)) return refuse(new Forbidden({ message: "this device was removed from this person's devices" }));

  if (!onAsk && req.method === "PUT") {
    const raw = parse(body)?.links;
    if (!Array.isArray(raw)) return refuse(new BadRequest({ message: "an account takes {links}, the person's device list" }));
    const read = await readDeviceList(raw);
    if (!read.ok) return refuse(new BadRequest({ message: `that device list doesn't hold up: ${read.why}` }));
    const next = read.list;
    if (signer !== next.person && !approver(next, signer, now)) return refuse(new Forbidden({ message: "only the person key or an app that approves devices publishes their list" }));
    if (list && next.person !== list.person) return refuse(new Conflict({ message: "this account belongs to another person key" }));
    if (raw.length < links.length) return refuse(new Conflict({ message: "a newer device list is already kept" }));
    if (links.some((l, i) => canonical(l) !== canonical(raw[i]))) return refuse(new Conflict({ message: "that list doesn't extend the one kept" }));
    if (raw.length === links.length) return done();
    if (!(await store.extend(user, links.length, raw.slice(links.length) as DeviceLink[]))) return refuse(new Conflict({ message: "the device list changed meanwhile; read it and try again" }));
    const cut = next.revoked.filter((k) => !list?.revoked.includes(k));
    if (cut.length) await store.revoke(cut);
    return done();
  }

  const stored = await store.enrollment(user);
  const live = enrollmentLive(stored, now);

  if (!id && req.method === "POST") {
    const ask = readEnrollAsk(parse(body)?.ask);
    if (!ask) return refuse(new BadRequest({ message: "an ask takes {ask}: device, dxpk, label, os, as, at and commit" }));
    if (signer !== ask.device) return refuse(new Forbidden({ message: "a device asks to join for itself" }));
    if (!list) return refuse(new NotFound({ message: "no app of this account can approve a device yet: sign in on your first app" }));
    if (list.revoked.includes(ask.device)) return refuse(new Forbidden({ message: "this device was removed from this person's devices" }));
    if (list.devices.some((d) => d.device === ask.device)) return refuse(new Conflict({ message: "this device is already one of this person's" }));
    if (live && live.ask.device !== ask.device)
      return refuse(new Conflict({ message: "another device is already asking to join this account: it's gone in 10 minutes, or an app of yours can turn it away" }));
    if (opts.perAccount && !(await opts.perAccount(`account:${user}`))) return refuse(new TooMany({ message: "too many asks for this account; try again in a minute" }));
    const fresh: Enrollment = { id: b64url(crypto.getRandomValues(new Uint8Array(16))), at: now, ask };
    if (!(await store.setEnrollment(user, fresh, stored))) return refuse(new Conflict({ message: "another ask arrived meanwhile; try again" }));
    return answer({ id: fresh.id }, 202);
  }

  const asker = !!live && signer === live.ask.device;
  const app = approver(list, signer, now);

  if (!id && req.method === "GET") {
    if (!live) return refuse(new NotFound({ message: "no device is asking to join this account" }));
    if (!asker && !app) return refuse(new Forbidden({ message: "only the asking device or an app that approves devices reads the ask" }));
    return answer(live);
  }

  if (!id) return refuse(new NotFound({ message: "not found" }));
  if (!live || live.id !== id) return refuse(new NotFound({ message: "that ask is gone" }));

  if (!step && req.method === "DELETE") {
    if (!asker && !app) return refuse(new Forbidden({ message: "only the asking device or an app that approves devices turns an ask away" }));
    if (!(await store.setEnrollment(user, null, stored))) return refuse(new Conflict({ message: "the ask changed meanwhile; read it and try again" }));
    return done();
  }

  if (step === "answer" && req.method === "PUT") {
    if (!app) return refuse(new Forbidden({ message: "only an app that approves devices answers an ask" }));
    const given = readEnrollAnswer(parse(body));
    if (!given || given.device !== app.device || given.dxpk !== app.dxpk)
      return refuse(new BadRequest({ message: "an answer takes {device, dxpk, nonce}: the answering app's own keys and a fresh nonce" }));
    if (live.answer) return refuse(new Conflict({ message: "that ask was already answered" }));
    if (!(await store.setEnrollment(user, { ...live, answer: { ...given, at: now } }, stored))) return refuse(new Conflict({ message: "the ask changed meanwhile; read it and try again" }));
    return done();
  }

  if (step === "reveal" && req.method === "PUT") {
    if (!asker) return refuse(new Forbidden({ message: "only the asking device reveals its nonce" }));
    if (!live.answer) return refuse(new Conflict({ message: "an app answers before the device reveals" }));
    if (live.reveal) return refuse(new Conflict({ message: "that ask was already revealed" }));
    const nonce = parse(body)?.nonce;
    if (typeof nonce !== "string" || !(await revealMatches(live.ask, nonce))) return refuse(new BadRequest({ message: "that nonce doesn't match the ask's commitment" }));
    if (!(await store.setEnrollment(user, { ...live, reveal: { nonce, at: now } }, stored))) return refuse(new Conflict({ message: "the ask changed meanwhile; read it and try again" }));
    return done();
  }

  return refuse(new NotFound({ message: "not found" }));
}
