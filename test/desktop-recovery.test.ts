import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountClient } from "@kiwi/core/account.ts";
import type { DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { openVault, readRecoveryPhrase, recoveryKey, type Vault, type VaultContents } from "@kiwi/core/recovery.ts";
import { createDeviceHost, type DeviceHost } from "../desktop/src/devices.ts";
import { createRecoveryHost, type RecoveryHost, type RecoveryKept } from "../desktop/src/recovery.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-recovery-"));
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

interface App {
  host: DeviceHost;
  recovery: RecoveryHost;
  person: Identity;
  token: string;
  owned: VaultContents["channels"];
  kept: { value: RecoveryKept | null };
  swap: { vault: string | null };
}

async function app(opts: { person?: boolean } = {}): Promise<App> {
  const token = `dev:recover${++users}`;
  const person = await key("Jow");
  const holds = opts.person !== false;
  let device: Identity | null = null;
  let links: DeviceLink[] = [];
  const swap: App["swap"] = { vault: null };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (swap.vault && url.pathname === "/v1/account/vault" && (init?.method ?? "GET") === "GET") return new Response(swap.vault, { headers: { "content-type": "application/json" } });
    return fetch(input, init);
  }) as typeof fetch;
  const host = createDeviceHost({
    relayUrl: () => relay,
    token: async () => token,
    person: () => person,
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
    person: () => (holds ? person : null),
    links: () => links,
    owned: () => owned,
    kept: () => kept.value,
    keep: (k) => void (kept.value = k),
  });
  return { host, recovery, person, token, owned, kept, swap };
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

async function channel(label: string): Promise<VaultContents["channels"][number]> {
  return { label, code: `mc2-${label}`, owner: await key(label) };
}

describe("setting up the recovery key on the desktop", () => {
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
    expect(a.kept.value).toEqual({ at: saved.ok ? saved.at : 0, version: 1, owners: [a.owned[0]!.owner.pk] });
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
    expect((await opened(words, got.vault!))?.channels.map((c) => c.label)).toEqual(["design"]);
  });

  test("an app that lost its local note reseals once from what the relay keeps", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [4, 5, 6]));
    a.kept.value = null;
    await a.recovery.keepCurrent();
    expect((await relayVault(a)).vault?.version).toBe(2);
    expect(a.kept.value).toMatchObject({ version: 2 });
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
    expect((await opened(fresh, got.vault!))?.person.pk).toBe(a.person.pk);
  });

  test("another person's app can't read this account's recovery state", async () => {
    const a = await app();
    const words = await a.recovery.words();
    await a.recovery.save(typed(words, [0, 1, 2]));
    const stranger = accountClient(relay, async () => "dev:stranger", await key("stranger"));
    expect((await stranger.vault()).recovery).toEqual([]);
  });
});
