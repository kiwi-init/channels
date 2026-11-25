import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bookClient, bookReaders, followBooks, nextEntries, openBook, sealBook, type BookEntry, type ChannelBook } from "@kiwi/core/book.ts";
import { encodeJoinCode, newRoomId, ownerFingerprint } from "@kiwi/core/crypto.ts";
import { certUntil, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-book-relay-"));
let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const key = async (name: string): Promise<Identity> => withExchangeKey(await generateIdentity(name));
const codeFor = async (): Promise<string> => encodeJoinCode({ roomId: newRoomId(), ownerFp: await ownerFingerprint((await generateIdentity("owner")).pk) });

async function listOf(links: DeviceLink[]): Promise<DeviceList> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return read.list;
}

async function household(): Promise<{ person: Identity; desk: Identity; phone: Identity; links: DeviceLink[] }> {
  const person = await key("Jow");
  const desk = await key("desk");
  const phone = await key("phone");
  const root = await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "studio", os: "macOS", as: "desktop" });
  const add = await nextLink(await listOf([root]), desk, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "iPhone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) });
  return { person, desk, phone, links: [root, add] };
}

async function publish(writer: Identity, person: string, links: DeviceLink[], entries: BookEntry[], at: number): Promise<boolean> {
  const list = await listOf(links);
  return bookClient(relay, writer, person).put(links, at, await sealBook(writer, person, bookReaders(list), entries, at));
}

async function read(reader: Identity, person: string, links: DeviceLink[]): Promise<ChannelBook[]> {
  const list = await listOf(links);
  const slots = (await bookClient(relay, reader, person).slots()) ?? [];
  return (await Promise.all(slots.map((s) => openBook(reader, s, list)))).filter((b): b is ChannelBook => !!b);
}

describe("the channel book at the relay (T30)", () => {
  test("a desktop writes its channels sealed to each device, and the phone opens them", async () => {
    const h = await household();
    const a = await codeFor();
    const entries = nextEntries([], [{ label: "onemouse", code: a }], 1_000);
    expect(await publish(h.desk, h.person.pk, h.links, entries, Date.now())).toBe(true);
    const books = await read(h.phone, h.person.pk, h.links);
    expect(books).toHaveLength(1);
    expect(books[0]!.channels).toEqual(entries);
    expect((await read(h.desk, h.person.pk, h.links))[0]!.channels).toEqual(entries);
  });

  test("a stranger's key can neither write nor read the book", async () => {
    const h = await household();
    const stranger = await key("stranger");
    await publish(h.desk, h.person.pk, h.links, nextEntries([], [{ label: "onemouse", code: await codeFor() }], 1), Date.now());
    await expect(publish(stranger, h.person.pk, h.links, [], Date.now() + 1)).rejects.toThrow("403");
    await expect(bookClient(relay, stranger, h.person.pk).slots()).rejects.toThrow("403");
  });

  test("a phone can't write the book, and an older write from the same desktop is turned away", async () => {
    const h = await household();
    const at = Date.now();
    await publish(h.desk, h.person.pk, h.links, [], at);
    await expect(publish(h.phone, h.person.pk, h.links, [], at + 1)).rejects.toThrow("403");
    await expect(publish(h.desk, h.person.pk, h.links, [], at - 1)).rejects.toThrow("409");
  });

  test("two desktops keep a slot each, and a revoked desktop's slot is dropped", async () => {
    const h = await household();
    const desk2 = await key("desk2");
    const added = [
      ...h.links,
      await nextLink(await listOf(h.links), h.desk, { op: "add", device: desk2.pk, dxpk: desk2.xpk!, label: "laptop", os: "macOS", as: "desktop", approve: true, until: certUntil(Date.now()) }),
    ];
    const a = await codeFor();
    const b = await codeFor();
    await publish(h.desk, h.person.pk, added, nextEntries([], [{ label: "a", code: a }], 1), Date.now());
    await publish(desk2, h.person.pk, added, nextEntries([], [{ label: "b", code: b }], 2), Date.now());
    const both = await read(h.phone, h.person.pk, added);
    expect([...followBooks(both).values()].map((e) => ("code" in e ? e.code : null)).sort()).toEqual([a, b].sort());

    const cut = [...added, await nextLink(await listOf(added), h.desk, { op: "revoke", device: desk2.pk })];
    await publish(h.desk, h.person.pk, cut, nextEntries([], [{ label: "a", code: a }], 1), Date.now() + 5);
    const after = await read(h.phone, h.person.pk, cut);
    expect(after.map((x) => x.device)).toEqual([h.desk.pk]);
  });

  test("a box the relay swaps for one it sealed itself doesn't open", async () => {
    const h = await household();
    const forger = await key("forger");
    const list = await listOf(h.links);
    const boxes = await sealBook(forger, h.person.pk, bookReaders(list), nextEntries([], [{ label: "trap", code: await codeFor() }], 1), 7);
    expect(await openBook(h.phone, { device: h.desk.pk, at: 7, box: boxes[h.phone.pk]! }, list)).toBeNull();
    expect(await openBook(h.phone, { device: forger.pk, at: 7, box: boxes[h.phone.pk]! }, list)).toBeNull();
  });

  test("a relay without the book answers 404, which the client reads as no book", async () => {
    const old = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("not found", { status: 404 }) });
    try {
      const h = await household();
      expect(await bookClient(old.url.origin, h.phone, h.person.pk).slots()).toBeNull();
      expect(await bookClient(old.url.origin, h.desk, h.person.pk).put(h.links, 1, {})).toBe(false);
    } finally {
      old.stop(true);
    }
  });
});

describe("following the book (T30)", () => {
  let a = "";
  let roomA = "";
  beforeAll(async () => {
    a = await codeFor();
    roomA = (nextEntries([], [{ label: "a", code: a }], 1)[0] as { room: string }).room;
  });

  test("a channel gone from the desktop's list becomes a leave, kept for a while, and the joined time stays put", () => {
    const first = nextEntries([], [{ label: "a", code: a }], 10);
    expect(nextEntries(first, [{ label: "a", code: a }], 20)).toEqual(first);
    const left = nextEntries(first, [], 30);
    expect(left).toEqual([{ room: roomA, at: 30, left: true }]);
    expect(nextEntries(left, [], 40)).toEqual(left);
    expect(nextEntries(left, [], 30 + 31 * 86_400_000)).toEqual([]);
  });

  test("the newest word on a channel wins across desktops", () => {
    const book = (device: string, channels: BookEntry[]): ChannelBook => ({ kind: "kiwi-channel-book", v: 1, person: "p", device, at: 0, channels });
    const joined: BookEntry = { room: roomA, at: 10, code: a, label: "a" };
    const leftLater: BookEntry = { room: roomA, at: 20, left: true };
    expect(followBooks([book("d1", [joined]), book("d2", [leftLater])]).get(roomA)).toEqual(leftLater);
    expect(followBooks([book("d1", [{ ...joined, at: 30 }]), book("d2", [leftLater])]).get(roomA)).toEqual({ ...joined, at: 30 });
    expect(followBooks([book("d1", [{ ...joined, at: 20 }]), book("d2", [leftLater])]).get(roomA)).toEqual({ ...joined, at: 20 });
  });
});
