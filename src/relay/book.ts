import { verifyRequest } from "@kiwi/core/auth.ts";
import { BOOK_MAX_BYTES, bookScope, type BookSlot } from "@kiwi/core/book.ts";
import { currentDevice, isNewerList, readDeviceList, speaksForPerson, type DeviceList } from "@kiwi/core/devices.ts";
import { BadRequest, Conflict, Forbidden, NotFound, TooLarge, TooMany, Unauthorized } from "./failures.ts";
import { readCapped } from "./http.ts";
import { corsPreflight, withCors } from "./mailbox.ts";
import { errorResponse } from "./room/http.ts";
import { requestToken } from "./room/auth.ts";

const BOOK_PATH = /^\/v1\/person\/([A-Za-z0-9_-]{43})\/book$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

export interface StoredSlot {
  device: string;
  at: number;
  boxes: Record<string, string>;
}

export interface BookStore {
  links(person: string): Promise<unknown[] | null>;
  slots(person: string): Promise<StoredSlot[]>;
  keep(person: string, links: unknown[], slot: StoredSlot, drop: readonly string[]): Promise<void>;
}

export const bookPerson = (pathname: string): string | null => BOOK_PATH.exec(pathname)?.[1] ?? null;

const refuse = (err: unknown): Response => withCors(errorResponse(err));

export async function signedBookRequest(req: Request, now: number): Promise<Response | null> {
  const url = new URL(req.url);
  const person = bookPerson(url.pathname);
  if (!person || (req.method !== "GET" && req.method !== "PUT")) return refuse(new NotFound({ message: "not found" }));
  const bytes = req.method === "PUT" ? await readCapped(req, BOOK_MAX_BYTES) : new Uint8Array(0);
  if (bytes === null) return refuse(new TooLarge({ message: "that channel book is too large" }));
  const token = requestToken(req);
  const signer = token ? await verifyRequest(token, bookScope(person), req.method, url.pathname, new TextDecoder().decode(bytes), now) : null;
  return signer ? null : refuse(new Unauthorized({ message: "sign this request for this person and path" }));
}

async function keptList(store: BookStore, person: string): Promise<{ links: unknown[]; list: DeviceList } | null> {
  const links = await store.links(person);
  if (!links) return null;
  const read = await readDeviceList(links);
  return read.ok && read.list.person === person ? { links, list: read.list } : null;
}

function boxesOf(raw: unknown, list: DeviceList, now: number): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [device, box] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY_RE.test(device) || typeof box !== "string") return null;
    if (currentDevice(list, device, now)) out[device] = box;
  }
  return out;
}

export async function onBookHttp(req: Request, store: BookStore, opts: { now?: () => number; perAddress?: () => boolean | Promise<boolean> } = {}): Promise<Response | null> {
  const url = new URL(req.url);
  const person = bookPerson(url.pathname);
  if (!person) return null;
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET" && req.method !== "PUT") return refuse(new NotFound({ message: "not found" }));
  const now = (opts.now ?? Date.now)();
  const writes = req.method === "PUT";
  const bytes = writes ? await readCapped(req, BOOK_MAX_BYTES) : new Uint8Array(0);
  if (bytes === null) return refuse(new TooLarge({ message: "that channel book is too large" }));
  if (writes && opts.perAddress && !(await opts.perAddress())) return refuse(new TooMany({ message: "too many channel book writes from this address; try again in a few minutes" }));
  const body = new TextDecoder().decode(bytes);
  const token = requestToken(req);
  const signer = token ? await verifyRequest(token, bookScope(person), req.method, url.pathname, body, now) : null;
  if (!signer) return refuse(new Unauthorized({ message: "sign this request for this person and path" }));
  const kept = await keptList(store, person);

  if (!writes) {
    if (!kept) return withCors(Response.json({ slots: [] }));
    if (signer !== person && !currentDevice(kept.list, signer, now)) return refuse(new Forbidden({ message: "only the person's own devices read their channel book" }));
    const slots: BookSlot[] = (await store.slots(person)).flatMap((s) => {
      const box = s.boxes[signer];
      return box && speaksForPerson(kept.list, s.device, now) ? [{ device: s.device, at: s.at, box }] : [];
    });
    return withCors(Response.json({ slots }));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON: refused below like any other malformed book.
    parsed = null;
  }
  const given = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  if (!Array.isArray(given.links) || typeof given.at !== "number" || !Number.isFinite(given.at)) {
    return refuse(new BadRequest({ message: "a channel book takes {links, at, boxes}" }));
  }
  const read = await readDeviceList(given.links);
  if (!read.ok) return refuse(new BadRequest({ message: `that device list doesn't hold up: ${read.why}` }));
  if (read.list.person !== person) return refuse(new BadRequest({ message: "that device list is another person's" }));
  const newer = !kept || isNewerList(read.list, kept.list);
  const list = newer ? read.list : kept.list;
  const links = newer ? given.links : kept.links;
  if (!speaksForPerson(list, signer, now)) return refuse(new Forbidden({ message: "only the person or an app that approves devices writes their channel book" }));
  const boxes = boxesOf(given.boxes, list, now);
  if (!boxes) return refuse(new BadRequest({ message: "a channel book's boxes are {device key: sealed box}" }));
  const slots = await store.slots(person);
  const prior = slots.find((s) => s.device === signer);
  if (prior && prior.at >= given.at) return refuse(new Conflict({ message: "a newer channel book from this device is already kept" }));
  const drop = slots.filter((s) => s.device !== signer && !speaksForPerson(list, s.device, now)).map((s) => s.device);
  await store.keep(person, links, { device: signer, at: given.at, boxes }, drop);
  return withCors(new Response(null, { status: 204 }));
}
