import { verifyRequest } from "@kiwi/core/auth.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { listedComputer, newestLists, readDeviceList, speaksForPerson, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { ASK_MAX_BYTES } from "@kiwi/core/machine-ask.ts";
import { readMachineCert } from "@kiwi/core/person.ts";
import { BadRequest, Conflict, Forbidden, NotFound, TooLarge, TooMany, Unauthorized, UpdateRequired } from "./failures.ts";
import { readCapped } from "./http.ts";
import { corsPreflight, withCors } from "./mailbox.ts";
import { errorResponse } from "./room/http.ts";
import { requestToken } from "./room/auth.ts";

export const MACHINE_BOX_TTL_MS = 3 * 60_000;
export const MACHINE_UNSEEN_MS = 30 * 24 * 3_600_000;
export const MACHINE_ASKS_PER_MINUTE = 20;
export const MACHINE_WRITES_PER_ADDRESS = 60;
const MACHINE_PENDING_MAX = 20;
const REGISTER_MAX_BYTES = 8_192;
const INBOX_MAX_BYTES = ASK_MAX_BYTES + 256;

export interface MachineBinding {
  person: string;
  mxpk: string;
  label: string;
  certAt: number;
  seenAt: number;
}

export interface MachineBox {
  id: string;
  box: string;
  at: number;
}

export interface MachineStore {
  binding(mpk: string): Promise<MachineBinding | null>;
  revoked(mpk: string): Promise<boolean>;
  floor(mpk: string): Promise<number>;
  bind(mpk: string, b: MachineBinding): Promise<void>;
  seen(mpk: string, at: number): Promise<void>;
  unbind(mpk: string): Promise<void>;
  links(mpk: string): Promise<unknown[] | null>;
  keepLinks(mpk: string, links: unknown[] | null): Promise<void>;
  pending(mpk: string, since: number): Promise<number>;
  boxes(mpk: string, since: number): Promise<MachineBox[]>;
  addBox(mpk: string, b: MachineBox): Promise<void>;
  dropBox(mpk: string, id: string): Promise<void>;
  online(mpk: string): number | null;
  push(mpk: string, b: MachineBox): void;
  close(mpk: string): void;
}

export interface PersonMachine {
  key: string;
  xpk: string;
  label: string;
  online: boolean;
  since?: number;
  seenAt: number;
}

export interface PersonMachinesStore {
  machines(person: string): Promise<PersonMachine[]>;
  lists(person: string): Promise<unknown[][]>;
}

export type MachineOutcome = Response | { upgrade: string } | null;

const PATH = /^\/v1\/machine\/([A-Za-z0-9_-]{43})(?:\/(inbox|ws)(?:\/([A-Za-z0-9_-]{22}))?)?$/;

const PERSON_PATH = /^\/v1\/person\/([A-Za-z0-9_-]{43})\/machines$/;

export const machineScope = (mpk: string): string => `machine:${mpk}`;

export const personScope = (pk: string): string => `person:${pk}`;

export function personMachine(mpk: string, b: MachineBinding, online: number | null): PersonMachine {
  return { key: mpk, xpk: b.mxpk, label: b.label, online: online !== null, ...(online === null ? {} : { since: online }), seenAt: b.seenAt };
}

const refuse = (err: unknown): Response => withCors(errorResponse(err));
const answer = (data: unknown, status = 200): Response => withCors(Response.json(data, { status }));
const done = (): Response => withCors(new Response(null, { status: 204 }));

export function machineAlarmAt(oldestBoxAt: number | null, seenAt: number | null): number | null {
  const times = [...(oldestBoxAt === null ? [] : [oldestBoxAt + MACHINE_BOX_TTL_MS]), ...(seenAt === null ? [] : [seenAt + MACHINE_UNSEEN_MS])];
  return times.length ? Math.min(...times) : null;
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    // Not JSON: refused as a bad request by the caller.
    return null;
  }
}

async function listOf(links: unknown[] | null): Promise<DeviceList | null> {
  if (!links) return null;
  const read = await readDeviceList(links);
  return read.ok ? read.list : null;
}

async function keptList(store: MachineStore, mpk: string, person: string): Promise<DeviceList | null> {
  const list = await listOf(await store.links(mpk));
  return list?.person === person ? list : null;
}

async function speaksForMachine(store: MachineStore, mpk: string, signer: string, now: number): Promise<boolean> {
  const bound = await store.binding(mpk);
  if (!bound) return false;
  if (signer === bound.person) return true;
  const list = await keptList(store, mpk, bound.person);
  return !!list && speaksForPerson(list, signer, now);
}

export async function takeNewerList(store: MachineStore, mpk: string, links: unknown[], now: number): Promise<void> {
  const bound = await store.binding(mpk);
  const next = await listOf(links);
  if (!bound || !next || next.person !== bound.person) return;
  const kept = await keptList(store, mpk, bound.person);
  if (kept && next.version <= kept.version) return;
  if (!listedComputer(next, mpk, now)) {
    if (!kept) return;
    await store.unbind(mpk);
    store.close(mpk);
    return;
  }
  await store.keepLinks(mpk, links);
  if (!kept) store.close(mpk);
}

async function register(store: MachineStore, mpk: string, body: Record<string, unknown> | null, now: number): Promise<Response> {
  const bound = await store.binding(mpk);
  const floor = await store.floor(mpk);
  const links = body?.["links"];
  if (Array.isArray(links)) {
    const list = await listOf(links);
    const computer = list ? listedComputer(list, mpk, now) : null;
    if (!list || !computer) return refuse(new BadRequest({ message: "a machine registers with a device list that lists it as a current computer" }));
    const certAt = (links[links.length - 1] as DeviceLink).at;
    const kept = bound ? await keptList(store, mpk, list.person) : null;
    if (kept && list.version < kept.version) return refuse(new Conflict({ message: "a newer device list was registered for this machine" }));
    if (!kept && (bound ? certAt < bound.certAt : floor > 0 && certAt <= floor)) return refuse(new Conflict({ message: "a newer cert was registered for this machine" }));
    await store.bind(mpk, { person: list.person, mxpk: computer.dxpk, label: computer.label, certAt: Math.max(certAt, kept ? bound!.certAt : 0), seenAt: now });
    await store.keepLinks(mpk, links);
    return done();
  }
  const cert = await readMachineCert(body?.["cert"]);
  if (!cert || cert.machine !== mpk) return refuse(new BadRequest({ message: "a machine registers with its own cert" }));
  if (bound ? cert.at < bound.certAt : floor > 0 && cert.at <= floor) return refuse(new Conflict({ message: "a newer cert was registered for this machine" }));
  const kept = bound?.person === cert.pk ? await keptList(store, mpk, cert.pk) : null;
  const listed = kept && listedComputer(kept, mpk, now) ? await store.links(mpk) : null;
  await store.bind(mpk, { person: cert.pk, mxpk: cert.mxpk, label: cert.label, certAt: cert.at, seenAt: now });
  await store.keepLinks(mpk, listed);
  return listed ? answer({ links: listed }) : done();
}

export interface MachineRequest {
  mpk: string;
  sub: string | undefined;
  boxId: string | undefined;
  signer: string;
  body: string;
}

export async function signedMachineRequest(req: Request, now: number): Promise<MachineRequest | Response | null> {
  const url = new URL(req.url);
  const m = PATH.exec(url.pathname);
  if (!m) return null;
  const mpk = m[1]!;
  const sub = m[2];
  const max = sub === "inbox" ? INBOX_MAX_BYTES : REGISTER_MAX_BYTES;
  const bytes = req.method === "PUT" || req.method === "POST" ? await readCapped(req, max) : new Uint8Array(0);
  if (bytes === null) return refuse(new TooLarge({ message: "that request is too large for a machine route" }));
  const body = new TextDecoder().decode(bytes);
  const token = requestToken(req);
  const signer = token ? await verifyRequest(token, machineScope(mpk), req.method, url.pathname, body, now) : null;
  if (!signer) return refuse(new Unauthorized({ message: "sign this request for this machine and path" }));
  return { mpk, sub, boxId: m[3], signer, body };
}

export async function onMachineHttp(
  req: Request,
  store: MachineStore,
  opts: { now?: () => number; perMachine?: (key: string) => boolean | Promise<boolean>; perAddress?: () => boolean | Promise<boolean> } = {},
): Promise<MachineOutcome> {
  if (!PATH.test(new URL(req.url).pathname)) return null;
  if (req.method === "OPTIONS") return corsPreflight();
  const now = (opts.now ?? Date.now)();
  const signed = await signedMachineRequest(req, now);
  if (!signed || signed instanceof Response) return signed;
  const { mpk, sub, boxId, signer, body } = signed;
  if (await store.revoked(mpk)) return refuse(new Forbidden({ message: "this computer was removed from its person's devices" }));
  const bound = await store.binding(mpk);
  const isMachine = signer === mpk;
  const isPerson = await speaksForMachine(store, mpk, signer, now);
  const writes = (req.method === "PUT" || req.method === "POST") && opts.perAddress && !(await opts.perAddress());
  if (writes) return refuse(new TooMany({ message: "too many machine requests from this address; try again in a few minutes" }));

  if (!sub && req.method === "PUT") {
    if (!isMachine) return refuse(new Forbidden({ message: "only the machine registers itself" }));
    return register(store, mpk, parse(body), now);
  }
  if (!sub && req.method === "DELETE") {
    if (!isMachine && !isPerson) return refuse(new Forbidden({ message: "only the machine or its person unpairs it" }));
    await store.unbind(mpk);
    store.close(mpk);
    return done();
  }
  if (!sub && req.method === "GET") {
    if (!isPerson) return refuse(new Forbidden({ message: "only the machine's person sees whether it's online" }));
    const since = store.online(mpk);
    return answer(since === null ? { online: false } : { online: true, since });
  }
  if (sub === "inbox" && !boxId && req.method === "POST") {
    if (!isPerson) return refuse(new Forbidden({ message: "only the machine's person writes to its inbox" }));
    const box = parse(body)?.box;
    if (typeof box !== "string" || !box || box.length > ASK_MAX_BYTES) return refuse(new BadRequest({ message: "an inbox takes {box}, at most 4096 bytes" }));
    if (opts.perMachine && !(await opts.perMachine(machineScope(mpk)))) return refuse(new TooMany({ message: "too many asks for this machine; try again in a minute" }));
    if ((await store.pending(mpk, now - MACHINE_BOX_TTL_MS)) >= MACHINE_PENDING_MAX) return refuse(new TooMany({ message: "this machine already has 20 asks waiting" }));
    const kept: MachineBox = { id: b64url(crypto.getRandomValues(new Uint8Array(16))), box, at: now };
    await store.addBox(mpk, kept);
    store.push(mpk, kept);
    return answer({ id: kept.id }, 202);
  }
  if (sub === "inbox" && !boxId && req.method === "GET") {
    if (!isMachine || !bound) return refuse(new Forbidden({ message: "only a registered machine reads its inbox" }));
    return answer({ boxes: await store.boxes(mpk, now - MACHINE_BOX_TTL_MS) });
  }
  if (sub === "inbox" && boxId && req.method === "DELETE") {
    if (!isMachine) return refuse(new Forbidden({ message: "only the machine takes asks out of its inbox" }));
    await store.dropBox(mpk, boxId);
    return done();
  }
  if (sub === "ws" && req.method === "GET") {
    if (!isMachine || !bound) return refuse(new Forbidden({ message: "only a registered machine opens its inbox" }));
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return refuse(new UpdateRequired({ message: "expected websocket" }));
    await store.seen(mpk, now);
    return { upgrade: mpk };
  }
  return refuse(new NotFound({ message: "not found" }));
}

export async function signedPersonRequest(req: Request, now: number): Promise<{ pk: string; signer: string } | Response | null> {
  const url = new URL(req.url);
  const m = PERSON_PATH.exec(url.pathname);
  if (!m) return null;
  const pk = m[1]!;
  if (req.method !== "GET") return refuse(new NotFound({ message: "not found" }));
  const token = requestToken(req);
  const signer = token ? await verifyRequest(token, personScope(pk), "GET", url.pathname, "", now) : null;
  if (!signer) return refuse(new Unauthorized({ message: "sign this request for this person and path" }));
  return { pk, signer };
}

export async function onPersonHttp(req: Request, store: PersonMachinesStore, opts: { now?: () => number } = {}): Promise<Response | null> {
  if (!PERSON_PATH.test(new URL(req.url).pathname)) return null;
  if (req.method === "OPTIONS") return corsPreflight();
  const now = (opts.now ?? Date.now)();
  const signed = await signedPersonRequest(req, now);
  if (signed === null || signed instanceof Response) return signed;
  const { pk, signer } = signed;
  if (signer !== pk) {
    const lists = await newestLists(await store.lists(pk));
    const list = lists.get(pk);
    if (!list || !speaksForPerson(list, signer, now)) return refuse(new Forbidden({ message: "only the person or one of their current approving devices lists their computers" }));
  }
  const machines = await store.machines(pk);
  return answer({ machines: machines.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key)) });
}
