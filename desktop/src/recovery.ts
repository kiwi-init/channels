import type { AccountClient } from "@kiwi/core/account.ts";
import { readDeviceList, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import {
  checkVault,
  newRecoveryPhrase,
  readRecovery,
  readRecoveryPhrase,
  recoveryKey,
  recoveryLink,
  sealVault,
  type Recovery,
  type RecoveryLink,
  type Vault,
  type VaultContents,
} from "@kiwi/core/recovery.ts";
import type { RecoverySaveView, RecoveryView } from "./bridge.ts";

const CHECKS = 3;

export interface RecoveryKept {
  at: number;
  version: number;
  owners: string[];
}

export interface RecoveryHostDeps {
  session: () => Promise<{ client: AccountClient; device: Identity } | null>;
  person: () => Identity | null;
  links: () => DeviceLink[];
  owned: () => VaultContents["channels"];
  kept: () => RecoveryKept | null;
  keep: (k: RecoveryKept) => void;
  now?: () => number;
}

export interface RecoveryHost {
  status(): Promise<RecoveryView | null>;
  words(): Promise<string[]>;
  save(typed: { at: number; word: string }[]): Promise<RecoverySaveView>;
  drop(): void;
  keepCurrent(): Promise<void>;
}

const NOT_HERE = "set up the recovery key on the computer you first signed in on: it holds your person key";

const matches = (word: string, typed: string): boolean => {
  const t = typed.trim().toLowerCase();
  return t === word || (t.length >= 4 && word.startsWith(t));
};

const ownersOf = (channels: VaultContents["channels"]): string[] => channels.map((c) => c.owner.pk).sort();

const sameOwners = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((pk, i) => pk === b[i]);

const setUpAt = (chain: readonly unknown[]): number | null => {
  const now = [...(chain as RecoveryLink[])].reverse().find((l) => l.after === null);
  return now?.at ?? null;
};

export function createRecoveryHost(deps: RecoveryHostDeps): RecoveryHost {
  const now = deps.now ?? Date.now;
  let held: string[] | null = null;
  let looked = false;

  const list = async (): Promise<DeviceList> => {
    const read = await readDeviceList(deps.links());
    if (!read.ok) throw new Error(`your device list doesn't hold up: ${read.why}`);
    return read.list;
  };

  const kept = async (client: AccountClient, devices: DeviceList): Promise<{ chain: unknown[]; recovery: Recovery | null; version: number; at: number | null }> => {
    const got = await client.vault();
    const known = deps.kept()?.version ?? 0;
    let recovery: Recovery | null = null;
    if (got.recovery.length) {
      const read = await readRecovery(got.recovery, devices, now());
      if (!read.ok) throw new Error(`your recovery key doesn't hold up: ${read.why}`);
      recovery = read.recovery;
    }
    if (got.vault === null) {
      if (known) throw new Error(`the relay lost your recovery vault, which was at version ${known}`);
      return { chain: got.recovery, recovery, version: 0, at: setUpAt(got.recovery) };
    }
    const bad = await checkVault(got.vault, devices, known);
    if (bad) throw new Error(`the relay's recovery vault doesn't hold up: ${bad}`);
    return { chain: got.recovery, recovery, version: (got.vault as Vault).version, at: setUpAt(got.recovery) };
  };

  const seal = async (client: AccountClient, person: Identity, recovery: Recovery, version: number, at: number, chain?: RecoveryLink[]): Promise<RecoveryKept> => {
    const channels = deps.owned();
    const vault = await sealVault(person, recovery, version + 1, { person, channels }, now());
    await client.keepVault({ ...(chain ? { recovery: chain } : {}), vault });
    const next = { at, version: version + 1, owners: ownersOf(channels) };
    deps.keep(next);
    return next;
  };

  const signedIn = async () => {
    const s = await deps.session();
    if (!s) throw new Error("sign in to set up a recovery key");
    return s;
  };

  return {
    async status() {
      const s = await deps.session();
      if (!s) return null;
      const got = await s.client.vault();
      return { at: got.recovery.length ? setUpAt(got.recovery) : null, here: !!deps.person() };
    },

    async words() {
      if (!deps.person()) throw new Error(NOT_HERE);
      held ??= await newRecoveryPhrase();
      return held;
    },

    async save(typed) {
      const words = held;
      if (!words) throw new Error("those words are gone: start the recovery key again");
      const asked = new Set(typed.map((t) => t.at));
      if (asked.size < CHECKS || typed.some((t) => !Number.isInteger(t.at) || t.at < 0 || t.at >= words.length)) throw new Error(`type ${CHECKS} of the words to check them`);
      const wrong = typed.filter((t) => !matches(words[t.at]!, t.word)).map((t) => t.at);
      if (wrong.length) return { ok: false, wrong };
      const person = deps.person();
      if (!person) throw new Error(NOT_HERE);
      const phrase = await readRecoveryPhrase(words.join(" "));
      if (!phrase.ok) throw new Error(`those words don't make a recovery key: ${phrase.why}`);
      const key = await recoveryKey(phrase.entropy);
      const { client } = await signedIn();
      const devices = await list();
      const before = await kept(client, devices);
      const link = await recoveryLink(person, person.pk, before.recovery, { pk: key.pk, xpk: key.xpk! }, now());
      const chain = [...(before.chain as RecoveryLink[]), link];
      const read = await readRecovery(chain, devices, now());
      if (!read.ok) throw new Error(`the new recovery key doesn't hold up: ${read.why}`);
      const done = await seal(client, person, read.recovery, before.version, link.at, chain);
      held = null;
      return { ok: true, at: done.at };
    },

    drop() {
      held = null;
    },

    async keepCurrent() {
      const person = deps.person();
      if (!person) return;
      const was = deps.kept();
      if (was ? sameOwners(was.owners, ownersOf(deps.owned())) : looked) return;
      const s = await deps.session();
      if (!s) return;
      const before = await kept(s.client, await list());
      looked = true;
      if (!before.recovery) return;
      await seal(s.client, person, before.recovery, before.version, before.at ?? now());
    },
  };
}
