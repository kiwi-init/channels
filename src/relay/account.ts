import { AUTH_SKEW_MS, verifyRequest } from "@kiwi/core/auth.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { approvingDevice, readDeviceList, speaksForPerson, type Device, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { accountScope, ENROLL_TTL_MS, readEnrollAnswer, readEnrollAsk, revealMatches, type Enrollment } from "@kiwi/core/enroll.ts";
import { canonical } from "@kiwi/core/identity.ts";
import { checkVault, readRecovery, type Recovery, type RecoveryLink, type Vault } from "@kiwi/core/recovery.ts";
import { BadRequest, Conflict, Forbidden, NotFound, SignInRequired, TooLarge, TooMany, Unauthorized } from "./failures.ts";
import { readCapped } from "./http.ts";
import { HUMAN_HEADER, type HumanAuth } from "./human.ts";
import { corsPreflight, withCors } from "./mailbox.ts";
import { errorResponse } from "./room/http.ts";
import { requestToken } from "./room/auth.ts";

export const ACCOUNT_ASKS_PER_MINUTE = 5;
const LIST_MAX_BYTES = 768 * 1024;
const ASK_MAX_BYTES = 4096;
const VAULT_MAX_BYTES = 1024 * 1024;

export interface AccountStore {
  links(user: string): Promise<unknown[]>;
  extend(user: string, from: number, links: DeviceLink[]): Promise<boolean>;
  enrollment(user: string): Promise<Enrollment | null>;
  setEnrollment(user: string, next: Enrollment | null, prev: Enrollment | null): Promise<boolean>;
  revoke(keys: string[]): Promise<void>;
  tellComputers(keys: string[], links: unknown[]): Promise<void>;
  recovery(user: string): Promise<unknown[]>;
  extendRecovery(user: string, from: number, links: RecoveryLink[]): Promise<boolean>;
  vault(user: string): Promise<Vault | null>;
  setVault(user: string, next: Vault, prev: number): Promise<boolean>;
}

const PATH = /^\/v1\/account(?:\/vault|\/ask(?:\/([A-Za-z0-9_-]{22})(?:\/(answer|reveal))?)?)?$/;
const VAULT_PATH = "/v1/account/vault";

export const isAccountPath = (pathname: string): boolean => PATH.test(pathname);

const NO_APPROVER = "no app of this account can approve a device yet: sign in on your first app";
const NO_GITHUB_APPROVER = "nothing on this GitHub sign-in can approve a device yet: open Channels on your computer once to move your devices to your GitHub sign-in, then try again";

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

const approver = (list: DeviceList | null, pk: string, now: number): Device | null => (list ? approvingDevice(list, pk, now) : null);

async function kept(store: AccountStore, user: string): Promise<{ links: unknown[]; list: DeviceList | null }> {
  const links = await store.links(user);
  if (!links.length) return { links, list: null };
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(`a kept device list doesn't hold up: ${read.why}`);
  return { links, list: read.list };
}

async function keptRecovery(store: AccountStore, user: string, list: DeviceList | null, now: number): Promise<{ chain: unknown[]; recovery: Recovery | null }> {
  const chain = await store.recovery(user);
  if (!chain.length || !list) return { chain, recovery: null };
  const read = await readRecovery(chain, list, now);
  if (!read.ok) throw new Error(`a kept recovery chain doesn't hold up: ${read.why}`);
  return { chain, recovery: read.recovery };
}

async function keepVault(store: AccountStore, user: string, list: DeviceList | null, signer: string, body: Record<string, unknown> | null, now: number): Promise<Response> {
  const raw = body?.["recovery"];
  const vault = body?.["vault"];
  if (!body || (raw !== undefined && !Array.isArray(raw)) || (raw === undefined && vault === undefined))
    return refuse(new BadRequest({ message: "a vault update takes {recovery, vault}: the recovery chain, the sealed vault, or both" }));
  if (!list) return refuse(new NotFound({ message: "publish the device list before a recovery key" }));
  const { chain, recovery: kept } = await keptRecovery(store, user, list, now);
  let recovery = kept;
  if (!speaksForPerson(list, signer, now) && signer !== recovery?.rpk)
    return refuse(new Forbidden({ message: "only the person key, the recovery key or an app that approves devices keeps the vault" }));
  if (Array.isArray(raw)) {
    if (raw.length < chain.length) return refuse(new Conflict({ message: "a newer recovery chain is already kept" }));
    if (chain.some((l, i) => canonical(l) !== canonical(raw[i]))) return refuse(new Conflict({ message: "that recovery chain doesn't extend the one kept" }));
    const read = await readRecovery(raw, list, now);
    if (!read.ok) return refuse(new BadRequest({ message: `that recovery chain doesn't hold up: ${read.why}` }));
    const fresh = raw.slice(chain.length) as RecoveryLink[];
    if (fresh.some((l) => list.revoked.includes(l.pk))) return refuse(new Forbidden({ message: "a removed device can't change the recovery key" }));
    if (fresh.some((l) => Math.abs(l.at - now) > AUTH_SKEW_MS)) return refuse(new BadRequest({ message: "a new recovery link carries the time it's sent, and this one doesn't" }));
    if (fresh.length && !(await store.extendRecovery(user, chain.length, fresh))) return refuse(new Conflict({ message: "the recovery chain changed meanwhile; read it and try again" }));
    recovery = read.recovery;
  }
  if (vault === undefined) return done();
  if (!recovery) return refuse(new Conflict({ message: "set up a recovery key before its vault" }));
  const bad = await checkVault(vault, list);
  if (bad) return refuse(new BadRequest({ message: `that vault doesn't hold up: ${bad}` }));
  const next = vault as Vault;
  if (!speaksForPerson(list, next.pk, now)) return refuse(new Forbidden({ message: "the vault is signed by a key that isn't one of this person's current approving devices" }));
  const prev = await store.vault(user);
  const known = prev?.version ?? 0;
  if (prev && canonical(prev) === canonical(next)) return done();
  if (next.version <= known) return refuse(new Conflict({ message: `vault version ${known} is already kept, so version ${next.version} is too old` }));
  if (next.version !== known + 1) return refuse(new BadRequest({ message: `vault version ${next.version} doesn't follow version ${known}` }));
  if (!(await store.setVault(user, next, known))) return refuse(new Conflict({ message: "the vault changed meanwhile; read it and try again" }));
  return done();
}

export async function onAccountHttp(
  req: Request,
  store: AccountStore,
  user: string,
  opts: { now?: () => number; perAccount?: (key: string) => boolean | Promise<boolean>; perAddress?: () => boolean | Promise<boolean>; formerly?: string } = {},
): Promise<Response | null> {
  const url = new URL(req.url);
  const m = PATH.exec(url.pathname);
  if (!m) return null;
  if (req.method === "OPTIONS") return corsPreflight();
  const now = (opts.now ?? Date.now)();
  const onVault = url.pathname === VAULT_PATH;
  const onAsk = url.pathname !== "/v1/account" && !onVault;
  const id = m[1];
  const step = m[2];
  const writes = req.method === "PUT" || req.method === "POST";
  const bytes = writes ? await readCapped(req, onAsk ? ASK_MAX_BYTES : onVault ? VAULT_MAX_BYTES : LIST_MAX_BYTES) : new Uint8Array(0);
  if (bytes === null) return refuse(new TooLarge({ message: "that request is too large for an account route" }));
  if (writes && opts.perAddress && !(await opts.perAddress())) return refuse(new TooMany({ message: "too many account requests from this address; try again in a few minutes" }));
  const body = new TextDecoder().decode(bytes);
  const { links, list } = await kept(store, user);

  if (onVault && req.method === "GET") return answer({ recovery: await store.recovery(user), vault: await store.vault(user) });
  if (!onAsk && req.method === "GET") return answer({ user, links });

  const token = requestToken(req);
  const signedFor = (scope: string) => verifyRequest(token, accountScope(scope), req.method, url.pathname, body, now);
  const signer = token ? ((await signedFor(user)) ?? (opts.formerly ? await signedFor(opts.formerly) : null)) : null;
  if (!signer) return refuse(new Unauthorized({ message: "sign this request for this account and path" }));
  if (list?.revoked.includes(signer)) return refuse(new Forbidden({ message: "this device was removed from this person's devices" }));

  if (onVault) return req.method === "PUT" ? keepVault(store, user, list, signer, parse(body), now) : refuse(new NotFound({ message: "not found" }));

  if (!onAsk && req.method === "PUT") {
    const raw = parse(body)?.links;
    if (!Array.isArray(raw)) return refuse(new BadRequest({ message: "an account takes {links}, the person's device list" }));
    const read = await readDeviceList(raw);
    if (!read.ok) return refuse(new BadRequest({ message: `that device list doesn't hold up: ${read.why}` }));
    const next = read.list;
    if (!speaksForPerson(next, signer, now)) return refuse(new Forbidden({ message: "only the person key or an app that approves devices publishes their list" }));
    if (list && next.person !== list.person) return refuse(new Conflict({ message: "this account belongs to another person key" }));
    if (raw.length < links.length) return refuse(new Conflict({ message: "a newer device list is already kept" }));
    if (links.some((l, i) => canonical(l) !== canonical(raw[i]))) return refuse(new Conflict({ message: "that list doesn't extend the one kept" }));
    if (raw.length === links.length) return done();
    const reroots = (raw.slice(links.length) as DeviceLink[]).flatMap((l) => (l.op === "reroot" ? [l] : []));
    if (reroots.length) {
      const chain = await store.recovery(user);
      if (reroots.some((l) => Math.abs(l.at - now) > AUTH_SKEW_MS)) return refuse(new BadRequest({ message: "a re-root carries the time it's sent, and this one doesn't" }));
      if (reroots.some((l) => canonical(l.recovery) !== canonical(chain)))
        return refuse(new Conflict({ message: "a re-root is signed against the recovery chain this account keeps, and this one isn't" }));
    }
    if (!(await store.extend(user, links.length, raw.slice(links.length) as DeviceLink[]))) return refuse(new Conflict({ message: "the device list changed meanwhile; read it and try again" }));
    const cut = next.revoked.filter((k) => !list?.revoked.includes(k));
    if (cut.length) await store.revoke(cut);
    const computers = next.devices.filter((d) => d.as === "computer").map((d) => d.device);
    if (computers.length) await store.tellComputers(computers, raw);
    return done();
  }

  const stored = await store.enrollment(user);
  const live = enrollmentLive(stored, now);

  if (!id && req.method === "POST") {
    const ask = readEnrollAsk(parse(body)?.ask);
    if (!ask) return refuse(new BadRequest({ message: "an ask takes {ask}: device, dxpk, label, os, as, at and commit" }));
    if (signer !== ask.device) return refuse(new Forbidden({ message: "a device asks to join for itself" }));
    if (!list) return refuse(user.startsWith("github_") ? new NotFound({ message: NO_GITHUB_APPROVER }) : new NotFound({ message: NO_APPROVER }));
    if (list.revoked.includes(ask.device)) return refuse(new Forbidden({ message: "this device was removed from this person's devices" }));
    if (list.devices.some((d) => d.device === ask.device)) return refuse(new Conflict({ message: "this device is already one of this person's" }));
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
