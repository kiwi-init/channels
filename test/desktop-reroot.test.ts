import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountClient } from "@kiwi/core/account.ts";
import { certUntil, nextLink, readDeviceList, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { newRecoveryPhrase, openVault, readRecovery, readRecoveryPhrase, recoveryKey, recoveryLink, type RecoveryLink, type Vault, type VaultContents } from "@kiwi/core/recovery.ts";
import { createDeviceHost, type DeviceHost } from "../desktop/src/devices.ts";
import { createRecoverer, type Restored } from "../desktop/src/recover.ts";
import { createRecoveryHost, type RecoveryHost, type RecoveryKept } from "../desktop/src/recovery.ts";
import { createRerooter, type Rerooted, type Rerooter } from "../desktop/src/reroot.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-reroot-"));
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

interface Desktop {
  host: DeviceHost;
  recovery: RecoveryHost;
  rerooter: Rerooter;
  owned: VaultContents["channels"];
  kept: { value: RecoveryKept | null };
  holds: { value: boolean };
  links: () => DeviceLink[];
  device: () => Identity | null;
  rerooted: { value: Rerooted | null };
}

function desktop(token: string, person: Identity, label: string, start: DeviceLink[] = [], held: Identity | null = null): Desktop {
  let device = held;
  let links = start;
  const holds = { value: !held };
  const who = () => ({ name: person.name, pk: person.pk, xpk: person.xpk! });
  const host = createDeviceHost({
    relayUrl: () => relay,
    token: async () => token,
    person: () => (holds.value ? person : null),
    who,
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
  const rerooted: Desktop["rerooted"] = { value: null };
  const rerooter = createRerooter({
    session: () => host.session(),
    who,
    owned: () => owned,
    rerooted: (r) => {
      rerooted.value = r;
      holds.value = false;
      links = r.links;
      kept.value = r.kept;
    },
  });
  return { host, recovery, rerooter, owned, kept, holds, links: () => links, device: () => device, rerooted };
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

async function listOf(links: readonly unknown[]): Promise<DeviceList> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return read.list;
}

async function wordsKey(words: string[]) {
  const read = await readRecoveryPhrase(words.join(" "));
  if (!read.ok) throw new Error(read.why);
  return recoveryKey(read.entropy);
}

async function account() {
  const token = `dev:reroot${++users}`;
  const person = await key("Jow");
  const studio = desktop(token, person, "studio");
  studio.owned.push({ label: "general", code: "mc2-general", owner: await key("general") });
  await studio.host.poll();
  const words = await studio.recovery.words();
  const saved = await studio.recovery.save([0, 7, 23].map((at) => ({ at, word: words[at]! })));
  if (!saved.ok) throw new Error("setup failed");
  const laptopKey = await key("laptop");
  const phone = await key("phone");
  await grow(studio, { op: "add", device: laptopKey.pk, dxpk: laptopKey.xpk!, label: "laptop", os: "macOS", as: "desktop", approve: true, until: certUntil(Date.now()) });
  const links = await grow(studio, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) });
  const laptop = desktop(token, person, "laptop", links, laptopKey);
  laptop.owned.push({ label: "side", code: "mc2-side", owner: await key("side") });
  await laptop.recovery.keepCurrent();
  return { token, person, words, studio, laptop, phone };
}

function newDesktop(token: string): { recoverer: ReturnType<typeof createRecoverer>; restored: { value: Restored | null }; device: () => Identity | null } {
  let device: Identity | null = null;
  const restored: { value: Restored | null } = { value: null };
  const recoverer = createRecoverer({
    relayUrl: () => relay,
    token: async () => token,
    who: () => null,
    device: () => device,
    saveDevice: (d) => void (device = d),
    restored: (r) => void (restored.value = r),
    label: () => "new-mac",
    os: () => "macOS",
  });
  return { recoverer, restored, device: () => device };
}

describe("replacing the person key from the desktop (T2415)", () => {
  test("the words make a new root, keep the devices chosen and this one, and reseal the vault for the new root", async () => {
    const a = await account();
    const wrong = await a.laptop.rerooter.open([...a.words.slice(0, 23), a.words[23] === "zoo" ? "abandon" : "zoo"].join(" "));
    expect(wrong.ok).toBe(false);
    const open = await a.laptop.rerooter.open(a.words.join(" "));
    if (!open.ok) throw new Error(open.why);
    expect(open.name).toBe("Jow");
    expect(open.devices.map((d) => [d.label, d.here])).toEqual([
      ["studio", false],
      ["laptop", true],
      ["phone", false],
    ]);
    expect(open.channels.sort()).toEqual(["general", "side"]);

    const studio = a.studio.device()!.pk;
    expect(await a.laptop.rerooter.finish([studio])).toEqual({ kept: 2, dropped: 1, channels: 2 });
    const list = await listOf(a.laptop.links());
    expect(list.person).toBe(a.person.pk);
    expect(list.root).not.toBe(a.person.pk);
    expect(list.reroots).toHaveLength(1);
    expect(list.devices.map((d) => d.label).sort()).toEqual(["laptop", "studio"]);
    expect(list.revoked).toEqual([a.phone.pk]);

    const client = accountClient(relay, async () => a.token, a.laptop.device()!);
    const vault = (await client.vault()).vault as Vault;
    expect(vault.held.pk).toBe(list.root);
    const inside = await openVault(vault, await wordsKey(a.words), list.root);
    expect(inside?.person.pk).toBe(list.root);
    expect(inside?.channels.map((c) => c.label).sort()).toEqual(["general", "side"]);
    expect(a.laptop.rerooted.value?.who.pk).toBe(a.person.pk);
    expect(a.laptop.rerooted.value?.kept).toMatchObject({ version: vault.version, person: { pk: list.root } });
  });

  test("words that aren't this account's current recovery key replace nothing", async () => {
    const a = await account();
    await expect(a.laptop.rerooter.finish([])).rejects.toThrow("type your recovery words again");
    expect(await a.laptop.rerooter.open((await account()).words.join(" "))).toEqual({ ok: false, why: "those aren't the words of this account's recovery key" });
    expect(await a.laptop.rerooter.open(a.words.slice(0, 23).join(" "))).toMatchObject({ ok: false });
    await expect(a.laptop.rerooter.finish([])).rejects.toThrow("type your recovery words again");
    expect((await listOf(a.laptop.links())).reroots).toHaveLength(0);
  });

  test("the new words of a pending change can't replace it, and words that changed after opening stop it", async () => {
    const a = await account();
    const s = (await a.laptop.host.session())!;
    const list = await listOf(a.laptop.links());
    const got = await s.client.vault();
    const read = await readRecovery(got.recovery, list, Date.now());
    if (!read.ok) throw new Error(read.why);
    const nextWords = await newRecoveryPhrase();
    const next = await wordsKey(nextWords);
    const proposal = await recoveryLink(s.device, list.person, read.recovery, { pk: next.pk, xpk: next.xpk! });
    await s.client.keepVault({ recovery: [...(got.recovery as RecoveryLink[]), proposal] });
    const pending = await a.laptop.rerooter.open(nextWords.join(" "));
    expect(pending).toMatchObject({ ok: false });
    if (pending.ok) return;
    expect(pending.why).toStartWith("those are the new words");

    let clock = Date.now();
    const later = createRerooter({ session: () => a.laptop.host.session(), who: () => ({ name: "Jow", pk: a.person.pk, xpk: a.person.xpk! }), owned: () => [], rerooted: () => {}, now: () => clock });
    expect((await later.open(a.words.join(" "))).ok).toBe(true);
    clock += 8 * 86_400_000;
    await expect(later.finish([])).rejects.toThrow("your recovery key changed meanwhile: type the words again");
    expect((await listOf(a.laptop.links())).reroots).toHaveLength(0);
  });

  test("only an approving computer of this person replaces it, and not one removed after opening", async () => {
    const a = await account();
    const helper = await key("helper");
    const links = await grow(a.studio, { op: "add", device: helper.pk, dxpk: helper.xpk!, label: "helper", os: "Linux", as: "computer", approve: false, until: certUntil(Date.now()) });
    const computer = desktop(a.token, a.person, "helper", links, helper);
    await expect(computer.rerooter.open(a.words.join(" "))).rejects.toThrow("only a computer that approves your devices replaces your person key");

    const stranger = desktop(a.token, await key("Mallory"), "laptop", links, a.laptop.device());
    await expect(stranger.rerooter.open(a.words.join(" "))).rejects.toThrow("this sign-in already belongs to another Channels person key");

    const open = await a.laptop.rerooter.open(a.words.join(" "));
    if (!open.ok) throw new Error(open.why);
    await grow(a.studio, { op: "revoke", device: a.laptop.device()!.pk });
    await expect(a.laptop.rerooter.finish([])).rejects.toThrow("this computer was removed from your devices meanwhile");
    expect((await listOf(a.studio.links())).reroots).toHaveLength(0);
  });

  test("an account that never set up words has nothing to replace the key with", async () => {
    const token = `dev:reroot${++users}`;
    const person = await key("Jow");
    const studio = desktop(token, person, "studio");
    await studio.host.poll();
    expect(await studio.rerooter.open((await newRecoveryPhrase()).join(" "))).toMatchObject({ ok: false, why: "this account never set up a recovery key, so the words can't replace your person key" });
  });

  test("after it, the old person key signs nothing, and the other desktops keep sealing the vault at the new root", async () => {
    const a = await account();
    const open = await a.laptop.rerooter.open(a.words.join(" "));
    if (!open.ok) throw new Error(open.why);
    await a.laptop.rerooter.finish([a.studio.device()!.pk]);
    const links = a.laptop.links();
    const list = await listOf(links);
    const forged = [...links, await nextLink(list, a.person, { op: "revoke", device: a.laptop.device()!.pk })];
    expect((await readDeviceList(forged)).ok).toBe(false);

    await a.studio.host.poll();
    a.studio.owned.push({ label: "more", code: "mc2-more", owner: await key("more") });
    await a.studio.recovery.keepCurrent();
    const client = accountClient(relay, async () => a.token, a.studio.device()!);
    const vault = (await client.vault()).vault as Vault;
    expect(vault.held.pk).toBe(list.root);
    const inside = await openVault(vault, await wordsKey(a.words), list.root);
    expect(inside?.channels.map((c) => c.label).sort()).toEqual(["general", "more", "side"]);
  });

  test("after it, the words still recover everything on a new desktop, at the new root", async () => {
    const a = await account();
    const open = await a.laptop.rerooter.open(a.words.join(" "));
    if (!open.ok) throw new Error(open.why);
    await a.laptop.rerooter.finish([]);
    const list = await listOf(a.laptop.links());

    const fresh = newDesktop(a.token);
    const back = await fresh.recoverer.open(a.words.join(" "));
    if (!back.ok) throw new Error(back.why);
    expect(back.channels.sort()).toEqual(["general", "side"]);
    expect(await fresh.recoverer.finish([a.laptop.device()!.pk])).toMatchObject({ name: "Jow", channels: 2, forgot: 1 });
    const r = fresh.restored.value!;
    expect(r.person.pk).toBe(list.root);
    expect(r.who.pk).toBe(a.person.pk);
  });
});
