import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountClient } from "@kiwi/core/account.ts";
import { certUntil, nextLink, readDeviceList, rerootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { openVault, readRecovery, readRecoveryPhrase, recoveryKey, recoveryLink, sealPerson, sealVault, type RecoveryLink, type Vault, type VaultContents } from "@kiwi/core/recovery.ts";
import { createDeviceHost, type DeviceHost } from "../desktop/src/devices.ts";
import { createRecoveryHost, type RecoveryHost, type RecoveryKept } from "../desktop/src/recovery.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-recovery-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let users = 0;

function ownRelay(): void {
  beforeAll(() => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
    relay = server.url.origin;
  });
  afterAll(() => server.stop(true));
}

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const key = async (name: string) => withExchangeKey(await generateIdentity(name));

const DAY = 86_400_000;

interface App {
  host: DeviceHost;
  recovery: RecoveryHost;
  person: Identity;
  token: string;
  owned: VaultContents["channels"];
  kept: { value: RecoveryKept | null };
  swap: { vault: string | null; skip: number };
  holds: { value: boolean };
  listing: { fails: boolean };
  clock: { ahead: number };
}

async function app(opts: { person?: boolean; of?: { app: App; device: Identity; links: DeviceLink[] } } = {}): Promise<App> {
  const token = opts.of?.app.token ?? `dev:recover${++users}`;
  const person = opts.of?.app.person ?? (await key("Jow"));
  const holds: App["holds"] = { value: opts.person !== false && !opts.of };
  const listing: App["listing"] = { fails: false };
  const clock: App["clock"] = { ahead: 0 };
  let device: Identity | null = opts.of?.device ?? null;
  let links: DeviceLink[] = opts.of?.links ?? [];
  const swap: App["swap"] = { vault: null, skip: 0 };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (swap.vault && url.pathname === "/v1/account/vault" && (init?.method ?? "GET") === "GET") {
      if (swap.skip > 0) swap.skip--;
      else return new Response(swap.vault, { headers: { "content-type": "application/json" } });
    }
    return fetch(input, init);
  }) as typeof fetch;
  const host = createDeviceHost({
    relayUrl: () => relay,
    token: async () => token,
    person: () => (opts.of ? null : person),
    who: () => ({ name: person.name, pk: person.pk, xpk: person.xpk! }),
    device: () => device,
    saveDevice: (d) => void (device = d),
    links: () => links,
    saveLinks: (l) => void (links = l),
    channels: () => [],
    label: () => "desk",
    os: () => "macOS",
    wipe: () => {},
    fetchImpl,
  });
  const owned: App["owned"] = [];
  const kept: App["kept"] = { value: null };
  const recovery = createRecoveryHost({
    session: () => host.session(),
    person: () => (holds.value ? person : null),
    links: () => links,
    owned: () => owned,
    kept: () => kept.value,
    keep: (k) => void (kept.value = k),
    letGo: async () => {
      if (listing.fails) throw new Error("the relay is away");
      holds.value = false;
    },
    forget: () => {
      holds.value = false;
      kept.value = null;
    },
    now: () => Date.now() + clock.ahead,
  });
  return { host, recovery, person, token, owned, kept, swap, holds, listing, clock };
}

async function laptop(a: App): Promise<App> {
  const s = await a.host.session();
  if (!s) throw new Error("not signed in");
  const device = await key("laptop");
  const links = (await s.client.links()) as DeviceLink[];
  const list = await readDeviceList(links);
  if (!list.ok) throw new Error(list.why);
  const add = { op: "add" as const, device: device.pk, dxpk: device.xpk!, label: "laptop", os: "macOS", as: "desktop" as const, approve: true, until: certUntil(Date.now()) };
  const next = [...links, await nextLink(list.list, s.device, add)];
  await s.client.publish(next);
  await a.host.poll();
  return app({ of: { app: a, device, links: next } });
}

async function relayVault(a: App): Promise<{ recovery: unknown[]; vault: Vault | null; text: string }> {
  const s = await a.host.session();
  if (!s) throw new Error("not signed in");
  const got = await s.client.vault();
  return { recovery: got.recovery, vault: got.vault as Vault | null, text: JSON.stringify(got) };
}

async function opened(words: string[], vault: Vault): Promise<VaultContents | null> {
  const read = await readRecoveryPhrase(words.join(" "));
  if (!read.ok) throw new Error(read.why);
  return openVault(vault, await recoveryKey(read.entropy));
}

const typed = (words: string[], at: number[]) => at.map((i) => ({ at: i, word: words[i]! }));

async function propose(a: App): Promise<void> {
  const s = await a.host.session();
  if (!s) throw new Error("not signed in");
  const got = await relayVault(a);
  const list = await readDeviceList((await s.client.links()) as DeviceLink[]);
  if (!list.ok) throw new Error(list.why);
  const read = await readRecovery(got.recovery, list.list);
  if (!read.ok) throw new Error(read.why);
  const theirs = await recoveryKey(crypto.getRandomValues(new Uint8Array(32)));
  const link = await recoveryLink(s.device, a.person.pk, read.recovery, { pk: theirs.pk, xpk: theirs.xpk! });
  await s.client.keepVault({ recovery: [...(got.recovery as RecoveryLink[]), link] });
}

async function channel(label: string): Promise<VaultContents["channels"][number]> {
  return { label, code: `mc2-${label}`, owner: await key(label) };
}

describe("setting up the recovery key on the desktop", () => {
  ownRelay();

  test("before setup: nothing on the relay, and only the app holding the person key can start", async () => {
    const a = await app();
    expect(await a.recovery.status()).toEqual({ at: null, here: true });
    const b = await app({ person: false });
    expect(await b.recovery.status()).toEqual({ at: null, here: false });
    await expect(b.recovery.words()).rejects.toThrow("first signed in");
  });

  test("24 words, kept the same until saved; a wrong word is named and nothing is published", async () => {
    const a = await app();
    const words = await a.recovery.words();
    expect(words).toHaveLength(24);
    expect(await a.recovery.words()).toEqual(words);
    const wrong = await a.recovery.save([...typed(words, [2, 10]), { at: 19, word: words[19] === "zoo" ? "abandon" : "zoo" }]);
    expect(wrong).toEqual({ ok: false, wrong: [19] });
    await expect(a.recovery.save(typed(words, [2, 10]))).rejects.toThrow("type 3");
    await expect(a.recovery.save(typed(words, [2, 2, 2]))).rejects.toThrow("type 3");
    expect((await relayVault(a)).recovery).toEqual([]);
  });

  test("saving publishes the chain and vault version 1, which the words open to the person key and owned channels", async () => {
    const a = await app();
    a.owned.push(await channel("general"));
    const words = await a.recovery.words();
    const saved = await a.recovery.save([{ at: 0, word: words[0]!.slice(0, 4).toUpperCase() }, ...typed(words, [11, 23])]);
    expect(saved.ok).toBe(true);
    const got = await relayVault(a);
    expect(got.recovery).toHaveLength(1);
    expect(got.vault?.version).toBe(1);
    const inside = await opened(words, got.vault!);
    expect(inside?.person.sk).toBe(a.person.sk);
    expect(inside?.channels.map((c) => c.label)).toEqual(["general"]);
    expect(a.kept.value).toMatchObject({ at: saved.ok ? saved.at : 0, version: 1, owners: [a.owned[0]!.owner.pk] });
    expect((await a.recovery.status())?.at).toBe(saved.ok ? saved.at : 0);
    await expect(a.recovery.save(typed(words, [0, 1, 2]))).rejects.toThrow("start the recovery key again");
  });

  test("a new owned channel seals the next version once, and only then", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [1, 2, 3]));
    await a.recovery.keepCurrent();
    expect((await relayVault(a)).vault?.version).toBe(1);
    a.owned.push(await channel("design"));
    await a.recovery.keepCurrent();
    await a.recovery.keepCurrent();
    const got = await relayVault(a);
    expect(got.vault?.version).toBe(2);
    const inside = await opened(words, got.vault!);
    expect(inside?.channels.map((c) => c.label)).toEqual(["design"]);
    expect(inside?.person.sk).toBe(a.person.sk);
  });

  test("an app that lost its local note reseals once from what the relay keeps, and keeps the person key it can't prove", async () => {
    const a = await app();
    a.listing.fails = true;
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [4, 5, 6]));
    a.kept.value = null;
    a.listing.fails = false;
    await a.recovery.keepCurrent();
    expect((await relayVault(a)).vault?.version).toBe(2);
    expect(a.kept.value).toMatchObject({ version: 2 });
    expect(a.holds.value).toBe(true);
  });

  test("a relay handing back an older vault is refused, and nothing is sealed over it", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [7, 8, 9]));
    const first = (await relayVault(a)).text;
    a.owned.push(await channel("ops"));
    await a.recovery.keepCurrent();
    a.swap.vault = first;
    a.owned.push(await channel("later"));
    await expect(a.recovery.keepCurrent()).rejects.toThrow("older than version 2");
    a.swap.vault = null;
    expect((await relayVault(a)).vault?.version).toBe(2);
  });

  test("a relay that dropped the vault is refused rather than restarted at version 1", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [7, 8, 9]));
    a.swap.vault = JSON.stringify({ recovery: (await relayVault(a)).recovery, vault: null });
    a.owned.push(await channel("ops"));
    await expect(a.recovery.keepCurrent()).rejects.toThrow("lost your recovery vault");
  });

  test("new words replace the old at once: the next vault opens only with them", async () => {
    const a = await app();
    a.listing.fails = true;
    const old = await a.recovery.words();
    await a.recovery.save(typed(old, [0, 1, 2]));
    a.recovery.drop();
    const fresh = await a.recovery.words();
    expect(fresh).not.toEqual(old);
    await a.recovery.save(typed(fresh, [3, 4, 5]));
    const got = await relayVault(a);
    expect(got.recovery).toHaveLength(2);
    expect(got.vault?.version).toBe(2);
    expect(await opened(old, got.vault!)).toBeNull();
    expect((await opened(fresh, got.vault!))?.person.sk).toBe(a.person.sk);
  });

  test("another person's app can't read this account's recovery state", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [0, 1, 2]));
    const stranger = accountClient(relay, async () => "dev:stranger", await key("stranger"));
    expect((await stranger.vault()).recovery).toEqual([]);
  });
});

describe("letting go of the person key once the words are checked (T899)", () => {
  ownRelay();

  test("saving the words drops the person key here; the vault still opens to all of it, and this app can't make new words", async () => {
    const a = await app();
    const words = await a.recovery.words();
    expect((await a.recovery.save(typed(words, [0, 9, 18]))).ok).toBe(true);
    expect(a.holds.value).toBe(false);
    expect(a.kept.value?.person?.rxpk).toBeTruthy();
    expect(a.kept.value?.person?.box).not.toContain(a.person.sk);
    expect((await opened(words, (await relayVault(a)).vault!))?.person).toMatchObject({ pk: a.person.pk, sk: a.person.sk, xsk: a.person.xsk });
    expect((await a.recovery.status())?.here).toBe(false);
    await expect(a.recovery.words()).rejects.toThrow("first signed in");
  });

  test("after that, a new owned channel is sealed by this app's device key, with the person key carried over", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [1, 2, 3]));
    a.owned.push(await channel("after"));
    await a.recovery.keepCurrent();
    const got = await relayVault(a);
    const device = (await a.host.session())!.device;
    expect(got.vault).toMatchObject({ version: 2, pk: device.pk });
    const inside = await opened(words, got.vault!);
    expect(inside?.person.sk).toBe(a.person.sk);
    expect(inside?.channels.map((c) => c.label)).toEqual(["after"]);
  });

  test("an app that can't list its computers yet keeps the key, and lets it go on the next poll without a new version", async () => {
    const a = await app();
    a.listing.fails = true;
    const words = await a.recovery.words();
    expect((await a.recovery.save(typed(words, [4, 5, 6]))).ok).toBe(true);
    expect(a.holds.value).toBe(true);
    await expect(a.recovery.keepCurrent()).rejects.toThrow("relay is away");
    expect(a.holds.value).toBe(true);
    a.listing.fails = false;
    await a.recovery.keepCurrent();
    expect(a.holds.value).toBe(false);
    expect((await relayVault(a)).vault?.version).toBe(1);
  });

  test("a vault that doesn't come back as sealed keeps the person key here", async () => {
    const gone = await app();
    gone.swap.vault = JSON.stringify({ recovery: [], vault: null });
    gone.swap.skip = 1;
    const once = await gone.recovery.words();
    await expect(gone.recovery.save(typed(once, [0, 1, 2]))).rejects.toThrow("keeps your person key");
    expect(gone.holds.value).toBe(true);
    gone.swap.vault = null;
    await gone.recovery.keepCurrent();
    expect(gone.holds.value).toBe(true);

    const old = await app();
    old.listing.fails = true;
    await old.recovery.save(typed(await old.recovery.words(), [3, 4, 5]));
    const first = (await relayVault(old)).text;
    old.listing.fails = false;
    old.swap.vault = first;
    old.swap.skip = 1;
    const again = await old.recovery.words();
    await expect(old.recovery.save(typed(again, [6, 7, 8]))).rejects.toThrow("keeps your person key");
    old.swap.vault = null;
    await old.recovery.keepCurrent();
    expect(old.holds.value).toBe(true);
  });

  test("words set up before this update: the next poll reseals with the person key boxed, and keeps it, since no words were checked against the relay", async () => {
    const a = await app();
    a.listing.fails = true;
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [7, 8, 9]));
    const was = a.kept.value!;
    a.kept.value = { at: was.at, version: was.version, owners: was.owners };
    a.listing.fails = false;
    await a.recovery.keepCurrent();
    expect(a.holds.value).toBe(true);
    const got = await relayVault(a);
    expect(got.vault?.version).toBe(2);
    expect((await opened(words, got.vault!))?.person.sk).toBe(a.person.sk);
  });

  test("a recovery key a device proposed: the key stays while it waits, and once it takes over the person key isn't sealed to it", async () => {
    const a = await app();
    a.listing.fails = true;
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [10, 11, 12]));
    a.listing.fails = false;
    await propose(a);
    a.owned.push(await channel("waiting"));
    await a.recovery.keepCurrent();
    expect(a.holds.value).toBe(true);
    expect((await opened(words, (await relayVault(a)).vault!))?.channels.map((c) => c.label)).toEqual(["waiting"]);
    a.clock.ahead = 8 * DAY;
    a.owned.push(await channel("taken"));
    await expect(a.recovery.keepCurrent()).rejects.toThrow("replaced by a device's proposal");
    expect(a.holds.value).toBe(true);
    expect((await relayVault(a)).vault?.version).toBe(2);
  });

  test("after letting go, a recovery key that changed is refused rather than sealed without the person key", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [13, 14, 15]));
    await propose(a);
    a.clock.ahead = 8 * DAY;
    a.owned.push(await channel("lost"));
    await expect(a.recovery.keepCurrent()).rejects.toThrow("type the old words");
    expect((await relayVault(a)).vault?.version).toBe(1);
  });

  test("an app that never held the person key has nothing to seal or let go", async () => {
    const b = await app({ person: false });
    b.owned.push(await channel("mine"));
    await b.recovery.keepCurrent();
    expect(b.kept.value).toBeNull();
    expect((await relayVault(b)).vault).toBeNull();
  });
});

describe("after a re-root elsewhere (T827)", () => {
  ownRelay();

  async function reroot(a: App, words: string[]): Promise<Identity> {
    const s = await a.host.session();
    if (!s) throw new Error("not signed in");
    const read = await readRecoveryPhrase(words.join(" "));
    if (!read.ok) throw new Error(read.why);
    const links = (await s.client.links()) as DeviceLink[];
    const list = await readDeviceList(links);
    if (!list.ok) throw new Error(list.why);
    const next = await key("next");
    const got = await relayVault(a);
    const chain = got.recovery as RecoveryLink[];
    const paper = await recoveryKey(read.entropy);
    const rerooted = [...links, await rerootLink(list.list, paper, chain, next, [s.device.pk])];
    await s.client.publish(rerooted);
    const after = await readDeviceList(rerooted);
    if (!after.ok) throw new Error(after.why);
    const recovery = await readRecovery(chain, after.list);
    if (!recovery.ok) throw new Error(recovery.why);
    const inside = await openVault(got.vault!, paper);
    await s.client.keepVault({ vault: await sealVault(next, recovery.recovery, got.vault!.version + 1, { person: await sealPerson(recovery.recovery, next), channels: inside?.channels ?? [] }) });
    await a.host.poll();
    return next;
  }

  async function openedAs(words: string[], vault: Vault, root: string): Promise<VaultContents | null> {
    const read = await readRecoveryPhrase(words.join(" "));
    if (!read.ok) throw new Error(read.why);
    return openVault(vault, await recoveryKey(read.entropy), root);
  }

  test("an app still holding the old person key lets it go, and seals its channels with the new person key's box", async () => {
    const a = await app();
    a.listing.fails = true;
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [3, 13, 23]));
    expect(a.holds.value).toBe(true);
    const next = await reroot(a, words);
    a.owned.push(await channel("later"));
    await a.recovery.keepCurrent();
    expect(a.holds.value).toBe(false);
    expect(a.kept.value?.person?.pk).toBe(next.pk);
    const got = await relayVault(a);
    expect(got.vault?.version).toBe(3);
    expect(got.text).not.toContain(a.person.sk);
    const inside = await openedAs(words, got.vault!, next.pk);
    expect(inside?.person.pk).toBe(next.pk);
    expect(inside?.channels.map((c) => c.label)).toEqual(["later"]);
  });

  test("an app that carries the old person key boxed never seals it again: it takes the new box from the vault", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [5, 6, 7]));
    expect(a.holds.value).toBe(false);
    const old = a.kept.value?.person;
    const next = await reroot(a, words);
    a.owned.push(await channel("later"));
    await a.recovery.keepCurrent();
    const got = await relayVault(a);
    expect(got.vault?.version).toBe(3);
    expect(got.vault?.held).not.toEqual(old);
    expect(got.vault?.held.pk).toBe(next.pk);
    expect(a.kept.value?.person).toEqual(got.vault!.held);
    expect((await openedAs(words, got.vault!, next.pk))?.channels.map((c) => c.label)).toEqual(["later"]);
    expect(await openedAs(words, got.vault!, a.person.pk)).toBeNull();
  });

  test("with no box for the new person key in the vault yet, nothing is sealed", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [1, 2, 3]));
    a.owned.push(await channel("earlier"));
    await a.recovery.keepCurrent();
    const s = await a.host.session();
    if (!s) throw new Error("not signed in");
    const links = (await s.client.links()) as DeviceLink[];
    const list = await readDeviceList(links);
    if (!list.ok) throw new Error(list.why);
    const read = await readRecoveryPhrase(words.join(" "));
    if (!read.ok) throw new Error(read.why);
    const got = await relayVault(a);
    await s.client.publish([...links, await rerootLink(list.list, await recoveryKey(read.entropy), got.recovery as RecoveryLink[], await key("next"), [s.device.pk])]);
    await a.host.poll();
    a.owned.push(await channel("later"));
    await expect(a.recovery.keepCurrent()).rejects.toThrow("no app has sealed your person key");
    expect((await relayVault(a)).vault?.version).toBe(2);
  });
});

describe("every approving desktop seals its own channels (T969)", () => {
  ownRelay();

  const labels = (c: VaultContents | null) => c?.channels.map((x) => x.label).sort();

  test("a second desktop takes the person box from the vault and seals its channels beside the first's", async () => {
    const a = await app();
    a.owned.push(await channel("first"));
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [0, 1, 2]));
    expect(a.holds.value).toBe(false);
    const b = await laptop(a);
    b.owned.push(await channel("second"));
    await b.recovery.keepCurrent();
    const v2 = await relayVault(b);
    expect(v2.vault?.version).toBe(2);
    expect(b.kept.value?.person).toEqual(a.kept.value?.person);
    expect(v2.vault?.boxes.map((x) => x.device).sort()).toEqual([(await a.host.session())!.device.pk, (await b.host.session())!.device.pk].sort());
    const inside = await opened(words, v2.vault!);
    expect(inside?.person.pk).toBe(a.person.pk);
    expect(labels(inside)).toEqual(["first", "second"]);

    a.owned.push(await channel("third"));
    await a.recovery.keepCurrent();
    expect(labels(await opened(words, (await relayVault(a)).vault!))).toEqual(["first", "second", "third"]);
    await b.recovery.keepCurrent();
    expect((await relayVault(b)).vault?.version).toBe(3);
  });

  test("a desktop whose box is gone from the vault seals it again on its next look", async () => {
    const a = await app();
    a.listing.fails = true;
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [0, 1, 2]));
    const b = await laptop(a);
    b.owned.push(await channel("second"));
    await b.recovery.keepCurrent();
    const fresh = await a.recovery.words();
    await a.recovery.save(typed(fresh, [4, 5, 6]));
    const after = await relayVault(a);
    expect(after.vault?.boxes).toHaveLength(1);
    expect(labels(await opened(fresh, after.vault!))).toEqual([]);
    await b.recovery.keepCurrent();
    expect((await relayVault(b)).vault?.version).toBe(after.vault!.version);
    b.clock.ahead = 11 * 60_000;
    await b.recovery.keepCurrent();
    const again = await relayVault(b);
    expect(again.vault?.version).toBe(after.vault!.version + 1);
    expect(labels(await opened(fresh, again.vault!))).toEqual(["second"]);
  });

  test("a desktop that isn't in the list can't add its box", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [0, 1, 2]));
    const b = await laptop(a);
    await a.host.forget((await b.host.session())!.device.pk);
    b.owned.push(await channel("second"));
    await expect(b.recovery.keepCurrent()).rejects.toThrow("removed from this person's devices");
    expect((await relayVault(a)).vault?.version).toBe(1);
  });
});
