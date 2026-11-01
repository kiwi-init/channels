import type { DeviceLink } from "@kiwi/core/devices.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import type { Personality } from "@kiwi/core/personality.ts";
import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import type { ChannelIdentityView, ComputerView, KeysAtRest, PendingItem, PersonView, PhoneView, PublicPerson, StoreSnapshot } from "./bridge.ts";
import { errorText, normalizeRelay, snapshotOf } from "./guard.ts";
import { host } from "./host.ts";
import { logMainError } from "./main-log.ts";
import type { RecoveryKept } from "./recovery.ts";

export interface StoreFile {
  relayUrl: string;
  person: PersonView | null;
  channels: ChannelIdentityView[];
  computers: ComputerView[];
  phones?: PhoneView[];
  pending: PendingItem[];
  signin?: { access: string; refresh: string; exp: number };
  github?: { login: string; id: number; token: string; at: number; relay?: string; clientId?: string; first?: boolean; moved?: boolean };
  migrated?: boolean;
  personalities?: Personality[];
  device?: Identity;
  deviceLinks?: DeviceLink[];
  enrolled?: PublicPerson;
  recovery?: RecoveryKept;
}

export type VaultRead = { ok: true; file: Partial<StoreFile> | null; resave: boolean } | { ok: false; why: string; advice?: string };

export interface StoreVault {
  where(): string;
  load(): VaultRead;
  save(file: StoreFile): void;
  atRest?(): KeysAtRest;
}

function defaults(): StoreFile {
  return { relayUrl: DEFAULT_RELAY, person: null, channels: [], computers: [], pending: [] };
}

export let store: StoreFile = defaults();

let vault: StoreVault | null = null;

let storeBroken: string | null = null;

let brokenAdvice: string | null = null;

function loaded(v: StoreVault): VaultRead {
  try {
    return v.load();
  } catch (e) {
    // A load that stopped partway may have left either copy half-restored: the store counts as unreadable, so nothing saves over them, and main.log says why.
    logMainError(e);
    return { ok: false, why: errorText(e) };
  }
}

export function openStore(v: StoreVault): void {
  const read = loaded(v);
  vault = v;
  store = read.ok && read.file ? { ...defaults(), ...read.file } : defaults();
  storeBroken = read.ok ? null : read.why || "an error with no message";
  brokenAdvice = read.ok ? null : (read.advice ?? null);
  store.relayUrl = normalizeRelay(store.relayUrl) ?? DEFAULT_RELAY;
  const staleVoice = Object.hasOwn(store, "voice") && Reflect.deleteProperty(store, "voice");
  if (read.ok && read.file && (staleVoice || read.resave)) saveStore();
}

const brokenError = () =>
  new Error(
    `Channels can't read its saved keys (${storeBroken}), so it saves nothing over them. ${brokenAdvice ?? "Unlock your keychain, then quit and reopen Channels."} The file is ${vault?.where()}.`,
  );

export const keysAtRest = (): KeysAtRest => vault?.atRest?.() ?? { sealed: true, why: null };

export const brokenStore = (): Error | null => (storeBroken === null ? null : brokenError());

function saveStore(): void {
  if (storeBroken !== null) throw brokenError();
  if (!vault) throw new Error("the store isn't open yet");
  vault.save(store);
}

export const snapshot = (): StoreSnapshot => snapshotOf(store);
export const mutate = (fn: (s: StoreFile) => void) => {
  if (storeBroken !== null) throw brokenError();
  fn(store);
  saveStore();
  const shell = host();
  shell.push("store", snapshot());
  shell.tellKeys({ type: "seats", seats: store.channels, person: personPk(), mine: store.computers.map((c) => c.machinePk) });
};

export const personPk = (): string | null => store.person?.pk ?? store.enrolled?.pk ?? null;

export function requirePerson(): Identity {
  const p = store.person;
  if (!p && store.enrolled) throw new Error("this app signed in as one of your devices: do this from the app that made your person key");
  if (!p || !p.xsk) throw new Error("make your person key first");
  return { name: p.name, pk: p.pk, sk: p.sk, xpk: p.xpk, xsk: p.xsk };
}

export function personSigner(): { signer: Identity; person: string } {
  if (store.person?.xsk) return { signer: requirePerson(), person: store.person.pk };
  if (store.enrolled && store.device && store.deviceLinks?.length) return { signer: store.device, person: store.enrolled.pk };
  throw new Error("make your person key first");
}

export function upsertComputer(c: ComputerView): void {
  mutate((s) => {
    s.computers = [...s.computers.filter((x) => x.machinePk !== c.machinePk), c];
  });
}
