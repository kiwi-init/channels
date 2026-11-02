import type { AccountClient } from "@kiwi/core/account.ts";
import { readDeviceList, rerootLink, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import {
  boxesIn,
  checkVault,
  heldIn,
  isOldVault,
  openVault,
  readRecovery,
  readRecoveryPhrase,
  recoveryKey,
  sealVault,
  type OldVault,
  type RecoveryLink,
  type Vault,
  type VaultContents,
} from "@kiwi/core/recovery.ts";
import type { PublicPerson, RerootDoneView, RerootOpenView } from "./bridge.ts";
import { ownersOf, setUpAt, type RecoveryKept } from "./recovery.ts";

export interface Rerooted {
  who: PublicPerson;
  links: DeviceLink[];
  kept: RecoveryKept;
}

export interface RerooterDeps {
  session: () => Promise<{ client: AccountClient; device: Identity } | null>;
  who: () => PublicPerson | null;
  owned: () => VaultContents["channels"];
  rerooted: (r: Rerooted) => void;
  now?: () => number;
}

export interface Rerooter {
  open(words: string): Promise<RerootOpenView>;
  finish(keep: string[]): Promise<RerootDoneView>;
  cancel(): void;
}

interface Opened {
  client: AccountClient;
  device: Identity;
  who: PublicPerson;
  key: Awaited<ReturnType<typeof recoveryKey>>;
  channels: VaultContents["channels"];
}

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

async function listOf(links: readonly unknown[]): Promise<DeviceList> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(`your device list doesn't hold up: ${read.why}`);
  return read.list;
}

async function vaultOf(client: AccountClient, list: DeviceList, key: Opened["key"]): Promise<{ vault: Vault | OldVault | null; contents: VaultContents | null }> {
  const got = await client.vault();
  if (got.vault === null) return { vault: null, contents: null };
  const bad = await checkVault(got.vault, list);
  if (bad) throw new Error(`the relay's recovery vault doesn't hold up: ${bad}`);
  const vault = got.vault as Vault | OldVault;
  const contents = await openVault(vault, key, list.root);
  if (!contents) throw new Error("your recovery vault didn't open with those words");
  return { vault, contents };
}

export function createRerooter(deps: RerooterDeps): Rerooter {
  const now = deps.now ?? Date.now;
  let opened: Opened | null = null;

  return {
    async open(words) {
      opened = null;
      const s = await deps.session();
      if (!s) throw new Error("sign in first, with the account your other devices use");
      const who = deps.who();
      if (!who) throw new Error("this app isn't one of your devices yet: recover it with your words instead");
      const list = await listOf(await s.client.links());
      if (list.person !== who.pk) throw new Error("this account's device list belongs to another person");
      if (!list.devices.some((d) => d.device === s.device.pk && d.approve)) throw new Error("only a computer that approves your devices replaces your person key");
      const got = await s.client.vault();
      if (!got.recovery.length) return { ok: false, why: "this account never set up a recovery key, so the words can't replace your person key" };
      const read = await readRecovery(got.recovery, list, now());
      if (!read.ok) throw new Error(`your recovery key doesn't hold up: ${read.why}`);
      const phrase = await readRecoveryPhrase(words);
      if (!phrase.ok) return { ok: false, why: phrase.why, ...(phrase.word !== undefined ? { word: phrase.word } : {}) };
      const key = await recoveryKey(phrase.entropy);
      const { rpk, pending } = read.recovery;
      if (key.pk !== rpk) {
        if (pending?.rpk === key.pk) return { ok: false, why: `those are the new words, and they count from ${fmt.format(pending.after)}: use the words you had before` };
        return { ok: false, why: "those aren't the words of this account's recovery key" };
      }
      const { contents } = await vaultOf(s.client, list, key);
      opened = { client: s.client, device: s.device, who, key, channels: contents?.channels ?? [] };
      const devices = list.devices.map((d) => ({ id: d.device, label: d.label, os: d.os, as: d.as, here: d.device === s.device.pk }));
      return { ok: true, name: who.name, devices, channels: (contents?.channels ?? []).map((c) => c.label) };
    },

    async finish(keep) {
      const o = opened;
      if (!o) throw new Error("type your recovery words again");
      const links = (await o.client.links()) as DeviceLink[];
      const list = await listOf(links);
      if (list.person !== o.who.pk) throw new Error("this account's device list belongs to another person");
      if (!list.devices.some((d) => d.device === o.device.pk && d.approve)) throw new Error("this computer was removed from your devices meanwhile");
      const kept = new Set([o.device.pk, ...keep.filter((id) => list.devices.some((d) => d.device === id))]);
      const got = await o.client.vault();
      const chain = got.recovery as RecoveryLink[];
      const before = await readRecovery(chain, list, now());
      if (!before.ok) throw new Error(`your recovery key doesn't hold up: ${before.why}`);
      if (before.recovery.rpk !== o.key.pk) throw new Error("your recovery key changed meanwhile: type the words again");
      const fresh = await vaultOf(o.client, list, o.key);
      const all = fresh.contents?.channels ?? o.channels;
      const mine = deps.owned();
      const old = !fresh.vault || isOldVault(fresh.vault);
      const channels = old ? [...mine, ...all.filter((c) => !mine.some((m) => m.owner.pk === c.owner.pk))] : mine;
      const root = await withExchangeKey(await generateIdentity(o.who.name));
      const next = [...links, await rerootLink(list, o.key, chain, root, [...kept], now())];
      await o.client.publish(next);
      const after = await readRecovery(chain, await listOf(next), now());
      if (!after.ok) throw new Error(`your recovery key doesn't hold up after the change: ${after.why}`);
      const version = (fresh.vault?.version ?? 0) + 1;
      const vault = await sealVault(o.device, after.recovery, version, { person: root, channels, device: o.device.pk, others: boxesIn(fresh.vault) }, now());
      await o.client.keepVault({ vault });
      opened = null;
      const person = heldIn(vault);
      deps.rerooted({ who: { ...o.who, xpk: root.xpk! }, links: next, kept: { at: setUpAt(chain) ?? now(), version, owners: ownersOf(mine), ...(person ? { person } : {}) } });
      return { kept: kept.size, dropped: list.devices.length - kept.size, channels: all.length };
    },

    cancel() {
      opened = null;
    },
  };
}
