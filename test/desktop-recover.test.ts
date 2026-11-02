import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountClient } from "@kiwi/core/account.ts";
import { certUntil, nextLink, readDeviceList, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { newRecoveryPhrase, openVault, readRecovery, readRecoveryPhrase, recoveryKey, recoveryLink, type Vault, type VaultContents } from "@kiwi/core/recovery.ts";
import { createDeviceHost, type DeviceHost } from "../desktop/src/devices.ts";
import { createRecoverer, type Recoverer, type Restored } from "../desktop/src/recover.ts";
import { createRecoveryHost, type RecoveryHost, type RecoveryKept } from "../desktop/src/recovery.ts";
import { startRelay } from "../src/relay/bun.ts";
import { oldPersonBox, oldVault } from "./old-vault.ts";
import { devHumanAuth } from "../src/relay/human.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-recover-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let users = 0;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
  relay = server.url.origin;
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const key = async (name: string) => withExchangeKey(await generateIdentity(name));

interface Desk {
  host: DeviceHost;
  links: () => DeviceLink[];
  device: () => Identity | null;
}

function desk(token: string, person: () => Identity | null, label: string, start: DeviceLink[] = [], held: Identity | null = null): Desk {
  let device = held;
  let links = start;
  const host = createDeviceHost({
    relayUrl: () => relay,
    token: async () => token,
    person,
    who: () => {
      const p = person();
      return p ? { name: p.name, pk: p.pk, xpk: p.xpk! } : null;
    },
    device: () => device,
    saveDevice: (d) => void (device = d),
    links: () => links,
    saveLinks: (l) => void (links = l),
    channels: () => [],
    label: () => label,
    os: () => "macOS",
    wipe: () => {},
  });
  return { host, links: () => links, device: () => device };
}

interface Old {
  token: string;
  person: Identity;
  desk: Desk;
  recovery: RecoveryHost;
  words: string[];
  owned: VaultContents["channels"];
  phone: string;
  computer: string;
}

async function lostAccount(): Promise<Old> {
  const token = `dev:lost${++users}`;
  const person = await key("Jow");
  const d = desk(token, () => person, "studio");
  const owned: VaultContents["channels"] = [{ label: "general", code: "mc2-general", owner: await key("general") }];
  const recovery = createRecoveryHost({
    session: () => d.host.session(),
    person: () => person,
    links: d.links,
    owned: () => owned,
    kept: () => null,
    keep: () => {},
    letGo: async () => {},
    forget: () => {},
  });
  await d.host.poll();
  const s = (await d.host.session())!;
  const phone = await key("phone");
  const computer = await key("box");
  let links = d.links();
  for (const [dev, as] of [
    [phone, "phone"],
    [computer, "computer"],
  ] as const) {
    const read = await readDeviceList(links);
    if (!read.ok) throw new Error(read.why);
    links = [...links, await nextLink(read.list, person, { op: "add", device: dev.pk, dxpk: dev.xpk!, label: dev.name, os: "iOS", as, approve: false, until: certUntil(Date.now()) })];
  }
  await s.client.publish(links);
  const words = await recovery.words();
  const saved = await recovery.save([0, 7, 23].map((at) => ({ at, word: words[at]! })));
  if (!saved.ok) throw new Error("setup failed");
  return { token, person, desk: d, recovery, words, owned, phone: phone.pk, computer: computer.pk };
}

function newDesktop(token: string): { recoverer: Recoverer; restored: { value: Restored | null }; device: () => Identity | null } {
  let device: Identity | null = null;
  const restored: { value: Restored | null } = { value: null };
  const recoverer = createRecoverer({
    relayUrl: () => relay,
    token: async () => token,
    who: () => (restored.value ? { name: restored.value.person.name, pk: restored.value.person.pk, xpk: restored.value.person.xpk } : null),
    device: () => device,
    saveDevice: (d) => void (device = d),
    restored: (r) => void (restored.value = r),
    label: () => "new-mac",
    os: () => "macOS",
  });
  return { recoverer, restored, device: () => device };
}

describe("recovering on a new desktop", () => {
  test("the words bring back the person key, add this desktop, forget the lost ones and reseal the vault", async () => {
    const old = await lostAccount();
    const fresh = newDesktop(old.token);
    const open = await fresh.recoverer.open(old.words.join("  ").toUpperCase());
    if (!open.ok) throw new Error(open.why);
    expect(open.name).toBe("Jow");
    expect(open.channels).toEqual(["general"]);
    const studio = old.desk.device()!.pk;
    expect(open.devices.map((d) => [d.label, d.as, d.lost])).toEqual([
      ["studio", "desktop", true],
      ["phone", "phone", true],
      ["box", "computer", false],
    ]);

    const done = await fresh.recoverer.finish([studio, old.phone]);
    expect(done).toEqual({ name: "Jow", channels: 1, forgot: 2 });
    const r = fresh.restored.value!;
    expect(r.person.pk).toBe(old.person.pk);
    expect(r.person.sk).toBe(old.person.sk);
    expect(r.channels.map((c) => [c.label, c.owner.sk])).toEqual([["general", old.owned[0]!.owner.sk]]);
    expect(r.kept.version).toBe(2);

    const read = await readDeviceList(r.links);
    if (!read.ok) throw new Error(read.why);
    expect(read.list.devices.map((d) => [d.label, d.approve])).toEqual([
      ["box", false],
      ["new-mac", true],
    ]);
    expect(read.list.revoked.sort()).toEqual([studio, old.phone].sort());

    const client = accountClient(relay, async () => old.token, fresh.device()!);
    expect(await client.links()).toEqual(r.links);
    const got = await client.vault();
    expect((got.vault as Vault).version).toBe(2);
    expect((got.vault as Vault).pk).toBe(old.person.pk);
    const phrase = await readRecoveryPhrase(old.words.join(" "));
    if (!phrase.ok) throw new Error(phrase.why);
    expect((await openVault(got.vault as Vault, await recoveryKey(phrase.entropy)))?.person.sk).toBe(old.person.sk);

    const back = desk(old.token, () => r.person, "new-mac", r.links, fresh.device());
    expect(await back.host.poll()).toBeNull();
    expect((await back.host.list())?.find((d) => d.thisOne)?.label).toBe("new-mac");
    expect(await old.desk.host.poll()).toBeNull();
    expect((await old.desk.host.news())?.removed).toEqual({ wiped: false, by: "your person key" });
  });

  test("a vault sealed before T969 opens with the words, and finish reseals it with a box per desktop", async () => {
    const token = `dev:lost${++users}`;
    const person = await key("Jow");
    const d = desk(token, () => person, "studio");
    await d.host.poll();
    const s = (await d.host.session())!;
    const owned: VaultContents["channels"] = [{ label: "general", code: "mc2-general", owner: await key("general") }];
    const words = await newRecoveryPhrase();
    const phrase = await readRecoveryPhrase(words.join(" "));
    if (!phrase.ok) throw new Error(phrase.why);
    const paper = await recoveryKey(phrase.entropy);
    const list = await readDeviceList(d.links());
    if (!list.ok) throw new Error(list.why);
    const chain = [await recoveryLink(person, person.pk, null, { pk: paper.pk, xpk: paper.xpk! })];
    const r = await readRecovery(chain, list.list);
    if (!r.ok) throw new Error(r.why);
    await s.client.keepVault({ recovery: chain, vault: await oldVault(s.device, r.recovery, 1, { person: await oldPersonBox(r.recovery, person), channels: owned }) });

    const fresh = newDesktop(token);
    expect(await fresh.recoverer.open(words.join(" "))).toMatchObject({ ok: true, name: "Jow", channels: ["general"] });
    expect(await fresh.recoverer.finish([])).toMatchObject({ name: "Jow", channels: 1 });
    expect(fresh.restored.value?.person.sk).toBe(person.sk);
    const got = (await accountClient(relay, async () => token, fresh.device()!).vault()).vault as Vault;
    expect(got.version).toBe(2);
    expect(got.held.pk).toBe(person.pk);
    expect((await openVault(got, paper))?.channels.map((c) => c.label)).toEqual(["general"]);
  });

  test("a channel sealed in by another desktop between open and finish stays in the vault", async () => {
    const old = await lostAccount();
    const fresh = newDesktop(old.token);
    expect((await fresh.recoverer.open(old.words.join(" "))).ok).toBe(true);
    old.owned.push({ label: "late", code: "mc2-late", owner: await key("late") });
    await old.recovery.keepCurrent();
    expect(await fresh.recoverer.finish([])).toEqual({ name: "Jow", channels: 2, forgot: 0 });
    const r = fresh.restored.value!;
    expect(r.channels.map((c) => c.label)).toEqual(["general", "late"]);
    expect(r.kept.version).toBe(3);
    const phrase = await readRecoveryPhrase(old.words.join(" "));
    if (!phrase.ok) throw new Error(phrase.why);
    const got = await accountClient(relay, async () => old.token, fresh.device()!).vault();
    expect((await openVault(got.vault as Vault, await recoveryKey(phrase.entropy)))?.channels.map((c) => c.label)).toEqual(["general", "late"]);
  });

  test("keeping every old device forgets none and still adds this desktop", async () => {
    const old = await lostAccount();
    const fresh = newDesktop(old.token);
    expect((await fresh.recoverer.open(old.words.join(" "))).ok).toBe(true);
    expect(await fresh.recoverer.finish([])).toEqual({ name: "Jow", channels: 1, forgot: 0 });
    const read = await readDeviceList(fresh.restored.value!.links);
    if (!read.ok) throw new Error(read.why);
    expect(read.list.devices.map((d) => d.label)).toEqual(["studio", "phone", "box", "new-mac"]);
    expect(await old.desk.host.poll()).toBeNull();
    expect((await old.desk.host.list())?.length).toBe(4);
  });

  test("wrong, mistyped and other people's words are named, and nothing changes", async () => {
    const old = await lostAccount();
    const fresh = newDesktop(old.token);
    const short = await fresh.recoverer.open(old.words.slice(0, 23).join(" "));
    expect(short).toEqual({ ok: false, why: "a recovery key is 24 words, and that's 23" });
    const typo = [...old.words];
    typo[5] = "qqqq";
    expect(await fresh.recoverer.open(typo.join(" "))).toEqual({ ok: false, why: "word 6 isn't one of the recovery words", word: 5 });
    const swapped = [...old.words];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    const sum = await fresh.recoverer.open(swapped.join(" "));
    if (swapped[0] !== swapped[1]) expect(sum.ok).toBe(false);
    expect(await fresh.recoverer.open((await newRecoveryPhrase()).join(" "))).toEqual({ ok: false, why: "those aren't the words of this account's recovery key" });
    await expect(fresh.recoverer.finish([])).rejects.toThrow("type your recovery words again");
    expect(fresh.restored.value).toBeNull();
    expect((await old.desk.host.list())?.length).toBe(3);
  });

  test("an account without a recovery key, or without any devices, says so instead of waiting", async () => {
    const token = `dev:lost${++users}`;
    const person = await key("Jow");
    const fresh = newDesktop(token);
    const words = (await newRecoveryPhrase()).join(" ");
    expect((await fresh.recoverer.open(words)).ok).toBe(false);
    await desk(token, () => person, "studio").host.poll();
    const none = await fresh.recoverer.open(words);
    expect(none.ok ? "" : none.why).toContain("never set up a recovery key");
  });

  test("an app that already holds a person can't recover over it", async () => {
    const old = await lostAccount();
    const fresh = newDesktop(old.token);
    expect((await fresh.recoverer.open(old.words.join(" "))).ok).toBe(true);
    await fresh.recoverer.finish([]);
    await expect(fresh.recoverer.open(old.words.join(" "))).rejects.toThrow("already holds your person");
  });
});

describe("losing the only desktop that held the person key locks nobody out (T1423)", () => {
  interface Desktop {
    host: DeviceHost;
    recovery: RecoveryHost;
    owned: VaultContents["channels"];
    kept: { value: RecoveryKept | null };
    holds: { value: boolean };
    device: () => Identity | null;
  }

  function desktop(token: string, person: Identity, label: string, start: DeviceLink[] = [], held: Identity | null = null): Desktop {
    let device = held;
    let links = start;
    const holds = { value: !held };
    const host = createDeviceHost({
      relayUrl: () => relay,
      token: async () => token,
      person: () => (holds.value ? person : null),
      who: () => ({ name: person.name, pk: person.pk, xpk: person.xpk! }),
      device: () => device,
      saveDevice: (d) => void (device = d),
      links: () => links,
      saveLinks: (l) => void (links = l),
      channels: () => [],
      label: () => label,
      os: () => "macOS",
      wipe: () => {},
    });
    const owned: VaultContents["channels"] = [];
    const kept: Desktop["kept"] = { value: null };
    const recovery = createRecoveryHost({
      session: () => host.session(),
      person: () => (holds.value ? person : null),
      links: () => links,
      owned: () => owned,
      kept: () => kept.value,
      keep: (k) => void (kept.value = k),
      letGo: async () => void (holds.value = false),
      forget: () => {
        holds.value = false;
        kept.value = null;
      },
    });
    return { host, recovery, owned, kept, holds, device: () => device };
  }

  async function grow(d: Desktop, body: Parameters<typeof nextLink>[2]): Promise<DeviceLink[]> {
    const s = (await d.host.session())!;
    const links = (await s.client.links()) as DeviceLink[];
    const read = await readDeviceList(links);
    if (!read.ok) throw new Error(read.why);
    const next = [...links, await nextLink(read.list, s.device, body)];
    await s.client.publish(next);
    await d.host.poll();
    return next;
  }

  const labels = (c: VaultContents | null) => c?.channels.map((x) => x.label).sort();

  test("from setup to recovery: the words go in, a second desktop takes its box, the first is lost, the second keeps sealing, and the words still bring everything back", async () => {
    const token = `dev:lost${++users}`;
    const person = await key("Jow");
    const phrase = async (words: string[]) => {
      const read = await readRecoveryPhrase(words.join(" "));
      if (!read.ok) throw new Error(read.why);
      return recoveryKey(read.entropy);
    };

    const studio = desktop(token, person, "studio");
    studio.owned.push({ label: "first", code: "mc2-first", owner: await key("first") });
    await studio.host.poll();
    const words = await studio.recovery.words();
    expect((await studio.recovery.save([0, 7, 23].map((at) => ({ at, word: words[at]! })))).ok).toBe(true);
    expect(studio.holds.value).toBe(false);

    const laptopKey = await key("laptop");
    const withLaptop = await grow(studio, { op: "add", device: laptopKey.pk, dxpk: laptopKey.xpk!, label: "laptop", os: "macOS", as: "desktop", approve: true, until: certUntil(Date.now()) });
    const laptop = desktop(token, person, "laptop", withLaptop, laptopKey);
    laptop.owned.push({ label: "second", code: "mc2-second", owner: await key("second") });
    await laptop.recovery.keepCurrent();
    expect(laptop.kept.value?.person).toEqual(studio.kept.value?.person);

    const studioPk = studio.device()!.pk;
    await grow(laptop, { op: "revoke", device: studioPk });
    expect(await studio.host.poll()).toBeNull();
    expect((await studio.host.news())?.removed).toMatchObject({ by: "laptop" });

    laptop.owned.push({ label: "later", code: "mc2-later", owner: await key("later") });
    await laptop.recovery.keepCurrent();
    const client = accountClient(relay, async () => token, laptopKey);
    const sealed = (await client.vault()).vault as Vault;
    const inside = await openVault(sealed, await phrase(words));
    expect(inside?.person.sk).toBe(person.sk);
    expect(labels(inside)).toEqual(["first", "later", "second"]);

    const fresh = newDesktop(token);
    const open = await fresh.recoverer.open(words.join(" "));
    if (!open.ok) throw new Error(open.why);
    expect(open.channels.sort()).toEqual(["first", "later", "second"]);
    expect(open.devices.map((d) => [d.label, d.lost])).toEqual([["laptop", true]]);
    const done = await fresh.recoverer.finish([laptopKey.pk]);
    expect(done).toEqual({ name: "Jow", channels: 3, forgot: 1 });
    const r = fresh.restored.value!;
    expect(r.person.sk).toBe(person.sk);
    expect(r.channels.map((c) => c.label).sort()).toEqual(["first", "later", "second"]);
    const after = await readDeviceList(r.links);
    if (!after.ok) throw new Error(after.why);
    expect(after.list.devices.map((d) => [d.label, d.approve])).toEqual([["new-mac", true]]);
  });

  test("when the lost desktop sealed the vault last, the words still open it and the desktop left keeps sealing", async () => {
    const token = `dev:lost${++users}`;
    const person = await key("Jow");
    const studio = desktop(token, person, "studio");
    await studio.host.poll();
    const words = await studio.recovery.words();
    expect((await studio.recovery.save([1, 2, 3].map((at) => ({ at, word: words[at]! })))).ok).toBe(true);
    const laptopKey = await key("laptop");
    const withLaptop = await grow(studio, { op: "add", device: laptopKey.pk, dxpk: laptopKey.xpk!, label: "laptop", os: "macOS", as: "desktop", approve: true, until: certUntil(Date.now()) });
    const laptop = desktop(token, person, "laptop", withLaptop, laptopKey);
    await laptop.recovery.keepCurrent();
    studio.owned.push({ label: "studio-late", code: "mc2-studio-late", owner: await key("studio-late") });
    await studio.recovery.keepCurrent();
    const client = accountClient(relay, async () => token, laptopKey);
    expect(((await client.vault()).vault as Vault).pk).toBe(studio.device()!.pk);

    await grow(laptop, { op: "revoke", device: studio.device()!.pk });
    const early = newDesktop(token);
    const look = await early.recoverer.open(words.join(" "));
    if (!look.ok) throw new Error(look.why);
    expect(look.channels).toEqual(["studio-late"]);
    early.recoverer.cancel();

    laptop.owned.push({ label: "after", code: "mc2-after", owner: await key("after") });
    await laptop.recovery.keepCurrent();
    expect(((await client.vault()).vault as Vault).pk).toBe(laptopKey.pk);
    const fresh = newDesktop(token);
    const open = await fresh.recoverer.open(words.join(" "));
    if (!open.ok) throw new Error(open.why);
    expect(open.channels.sort()).toEqual(["after", "studio-late"]);
    expect(await fresh.recoverer.finish([laptopKey.pk])).toEqual({ name: "Jow", channels: 2, forgot: 1 });
    expect(fresh.restored.value?.person.sk).toBe(person.sk);
  });
});
