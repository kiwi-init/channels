import type { AccountClient } from "@kiwi/core/account.ts";
import { readDeviceList, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import {
  checkVault,
  openVault,
  newRecoveryPhrase,
  readRecovery,
  readRecoveryPhrase,
  recoveryKey,
  recoveryLink,
  sealPerson,
  sealVault,
  type Recovery,
  type RecoveryLink,
  type SealedPerson,
  type Vault,
  type VaultContents,
} from "@kiwi/core/recovery.ts";
import type { RecoveryCancelView, RecoverySaveView, RecoveryView } from "./bridge.ts";

const byLabel = (list: DeviceList, pk: string): string =>
  pk === list.person ? "your person key" : (list.devices.find((d) => d.device === pk)?.label ?? list.revokes.find((r) => r.device === pk)?.label ?? "a device");

const CHECKS = 3;

export interface RecoveryKept {
  at: number;
  version: number;
  owners: string[];
  person?: SealedPerson;
  proven?: number;
}

export interface RecoveryHostDeps {
  session: () => Promise<{ client: AccountClient; device: Identity } | null>;
  person: () => Identity | null;
  links: () => DeviceLink[];
  owned: () => VaultContents["channels"];
  kept: () => RecoveryKept | null;
  keep: (k: RecoveryKept) => void;
  letGo: () => Promise<void>;
  now?: () => number;
}

export interface RecoveryHost {
  status(): Promise<RecoveryView | null>;
  words(): Promise<string[]>;
  save(typed: { at: number; word: string }[]): Promise<RecoverySaveView>;
  drop(): void;
  cancelPending(words: string): Promise<RecoveryCancelView>;
  keepCurrent(): Promise<void>;
}

const NOT_HERE = "set up the recovery key on the computer you first signed in on: it holds your person key";

const matches = (word: string, typed: string): boolean => {
  const t = typed.trim().toLowerCase();
  return t === word || (t.length >= 4 && word.startsWith(t));
};

export const ownersOf = (channels: VaultContents["channels"]): string[] => channels.map((c) => c.owner.pk).sort();

const sameOwners = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((pk, i) => pk === b[i]);

const lastSetUp = (chain: readonly unknown[]): RecoveryLink | null => [...(chain as RecoveryLink[])].reverse().find((l) => l.after === null) ?? null;

export const setUpAt = (chain: readonly unknown[]): number | null => lastSetUp(chain)?.at ?? null;

const typedHere = (chain: readonly unknown[], recovery: Recovery): boolean => {
  const made = [...(chain as RecoveryLink[])].reverse().find((l) => l.rpk === recovery.rpk);
  return !!made && (made.after === null || made.pk === made.person);
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

  const boxed = async (chain: readonly unknown[], recovery: Recovery): Promise<SealedPerson> => {
    const person = deps.person();
    if (person) {
      if (!typedHere(chain, recovery)) throw new Error("your recovery key was replaced by a device's proposal, so this app won't seal your person key to it");
      return sealPerson(recovery, person);
    }
    const kept = deps.kept()?.person;
    if (!kept) throw new Error(NOT_HERE);
    if (kept.rxpk !== recovery.rxpk) throw new Error("your recovery key changed after this app let go of your person key: type the old words to carry it over");
    return kept;
  };

  const seal = async (s: { client: AccountClient; device: Identity }, recovery: Recovery, chain: readonly unknown[], version: number, at: number, extend?: RecoveryLink[]): Promise<RecoveryKept> => {
    const channels = deps.owned();
    const person = await boxed(chain, recovery);
    const vault = await sealVault(deps.person() ?? s.device, recovery, version + 1, { person, channels }, now());
    await s.client.keepVault({ ...(extend ? { recovery: extend } : {}), vault });
    const next = { at, version: version + 1, owners: ownersOf(channels), person };
    deps.keep(next);
    return next;
  };

  const letGo = async (chain: readonly unknown[], recovery: Recovery, version: number): Promise<void> => {
    const k = deps.kept();
    if (deps.person() && !recovery.pending && typedHere(chain, recovery) && k?.person?.rxpk === recovery.rxpk && k.proven === version) await deps.letGo();
  };

  const proveBack = async (client: AccountClient, devices: DeviceList, version: number, key: Identity, person: Identity): Promise<void> => {
    const got = await client.vault();
    const bad = got.vault === null ? "the relay kept none" : await checkVault(got.vault, devices, version);
    if (bad) throw new Error(`your recovery vault didn't come back as sealed (${bad}), so this app keeps your person key`);
    const back = got.vault as Vault;
    const inside = back.version === version ? await openVault(back, key) : null;
    if (!inside || inside.person.pk !== person.pk || inside.person.sk !== person.sk)
      throw new Error("the vault on the relay doesn't open to your person key with these words, so this app keeps it: make new words");
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
      const at = got.recovery.length ? setUpAt(got.recovery) : null;
      const devices = got.recovery.length && deps.links().length ? await list().catch(() => null) : null;
      const read = devices ? await readRecovery(got.recovery, devices, now()) : null;
      const pending = read?.ok ? read.recovery.pending : null;
      return { at, here: !!deps.person(), ...(pending && devices ? { pending: { from: pending.after, by: byLabel(devices, pending.by) } } : {}) };
    },

    async cancelPending(words) {
      const phrase = await readRecoveryPhrase(words);
      if (!phrase.ok) return { ok: false, why: phrase.why, ...(phrase.word !== undefined ? { word: phrase.word } : {}) };
      const key = await recoveryKey(phrase.entropy);
      const session = await signedIn();
      const devices = await list();
      const before = await kept(session.client, devices);
      if (!before.recovery) return { ok: false, why: "this account has no recovery key" };
      if (!before.recovery.pending) return { ok: true };
      if (key.pk !== before.recovery.rpk)
        return { ok: false, why: before.recovery.pending.rpk === key.pk ? "those are the new words: type the ones you had before" : "those aren't your current words" };
      const link = await recoveryLink(key, devices.person, before.recovery, { pk: key.pk, xpk: key.xpk! }, now());
      const chain = [...(before.chain as RecoveryLink[]), link];
      const read = await readRecovery(chain, devices, now());
      if (!read.ok || read.recovery.pending) throw new Error(`cancelling the new words didn't hold up${read.ok ? "" : `: ${read.why}`}`);
      await session.client.keepVault({ recovery: chain });
      return { ok: true };
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
      const session = await signedIn();
      const devices = await list();
      const before = await kept(session.client, devices);
      const link = await recoveryLink(person, person.pk, before.recovery, { pk: key.pk, xpk: key.xpk! }, now());
      const chain = [...(before.chain as RecoveryLink[]), link];
      const read = await readRecovery(chain, devices, now());
      if (!read.ok) throw new Error(`the new recovery key doesn't hold up: ${read.why}`);
      const waits = read.recovery.pending?.rpk === key.pk ? read.recovery.pending : null;
      if (waits) {
        await session.client.keepVault({ recovery: chain });
        held = null;
        return { ok: true, at: link.at, from: waits.after };
      }
      const done = await seal(session, read.recovery, chain, before.version, link.at, chain);
      held = null;
      await proveBack(session.client, devices, done.version, key, person);
      deps.keep({ ...done, proven: done.version });
      await letGo(chain, read.recovery, done.version).catch(() => {
        // The words are saved either way; the next enrollPoll lists the computers and lets the person key go.
      });
      return { ok: true, at: done.at };
    },

    drop() {
      held = null;
    },

    async keepCurrent() {
      const person = deps.person();
      const was = deps.kept();
      if (!person && !was?.person) return;
      const current = !!was && sameOwners(was.owners, ownersOf(deps.owned()));
      if (person ? !was && looked : current) return;
      const s = await deps.session();
      if (!s) return;
      const before = await kept(s.client, await list());
      looked = true;
      if (!before.recovery) return;
      const version =
        !current || !was?.person || was.version !== before.version || was.person.rxpk !== before.recovery.rxpk
          ? (await seal(s, before.recovery, before.chain, before.version, before.at ?? now())).version
          : before.version;
      await letGo(before.chain, before.recovery, version);
    },
  };
}
