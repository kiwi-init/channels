import { signRequest } from "./auth.ts";
import { decodeJoinCode, openFrom, sealTo } from "./crypto.ts";
import { currentDevice, speaksForPerson, type DeviceLink, type DeviceList } from "./devices.ts";
import { sign, verify, type Identity } from "./identity.ts";

export const BOOK_MAX_BYTES = 256 * 1024;
const LEFT_KEPT_MS = 30 * 86_400_000;
const BOOK_INFO = "kiwi-channel-book";
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const LABEL_MAX = 200;

export type BookEntry = { room: string; at: number; code: string; label: string } | { room: string; at: number; left: true };

export interface ChannelBook {
  kind: "kiwi-channel-book";
  v: 1;
  person: string;
  device: string;
  at: number;
  channels: BookEntry[];
}

export interface BookSlot {
  device: string;
  at: number;
  box: string;
}

const bookPath = (person: string): string => `/v1/person/${person}/book`;
export const bookScope = (person: string): string => `person:${person}`;

const roomOf = (code: string): string | null => {
  try {
    return decodeJoinCode(code).roomId;
  } catch {
    // A code that doesn't decode names no channel, so the book leaves it out.
    return null;
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function readEntry(x: unknown): BookEntry | null {
  if (!isRecord(x) || typeof x.room !== "string" || typeof x.at !== "number" || !Number.isFinite(x.at)) return null;
  if (x.left === true) return Object.keys(x).length === 3 ? { room: x.room, at: x.at, left: true } : null;
  if (typeof x.code !== "string" || typeof x.label !== "string" || Object.keys(x).length !== 4 || roomOf(x.code) !== x.room) return null;
  return { room: x.room, at: x.at, code: x.code, label: x.label.slice(0, LABEL_MAX) };
}

function readBook(x: unknown): (ChannelBook & { pk: string; sig: string }) | null {
  if (!isRecord(x) || x.kind !== "kiwi-channel-book" || x.v !== 1 || Object.keys(x).length !== 8) return null;
  const { person, device, at, channels, pk, sig } = x;
  if (typeof person !== "string" || typeof device !== "string" || typeof at !== "number" || !Array.isArray(channels)) return null;
  if (typeof pk !== "string" || typeof sig !== "string") return null;
  const read = channels.map(readEntry);
  if (read.some((e) => e === null)) return null;
  return { kind: "kiwi-channel-book", v: 1, person, device, at, channels: read as BookEntry[], pk, sig };
}

export function nextEntries(before: readonly BookEntry[], now: readonly { label: string; code: string }[], at: number): BookEntry[] {
  const held = new Map(before.map((e) => [e.room, e]));
  const out = new Map<string, BookEntry>();
  for (const c of now) {
    const room = roomOf(c.code);
    if (!room || out.has(room)) continue;
    const was = held.get(room);
    out.set(room, { room, at: was && !("left" in was) && was.code === c.code ? was.at : at, code: c.code, label: c.label });
  }
  for (const e of before) {
    if (out.has(e.room)) continue;
    if (!("left" in e)) out.set(e.room, { room: e.room, at, left: true });
    else if (at - e.at < LEFT_KEPT_MS) out.set(e.room, e);
  }
  return [...out.values()];
}

export async function sealBook(writer: Identity, person: string, readers: readonly { device: string; dxpk: string }[], channels: BookEntry[], at: number): Promise<Record<string, string>> {
  const signed = JSON.stringify(await sign(writer, { kind: "kiwi-channel-book" as const, v: 1 as const, person, device: writer.pk, at, channels }));
  const boxes: Record<string, string> = {};
  for (const r of readers) boxes[r.device] = await sealTo(r.dxpk, signed, BOOK_INFO);
  return boxes;
}

export async function openBook(reader: Identity, slot: BookSlot, list: DeviceList, now = Date.now()): Promise<ChannelBook | null> {
  if (!reader.xsk) return null;
  const opened = await openFrom(reader.xsk, slot.box, BOOK_INFO);
  if (opened === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(opened);
  } catch {
    // Sealed to this device but not JSON: nothing in it to follow.
    return null;
  }
  const book = readBook(parsed);
  if (!book || book.pk !== slot.device || book.device !== slot.device || book.at !== slot.at || book.person !== list.person) return null;
  if (!speaksForPerson(list, book.device, now) || !(await verify(book))) return null;
  return { kind: book.kind, v: book.v, person: book.person, device: book.device, at: book.at, channels: book.channels };
}

export function followBooks(books: readonly ChannelBook[]): Map<string, BookEntry> {
  const out = new Map<string, BookEntry>();
  for (const b of books) {
    for (const e of b.channels) {
      const held = out.get(e.room);
      if (!held || e.at > held.at || (e.at === held.at && "left" in held && !("left" in e))) out.set(e.room, e);
    }
  }
  return out;
}

export function bookReaders(list: DeviceList, now = Date.now()): { device: string; dxpk: string }[] {
  return list.devices.filter((d) => !!currentDevice(list, d.device, now) && d.as !== "computer" && KEY_RE.test(d.dxpk)).map((d) => ({ device: d.device, dxpk: d.dxpk }));
}

export interface BookClient {
  slots(): Promise<BookSlot[] | null>;
  put(links: DeviceLink[], at: number, boxes: Record<string, string>): Promise<boolean>;
}

export function bookClient(relay: string, device: Identity, person: string, fetchImpl: typeof fetch = fetch): BookClient {
  const path = bookPath(person);
  const call = async (method: string, body = ""): Promise<Response> =>
    fetchImpl(new URL(path, relay), {
      method,
      headers: { authorization: `Bearer ${await signRequest(device, bookScope(person), method, path, body)}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body } : {}),
    });
  return {
    async slots() {
      const res = await call("GET");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`the relay returned ${res.status} for the channel book`);
      const got = (await res.json()) as { slots?: unknown };
      if (!Array.isArray(got.slots)) return null;
      return got.slots.filter((s): s is BookSlot => isRecord(s) && typeof s.device === "string" && typeof s.at === "number" && typeof s.box === "string");
    },
    async put(links, at, boxes) {
      const res = await call("PUT", JSON.stringify({ links, at, boxes }));
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`the relay returned ${res.status} for the channel book`);
      return true;
    },
  };
}
