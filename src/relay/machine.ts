import { verifyRequest } from "@kiwi/core/auth.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { readMachineCert } from "@kiwi/core/person.ts";
import { corsPreflight, withCors } from "./mailbox.ts";
import { requestToken } from "./room/auth.ts";

export const MACHINE_BOX_TTL_MS = 10 * 60_000;
const MACHINE_PENDING_MAX = 20;
export const MACHINE_BOX_MAX_BYTES = 4_096;
export const MACHINE_ASKS_PER_MINUTE = 20;
const REGISTER_MAX_BYTES = 8_192;

interface MachineBinding {
  person: string;
  mxpk: string;
  certAt: number;
}

export interface MachineBox {
  id: string;
  box: string;
  at: number;
}

export interface MachineStore {
  binding(mpk: string): Promise<MachineBinding | null>;
  bind(mpk: string, b: MachineBinding): Promise<void>;
  unbind(mpk: string): Promise<void>;
  boxes(mpk: string): Promise<MachineBox[]>;
  addBox(mpk: string, b: MachineBox): Promise<void>;
  dropBox(mpk: string, id: string): Promise<void>;
  online(mpk: string): number | null;
  push(mpk: string, b: MachineBox): void;
  close(mpk: string): void;
}

export type MachineOutcome = Response | { upgrade: string } | null;

const PATH = /^\/v1\/machine\/([A-Za-z0-9_-]{43})(?:\/(inbox|ws)(?:\/([A-Za-z0-9_-]{22}))?)?$/;

export const machineScope = (mpk: string): string => `machine:${mpk}`;

const answer = (data: unknown, status = 200): Response => withCors(Response.json(data, { status }));
const refuse = (status: number, tag: string, error: string): Response => answer({ error, tag }, status);
const done = (): Response => withCors(new Response(null, { status: 204 }));

function newBoxId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

async function readBody(req: Request, max: number): Promise<string | null> {
  const text = await req.text();
  return new TextEncoder().encode(text).length > max ? null : text;
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

export async function onMachineHttp(req: Request, store: MachineStore, opts: { now?: () => number; allow?: (key: string) => boolean | Promise<boolean> } = {}): Promise<MachineOutcome> {
  const url = new URL(req.url);
  const m = PATH.exec(url.pathname);
  if (!m) return null;
  if (req.method === "OPTIONS") return corsPreflight();
  const mpk = m[1]!;
  const sub = m[2];
  const boxId = m[3];
  const now = (opts.now ?? Date.now)();
  const max = sub === "inbox" && req.method === "POST" ? MACHINE_BOX_MAX_BYTES + 256 : REGISTER_MAX_BYTES;
  const body = req.method === "GET" || req.method === "DELETE" ? "" : await readBody(req, max);
  if (body === null) return refuse(413, "TooLarge", `at most ${max} bytes`);
  const token = requestToken(req);
  const signer = token ? await verifyRequest(token, machineScope(mpk), req.method, url.pathname, body, now) : null;
  if (!signer) return refuse(401, "Unauthorized", "sign this request for this machine and path");
  const bound = await store.binding(mpk);
  const isMachine = signer === mpk;
  const isPerson = !!bound && signer === bound.person;

  if (!sub && req.method === "PUT") {
    if (!isMachine) return refuse(403, "Forbidden", "only the machine registers itself");
    const cert = await readMachineCert(parse(body)?.cert);
    if (!cert || cert.machine !== mpk) return refuse(400, "BadRequest", "a machine registers with its own cert");
    if (bound && bound.certAt > cert.at) return refuse(409, "Conflict", "a newer cert is registered for this machine");
    await store.bind(mpk, { person: cert.pk, mxpk: cert.mxpk, certAt: cert.at });
    return done();
  }
  if (!sub && req.method === "DELETE") {
    if (!isMachine && !isPerson) return refuse(403, "Forbidden", "only the machine or its person unpairs it");
    await store.unbind(mpk);
    store.close(mpk);
    return done();
  }
  if (!sub && req.method === "GET") {
    if (!isPerson) return refuse(403, "Forbidden", "only the machine's person sees whether it's online");
    const since = store.online(mpk);
    return answer(since === null ? { online: false } : { online: true, since });
  }
  if (sub === "inbox" && !boxId && req.method === "POST") {
    if (!isPerson) return refuse(403, "Forbidden", "only the machine's person writes to its inbox");
    const box = parse(body)?.box;
    if (typeof box !== "string" || !box || box.length > MACHINE_BOX_MAX_BYTES) return refuse(400, "BadRequest", `an inbox takes {box}, at most ${MACHINE_BOX_MAX_BYTES} bytes`);
    if (opts.allow && !(await opts.allow(machineScope(mpk)))) return refuse(429, "TooMany", "too many asks for this machine; try again in a minute");
    const live = (await store.boxes(mpk)).filter((b) => now - b.at <= MACHINE_BOX_TTL_MS);
    if (live.length >= MACHINE_PENDING_MAX) return refuse(429, "TooMany", `this machine already has ${MACHINE_PENDING_MAX} asks waiting`);
    const kept: MachineBox = { id: newBoxId(), box, at: now };
    await store.addBox(mpk, kept);
    store.push(mpk, kept);
    return answer({ id: kept.id }, 202);
  }
  if (sub === "inbox" && !boxId && req.method === "GET") {
    if (!isMachine || !bound) return refuse(403, "Forbidden", "only a registered machine reads its inbox");
    const all = await store.boxes(mpk);
    for (const b of all) if (now - b.at > MACHINE_BOX_TTL_MS) await store.dropBox(mpk, b.id);
    return answer({ boxes: all.filter((b) => now - b.at <= MACHINE_BOX_TTL_MS) });
  }
  if (sub === "inbox" && boxId && req.method === "DELETE") {
    if (!isMachine) return refuse(403, "Forbidden", "only the machine takes asks out of its inbox");
    await store.dropBox(mpk, boxId);
    return done();
  }
  if (sub === "ws" && req.method === "GET") {
    if (!isMachine || !bound) return refuse(403, "Forbidden", "only a registered machine opens its inbox");
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return refuse(426, "UpgradeRequired", "expected websocket");
    return { upgrade: mpk };
  }
  return refuse(405, "MethodNotAllowed", "see src/relay/machine.ts for the machine routes");
}
