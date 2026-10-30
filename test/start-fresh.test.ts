import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountClient, type FreshNotice } from "@kiwi/core/account.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { certUntil, nextLink, readDeviceList, rerootLink, rootLink, type DeviceLink, type DeviceLinkBody } from "@kiwi/core/devices.ts";
import { accountScope } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { recoveryKey, recoveryLink, type RecoveryLink } from "@kiwi/core/recovery.ts";
import { createDeviceHost } from "../desktop/src/devices.ts";
import { FRESH_EVERY_MS, FRESH_WAIT_MS } from "../src/relay/account.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { machineScope } from "../src/relay/machine.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-start-fresh-"));
let t = Date.now();
let server: ReturnType<typeof startRelay>;
let relay: string;
let users = 0;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), now: () => t });
  relay = server.url.origin;
});

beforeEach(() => {
  t = Date.now();
  setSystemTime(t);
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

interface Account {
  name: string;
  user: string;
  token: string;
}

const account = (): Account => {
  const name = `fresh${++users}`;
  return { name, user: `dev_${name}`, token: `dev:${name}` };
};

const device = async (name: string) => withExchangeKey(await generateIdentity(name));

async function call(a: Account, id: Identity | null, method: string, path: string, body?: unknown): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "x-human-token": a.token };
  if (id) headers.authorization = `Bearer ${await signRequest(id, accountScope(a.user), method, path, text)}`;
  if (text) headers["content-type"] = "application/json";
  return fetch(relay + path, { method, headers, ...(text ? { body: text } : {}) });
}

const advance = (ms: number) => {
  t += ms;
  setSystemTime(t);
};

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

async function grow(links: DeviceLink[], signer: Identity, body: DeviceLinkBody): Promise<DeviceLink[]> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await nextLink(read.list, signer, body, t)];
}

const adds = (d: Identity, as: "desktop" | "phone" | "computer", approve = false): DeviceLinkBody => ({
  op: "add",
  device: d.pk,
  dxpk: d.xpk!,
  label: as,
  os: "macOS",
  as,
  approve,
  until: certUntil(t),
});

async function setUp(a: Account) {
  const person = await device("person");
  const desk = await device("desk");
  const phone = await device("phone");
  const box = await device("box");
  let links = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" }, t)];
  links = await grow(links, desk, adds(phone, "phone"));
  links = await grow(links, desk, adds(box, "computer"));
  expect((await call(a, desk, "PUT", "/v1/account", { links })).status).toBe(204);
  return { person, desk, phone, box, links };
}

async function newcomer(name = "newcomer") {
  const person = await device(`${name}-person`);
  const desk = await device(`${name}-desk`);
  const link = await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: name, os: "Linux", as: "desktop" }, t);
  return { person, desk, link };
}

const pendingOf = async (a: Account, id: Identity | null = null): Promise<FreshNotice | null> =>
  ((await (await call(a, id, "GET", "/v1/account/fresh")).json()) as { fresh: FreshNotice | null }).fresh;

const linksOf = async (a: Account): Promise<unknown[]> => ((await (await call(a, null, "GET", "/v1/account")).json()) as { links: unknown[] }).links;

async function start(a: Account, n: { desk: Identity; link: DeviceLink }): Promise<FreshNotice> {
  const res = await call(a, n.desk, "POST", "/v1/account/fresh", { links: [n.link] });
  expect(res.status).toBe(202);
  return (await res.json()) as FreshNotice;
}

describe("starting fresh after a 7-day wait (T1010)", () => {
  test("not before day 7: the account works as it did; after it, the new key is the root and the old list, vault and devices are gone", async () => {
    const a = account();
    const { person, desk, phone, box, links } = await setUp(a);
    const key = await recoveryKey(new Uint8Array(32).fill(21));
    const chain = [await recoveryLink(person, person.pk, null, { pk: key.pk, xpk: key.xpk! }, t)];
    expect((await call(a, desk, "PUT", "/v1/account/vault", { recovery: chain })).status).toBe(204);
    const machinePath = `/v1/machine/${box.pk}`;
    const register = JSON.stringify({ links });
    const registered = await fetch(relay + machinePath, {
      method: "PUT",
      headers: { authorization: `Bearer ${await signRequest(box, machineScope(box.pk), "PUT", machinePath, register)}` },
      body: register,
    });
    expect(registered.status).toBe(204);

    const n = await newcomer();
    const notice = await start(a, n);
    expect(notice.ends).toBe(t + FRESH_WAIT_MS);
    expect(notice).toMatchObject({ label: "newcomer", os: "Linux" });

    advance(FRESH_WAIT_MS - 1000);
    expect(await pendingOf(a)).toEqual(notice);
    expect(await linksOf(a)).toEqual(links);
    expect((await call(a, desk, "PUT", "/v1/account", { links: await grow(links, desk, adds(await device("tablet"), "phone")) })).status).toBe(204);
    expect((await call(a, n.desk, "PUT", "/v1/account/vault", { recovery: chain })).status).toBe(403);

    advance(1000);
    expect(await pendingOf(a)).toBeNull();
    expect(await linksOf(a)).toEqual([n.link]);
    const read = await readDeviceList(await linksOf(a));
    if (!read.ok) throw new Error(read.why);
    expect(read.list.root).toBe(n.person.pk);
    expect(read.list.devices.map((d) => d.device)).toEqual([n.desk.pk]);
    const vault = (await (await call(a, null, "GET", "/v1/account/vault")).json()) as { recovery: unknown[]; vault: unknown };
    expect(vault).toEqual({ recovery: [], vault: null });

    for (const old of [desk, phone]) expect((await call(a, old, "PUT", "/v1/account/vault", { recovery: chain })).status).toBe(403);
    expect((await call(a, desk, "PUT", "/v1/account", { links })).status).toBe(409);
    const inboxPath = `${machinePath}/inbox`;
    const inbox = await fetch(relay + inboxPath, { headers: { authorization: `Bearer ${await signRequest(box, machineScope(box.pk), "GET", inboxPath)}` } });
    expect(inbox.status).toBe(403);
    expect(await errorOf(inbox)).toContain("removed");

    const tablet = await device("next-tablet");
    expect((await call(a, n.desk, "PUT", "/v1/account", { links: await grow([n.link], n.desk, adds(tablet, "phone")) })).status).toBe(204);
  });

  test("a device on the list cancels it, and the wait is over for good", async () => {
    const a = account();
    const { phone, links } = await setUp(a);
    const n = await newcomer();
    const notice = await start(a, n);
    expect((await call(a, phone, "DELETE", `/v1/account/fresh/${notice.id}`)).status).toBe(204);
    expect(await pendingOf(a)).toBeNull();
    advance(FRESH_WAIT_MS + 1000);
    expect(await linksOf(a)).toEqual(links);
    expect((await call(a, phone, "DELETE", `/v1/account/fresh/${notice.id}`)).status).toBe(404);
  });

  test("a sign-in with no device key neither cancels nor shortens the wait", async () => {
    const a = account();
    const { links } = await setUp(a);
    const n = await newcomer();
    const notice = await start(a, n);
    expect((await call(a, null, "DELETE", `/v1/account/fresh/${notice.id}`)).status).toBe(401);
    const stranger = await call(a, await device("stranger"), "DELETE", `/v1/account/fresh/${notice.id}`);
    expect(stranger.status).toBe(403);
    expect(await errorOf(stranger)).toContain("only a device");
    expect(await pendingOf(a)).toEqual(notice);
    expect((await call(a, n.desk, "PUT", "/v1/account", { links: [n.link] })).status).toBe(409);
    expect(await linksOf(a)).toEqual(links);
  });

  test("a device whose certificate ran out can't cancel, and the desktop that started it can", async () => {
    const a = account();
    const { desk, links } = await setUp(a);
    const lapsing = await device("lapsing");
    const grown = await grow(links, desk, { ...adds(lapsing, "phone"), until: t + 1000 } as DeviceLinkBody);
    expect((await call(a, desk, "PUT", "/v1/account", { links: grown })).status).toBe(204);
    const n = await newcomer();
    const notice = await start(a, n);
    advance(2000);
    expect((await call(a, lapsing, "DELETE", `/v1/account/fresh/${notice.id}`)).status).toBe(403);
    expect((await call(a, n.desk, "DELETE", `/v1/account/fresh/${notice.id}`)).status).toBe(204);
    expect(await pendingOf(a)).toBeNull();
  });

  test("a device coming back after being offline finds the notice, with its end time", async () => {
    const a = account();
    const { phone } = await setUp(a);
    const client = accountClient(relay, async () => a.token, phone);
    expect(await client.fresh()).toBeNull();
    const n = await newcomer();
    const notice = await accountClient(relay, async () => a.token, n.desk).startFresh(n.link);
    advance(3 * 24 * 3_600_000);
    const heard = await client.fresh();
    expect(heard).toEqual(notice);
    expect(heard!.ends - t).toBe(FRESH_WAIT_MS - 3 * 24 * 3_600_000);
    await client.cancelFresh(notice.id);
    expect(await client.fresh()).toBeNull();
  });

  test("only one waits: a second start is refused and keeps the first's end time; the same link answers with it", async () => {
    const a = account();
    await setUp(a);
    const n = await newcomer();
    const notice = await start(a, n);
    advance(1000);
    const repeat = await call(a, n.desk, "POST", "/v1/account/fresh", { links: [n.link] });
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual(notice);
    const other = await newcomer("other");
    const second = await call(a, other.desk, "POST", "/v1/account/fresh", { links: [other.link] });
    expect(second.status).toBe(409);
    expect(await errorOf(second)).toContain("already waiting");
    expect(await pendingOf(a)).toEqual(notice);
  });

  test("starts are one a day, so a cancelled one can't spam old devices", async () => {
    const a = account();
    const { desk } = await setUp(a);
    const first = await newcomer("first");
    const notice = await start(a, first);
    expect((await call(a, desk, "DELETE", `/v1/account/fresh/${notice.id}`)).status).toBe(204);
    const next = await newcomer("next");
    const refused = await call(a, next.desk, "POST", "/v1/account/fresh", { links: [next.link] });
    expect(refused.status).toBe(429);
    expect(await errorOf(refused)).toContain("less than a day");
    advance(FRESH_EVERY_MS);
    const later = await newcomer("later");
    await start(a, later);
  });

  test("a start names a new person and a new desktop, for itself, at the time it's sent", async () => {
    const a = account();
    const { person, desk, phone } = await setUp(a);
    const n = await newcomer();
    expect((await call(a, await device("other"), "POST", "/v1/account/fresh", { links: [n.link] })).status).toBe(403);
    expect((await call(a, n.desk, "POST", "/v1/account/fresh", { links: [] })).status).toBe(400);
    const old = await call(a, phone, "POST", "/v1/account/fresh", { links: [await rootLink(n.person, { pk: phone.pk, xpk: phone.xpk!, label: "x", os: "x", as: "desktop" }, t)] });
    expect(old.status).toBe(409);
    const sameKey = await call(a, n.desk, "POST", "/v1/account/fresh", { links: [await rootLink(person, { pk: n.desk.pk, xpk: n.desk.xpk!, label: "x", os: "x", as: "desktop" }, t)] });
    expect(sameKey.status).toBe(409);
    const asPhone = await call(a, n.desk, "POST", "/v1/account/fresh", { links: [await rootLink(n.person, { pk: n.desk.pk, xpk: n.desk.xpk!, label: "x", os: "x", as: "phone" }, t)] });
    expect(asPhone.status).toBe(400);
    const stale = await call(a, n.desk, "POST", "/v1/account/fresh", { links: [await rootLink(n.person, { pk: n.desk.pk, xpk: n.desk.xpk!, label: "x", os: "x", as: "desktop" }, t - 3_600_000)] });
    expect(stale.status).toBe(400);
    expect(await errorOf(stale)).toContain("the time it's sent");
    expect(await pendingOf(a, desk)).toBeNull();

    const empty = account();
    const first = await newcomer("empty");
    const none = await call(empty, first.desk, "POST", "/v1/account/fresh", { links: [first.link] });
    expect(none.status).toBe(404);
  });

  test("it applies with no recovery key set up, and a successful recovery or re-root during the wait cancels it", async () => {
    const plain = account();
    await setUp(plain);
    const n1 = await newcomer("n1");
    await start(plain, n1);
    advance(FRESH_WAIT_MS);
    expect(await linksOf(plain)).toEqual([n1.link]);

    const a = account();
    const { person, links } = await setUp(a);
    const n2 = await newcomer("n2");
    await start(a, n2);
    const lost = await device("recovered");
    const recovered = await grow(links, person, adds(lost, "desktop", true));
    expect((await call(a, lost, "PUT", "/v1/account", { links: recovered })).status).toBe(204);
    expect(await pendingOf(a)).toBeNull();
    advance(FRESH_WAIT_MS);
    expect(await linksOf(a)).toEqual(recovered);

    const b = account();
    const set = await setUp(b);
    const key = await recoveryKey(new Uint8Array(32).fill(22));
    const chain: RecoveryLink[] = [await recoveryLink(set.person, set.person.pk, null, { pk: key.pk, xpk: key.xpk! }, t)];
    expect((await call(b, set.desk, "PUT", "/v1/account/vault", { recovery: chain })).status).toBe(204);
    const n3 = await newcomer("n3");
    await start(b, n3);
    const read = await readDeviceList(set.links);
    if (!read.ok) throw new Error(read.why);
    const next = await device("next");
    const rerooted = [...set.links, await rerootLink(read.list, key, chain, next, [set.desk.pk], t)];
    expect((await call(b, next, "PUT", "/v1/account", { links: rerooted })).status).toBe(204);
    expect(await pendingOf(b)).toBeNull();
  });

  test("a device's routine renewal doesn't cancel it", async () => {
    const a = account();
    const { desk, phone, links } = await setUp(a);
    const n = await newcomer();
    const notice = await start(a, n);
    advance(1000);
    expect((await call(a, desk, "PUT", "/v1/account", { links: await grow(links, desk, { op: "renew", device: phone.pk, until: certUntil(t) }) })).status).toBe(204);
    expect(await pendingOf(a)).toEqual(notice);
  });

  test("an old desktop polling after day 7 never saves the new person's list as its own", async () => {
    const a = account();
    const { person, desk, links } = await setUp(a);
    const held = { links: links as DeviceLink[] };
    const host = createDeviceHost({
      relayUrl: () => relay,
      token: async () => a.token,
      person: () => null,
      who: () => ({ name: person.name, pk: person.pk, xpk: person.xpk! }),
      device: () => desk,
      saveDevice: () => {},
      links: () => held.links,
      saveLinks: (l) => void (held.links = l),
      channels: () => [],
      label: () => "desk",
      os: () => "macOS",
      wipe: () => {
        throw new Error("a new list under this sign-in doesn't wipe an old desktop");
      },
      now: () => t,
    });
    expect(await host.poll()).toBeNull();

    const n = await newcomer();
    await start(a, n);
    advance(FRESH_WAIT_MS);
    let grown = [n.link];
    for (const name of ["a", "b", "c"]) grown = await grow(grown, n.desk, adds(await device(name), "phone"));
    expect((await call(a, n.desk, "PUT", "/v1/account", { links: grown })).status).toBe(204);
    await expect(host.poll()).rejects.toThrow("another Channels person key");
    expect(held.links).toEqual(links);
  });
});
