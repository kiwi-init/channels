import { accountClient, type AccountClient } from "@kiwi/core/account.ts";
import { certUntil, nextLink, readDeviceList, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import { checkVault, openVault, readRecovery, readRecoveryPhrase, recoveryKey, sealVault, type Vault, type VaultContents } from "@kiwi/core/recovery.ts";
import type { PublicPerson, RecoverDoneView, RecoverOpenView } from "./bridge.ts";
import { myDevice } from "./devices.ts";
import { ownersOf, setUpAt, type RecoveryKept } from "./recovery.ts";

export interface Restored {
  person: Identity & { xpk: string; xsk: string };
  links: DeviceLink[];
  channels: VaultContents["channels"];
  kept: RecoveryKept;
}

export interface RecovererDeps {
  relayUrl: () => string;
  token: () => Promise<string | null>;
  who: () => PublicPerson | null;
  device: () => Identity | null;
  saveDevice: (d: Identity) => void;
  restored: (r: Restored) => void;
  label: () => string;
  os: () => string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface Recoverer {
  open(words: string): Promise<RecoverOpenView>;
  finish(lost: string[]): Promise<RecoverDoneView>;
  cancel(): void;
}

interface Opened {
  client: AccountClient;
  device: Identity;
  person: Restored["person"];
  contents: VaultContents;
  key: Awaited<ReturnType<typeof recoveryKey>>;
}

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

async function listOf(links: readonly unknown[]): Promise<DeviceList> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(`your device list doesn't hold up: ${read.why}`);
  return read.list;
}

export function createRecoverer(deps: RecovererDeps): Recoverer {
  const now = deps.now ?? Date.now;
  let opened: Opened | null = null;

  return {
    async open(words) {
      if (deps.who()) throw new Error("this app already holds your person");
      opened = null;
      const token = await deps.token();
      if (!token) throw new Error("sign in first, with the account your other computers use");
      const device = await myDevice(deps, deps.label());
      const client = accountClient(deps.relayUrl(), async () => (await deps.token()) ?? token, device, deps.fetchImpl);
      const links = await client.links();
      if (!links.length) return { ok: false, why: "this account has no Channels devices yet, so there's nothing to recover: start as a new person" };
      const list = await listOf(links);
      const got = await client.vault();
      if (!got.recovery.length) return { ok: false, why: "this account never set up a recovery key: approve this computer from one of your other devices" };
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
      if (got.vault === null) return { ok: false, why: "your recovery key holds no vault yet, so your person key isn't in it: approve this computer from one of your other devices" };
      const bad = await checkVault(got.vault, list);
      if (bad) throw new Error(`the relay's recovery vault doesn't hold up: ${bad}`);
      const contents = await openVault(got.vault as Vault, key);
      if (!contents) throw new Error("your recovery vault didn't open with those words");
      const { person } = contents;
      if (!person.xpk || !person.xsk) throw new Error("the person key in your vault has no exchange half");
      opened = { client, device, person: { ...person, xpk: person.xpk, xsk: person.xsk }, contents, key };
      const devices = list.devices.filter((d) => d.device !== device.pk).map((d) => ({ id: d.device, label: d.label, os: d.os, as: d.as, lost: d.as !== "computer" }));
      return { ok: true, name: person.name, devices, channels: contents.channels.map((c) => c.label) };
    },

    async finish(lost) {
      const o = opened;
      if (!o) throw new Error("type your recovery words again");
      const { client, device, person, key } = o;
      let links = (await client.links()) as DeviceLink[];
      let list = await listOf(links);
      if (list.person !== person.pk) throw new Error("this account's device list belongs to another person key");
      const append = async (body: Parameters<typeof nextLink>[2]) => {
        links = [...links, await nextLink(list, person, body, now())];
        list = await listOf(links);
      };
      if (!list.devices.some((d) => d.device === device.pk))
        await append({ op: "add", device: device.pk, dxpk: device.xpk!, label: deps.label(), os: deps.os(), as: "desktop", approve: true, until: certUntil(now()) });
      let forgot = 0;
      for (const id of new Set(lost)) {
        if (id === device.pk || !list.devices.some((d) => d.device === id)) continue;
        await append({ op: "revoke", device: id });
        forgot++;
      }
      await client.publish(links);
      const got = await client.vault();
      const read = await readRecovery(got.recovery, list, now());
      if (!read.ok) throw new Error(`your recovery key doesn't hold up: ${read.why}`);
      let contents = o.contents;
      if (got.vault !== null) {
        const bad = await checkVault(got.vault, list);
        if (bad) throw new Error(`the relay's recovery vault doesn't hold up: ${bad}`);
        const fresh = await openVault(got.vault as Vault, key);
        if (!fresh || fresh.person.pk !== person.pk) throw new Error("your recovery vault changed and no longer opens with those words: type them again");
        contents = fresh;
      }
      const version = got.vault === null ? 1 : (got.vault as Vault).version + 1;
      await client.keepVault({ vault: await sealVault(person, read.recovery, version, contents, now()) });
      opened = null;
      deps.restored({ person, links, channels: contents.channels, kept: { at: setUpAt(got.recovery) ?? now(), version, owners: ownersOf(contents.channels) } });
      return { name: person.name, channels: contents.channels.length, forgot };
    },

    cancel() {
      opened = null;
    },
  };
}
