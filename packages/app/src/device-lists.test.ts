import { afterEach, expect, test } from "bun:test";

import { certUntil, nextLink, readDeviceList, rerootLink, rootLink, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { recoveryKey, recoveryLink } from "@kiwi/core/recovery.ts";
import { postedLists, postList, tendLists, type ListsApi } from "./device-lists";

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

afterEach(() => store.clear());

const device = async (name: string) => withExchangeKey(await generateIdentity(name));

async function grow(links: DeviceLink[], signer: Identity, body: Parameters<typeof nextLink>[2]): Promise<DeviceLink[]> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await nextLink(read.list, signer, body)];
}

async function lists() {
  const person = await generateIdentity("jow");
  const desk = await device("desk");
  const phone = await device("phone");
  const root = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  const added = await grow(root, desk, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) });
  const revoked = await grow(added, desk, { op: "revoke", device: phone.pk });
  return { person, phone, added, revoked };
}

const event = (seq: number, from: string, links: DeviceLink[]): Message => ({ seq, from, kind: "event", body: "", ts: seq, ev: { op: "devices", links } }) as unknown as Message;

function channel(messages: Message[]) {
  const asked: number[] = [];
  const cuts: DeviceList[] = [];
  const api: ListsApi = {
    history: async (since) => {
      asked.push(since);
      return { messages: messages.filter((m) => m.seq > since) };
    },
    cutDevices: async (list) => {
      cuts.push(list);
      return [{ name: "jow-2" } as Member];
    },
  };
  return { api, asked, cuts };
}

test("each member's longest posted list is the one kept", async () => {
  const { added, revoked } = await lists();
  expect(postedLists([event(1, "jow", added), event(2, "jow", revoked), event(3, "jow", added)])).toEqual({ jow: revoked });
});

test("an owner's pass reads only what's new, cuts once per list version, and hands the newest lists on", async () => {
  const { person, phone, added, revoked } = await lists();
  const ch = channel([event(4, "jow", added), event(9, "jow", revoked)]);
  const first = await tendLists("mc2-a", [], ch.api);
  expect(first.cut.map((m) => m.name)).toEqual(["jow-2"]);
  expect(first.lists.get(person.pk)?.revoked).toEqual([phone.pk]);
  const again = await tendLists("mc2-a", [], ch.api);
  expect(again.cut).toEqual([]);
  expect(ch.asked).toEqual([0, 9]);
  expect(ch.cuts).toHaveLength(1);
});

test("the owner's own list counts, and a list read in one channel decides in another", async () => {
  const { person, added, revoked } = await lists();
  await tendLists("mc2-a", [], channel([event(2, "jow", revoked)]).api);
  const other = channel([event(3, "jow", added)]);
  const got = await tendLists("mc2-b", [], other.api);
  expect(got.lists.get(person.pk)?.version).toBe(3);
  expect(other.cuts).toHaveLength(1);
  const own = channel([]);
  expect((await tendLists("mc2-c", revoked, own.api)).lists.get(person.pk)?.version).toBe(3);
});

test("a list is posted once per version into each channel", async () => {
  const { added, revoked } = await lists();
  const sent: DeviceLink[][] = [];
  const api = { send: async (_: string, o: { ev: { links: DeviceLink[] } }) => sent.push(o.ev.links) };
  expect(await postList("mc2-a", added, api)).toBe(true);
  expect(await postList("mc2-a", added, api)).toBe(false);
  expect(await postList("mc2-b", added, api)).toBe(true);
  expect(await postList("mc2-a", revoked, api)).toBe(true);
  expect(await postList("mc2-a", [], api)).toBe(false);
  expect(sent.map((l) => l.length)).toEqual([2, 2, 3]);
});

test("a re-root that keeps every device still gets a cut pass, for the computers an old cert vouched for", async () => {
  const person = await generateIdentity("jow");
  const desk = await device("desk");
  const root = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  const paper = await recoveryKey(new Uint8Array(32).fill(8));
  const chain = [await recoveryLink(person, person.pk, null, { pk: paper.pk, xpk: paper.xpk! })];
  const read = await readDeviceList(root);
  if (!read.ok) throw new Error(read.why);
  const rerooted = [...root, await rerootLink(read.list, paper, chain, await device("next"), [desk.pk])];
  const ch = channel([event(2, "jow", root), event(5, "jow", rerooted)]);
  const got = await tendLists("mc2-r", [], ch.api);
  expect(got.lists.get(person.pk)?.revoked).toEqual([]);
  expect(ch.cuts.map((l) => l.reroots.length)).toEqual([1]);
});
