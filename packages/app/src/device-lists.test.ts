import { afterEach, expect, test } from "bun:test";

import { certUntil, nextLink, readDeviceList, rootLink, type DeviceClaim, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { goneOwn, keepAgents, postedKeeps, postedLists, postList, tendLists, type ListsApi } from "./device-lists";
import { revokedComputer } from "./forgotten-computers";

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

const event = (seq: number, from: string, links: DeviceLink[], extra: object = {}, sigOk = true): Message =>
  ({ seq, from, pk: `pk-${from}`, sigOk, kind: "event", body: "", ts: seq, ev: { op: "devices", links, ...extra } }) as unknown as Message;

function channel(messages: Message[]) {
  const asked: number[] = [];
  const cuts: DeviceList[] = [];
  const keeps: Record<string, DeviceClaim>[] = [];
  const api: ListsApi = {
    history: async (since) => {
      asked.push(since);
      return { messages: messages.filter((m) => m.seq > since) };
    },
    cutDevices: async (list, kept) => {
      cuts.push(list);
      keeps.push({ ...kept });
      return [{ name: "jow-2" } as Member];
    },
  };
  return { api, asked, cuts, keeps };
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

test("a person's own app logs the cut of its revoked devices once per channel and list version, and never for a list that revokes nothing (T1408)", async () => {
  const { phone, added, revoked } = await lists();
  const asked: DeviceList[] = [];
  const api = {
    goneDevices: async (list: DeviceList) => {
      asked.push(list);
      return [{ name: "jow-2" } as Member];
    },
  };
  expect(await goneOwn("mc2-a", added, api)).toEqual([]);
  expect(await goneOwn("mc2-a", [], api)).toEqual([]);
  expect((await goneOwn("mc2-a", revoked, api)).map((m) => m.name)).toEqual(["jow-2"]);
  expect(await goneOwn("mc2-a", revoked, api)).toEqual([]);
  expect((await goneOwn("mc2-b", revoked, api)).map((m) => m.name)).toEqual(["jow-2"]);
  expect(asked.map((l) => l.revoked)).toEqual([[phone.pk], [phone.pk]]);
});

test("a pass keeps the lists it read, so the app can tell a request from a forgotten computer (T2622)", async () => {
  const { person, phone, revoked } = await lists();
  const { api } = channel([event(1, "jow", revoked)]);
  await tendLists("mc2-forgot", [], api);
  expect(revokedComputer(person.pk, phone.pk)).toBe(true);
  expect(revokedComputer(person.pk, "someone-else")).toBe(false);
  expect(revokedComputer("another-person", phone.pk)).toBe(false);
});

test("keeps for a forgotten computer's agents reach the cut: signed ones read from the log, and this app's own before it posts them (T1467)", async () => {
  const { revoked } = await lists();
  const keep = { device: "mac", agents: [{ pk: "pk-tortoise", vouch: "sig" }] };
  const posted = [event(1, "jow", revoked, { keep }), event(2, "forger", revoked, { keep: { device: "evil", agents: [{ pk: "pk-other", vouch: "x" }] } }, false)];
  expect(postedKeeps(posted)).toEqual({ "pk-tortoise": { links: revoked, device: "mac", vouch: "sig" } });

  const read = channel(posted);
  await tendLists("mc2-k", [], read.api);
  expect(read.keeps).toEqual([{ "pk-tortoise": { links: revoked, device: "mac", vouch: "sig" } }]);

  keepAgents("mc2-own", revoked, { device: "mac", agents: [{ pk: "pk-a", vouch: "a" }] });
  keepAgents("mc2-own", revoked, {
    device: "mac",
    agents: [
      { pk: "pk-b", vouch: "b" },
      { pk: "pk-a", vouch: "a2" },
    ],
  });
  const own = channel([]);
  await tendLists("mc2-own", revoked, own.api);
  expect(own.keeps).toEqual([{ "pk-a": { links: revoked, device: "mac", vouch: "a2" }, "pk-b": { links: revoked, device: "mac", vouch: "b" } }]);
  const other = channel([]);
  await tendLists("mc2-else", revoked, other.api);
  expect(other.keeps).toEqual([{}]);
});

test("this app's keep rides on its next post into that channel only, and its own cut log honors it (T1467)", async () => {
  const { added, revoked } = await lists();
  keepAgents("mc2-a", revoked, { device: "mac", agents: [{ pk: "pk-a", vouch: "a" }] });
  const sent: object[] = [];
  const api = { send: async (_: string, o: { ev: object }) => sent.push(o.ev) };
  await postList("mc2-a", revoked, api);
  await postList("mc2-b", added, api);
  expect(sent).toEqual([
    { op: "devices", links: revoked, keep: { device: "mac", agents: [{ pk: "pk-a", vouch: "a" }] } },
    { op: "devices", links: added },
  ]);
  const asked: Record<string, DeviceClaim>[] = [];
  const gone = { goneDevices: async (_: DeviceList, keeps: Record<string, DeviceClaim>) => (asked.push({ ...keeps }), []) };
  await goneOwn("mc2-a", revoked, gone);
  await goneOwn("mc2-b", revoked, gone);
  expect(asked).toEqual([{ "pk-a": { links: revoked, device: "mac", vouch: "a" } }, {}]);
});
