import type { Identity } from "@kiwi/core/identity.ts";
import type { Personality } from "@kiwi/core/personality.ts";
import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";
import type { ChannelIdentityView, ComputerView, PendingItem, PersonView, PhoneView, StoreSnapshot } from "./bridge.ts";
import { errorText, normalizeRelay, snapshotOf } from "./guard.ts";
import { host } from "./host.ts";
import { logMainError } from "./main-log.ts";

export interface StoreFile {
  relayUrl: string;
  person: PersonView | null;
  channels: ChannelIdentityView[];
  computers: ComputerView[];
  phones?: PhoneView[];
  pending: PendingItem[];
  signin?: { access: string; refresh: string; exp: number };
  github?: { login: string; id: number; token: string; at: number; relay?: string; clientId?: string };
  migrated?: boolean;
  personalities?: Personality[];
}

export type VaultRead = { ok: true; file: Partial<StoreFile> | null; resave: boolean } | { ok: false; why: string; advice?: string };

export interface StoreVault {
  where(): string;
  load(): VaultRead;
  save(file: StoreFile): void;
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
  shell.tellKeys({ type: "seats", seats: store.channels, person: store.person?.pk ?? null });
};

export function requirePerson(): Identity {
  const p = store.person;
  if (!p || !p.xsk) throw new Error("make your person key first");
  return { name: p.name, pk: p.pk, sk: p.sk, xpk: p.xpk, xsk: p.xsk };
}

export function upsertComputer(c: ComputerView): void {
  mutate((s) => {
    s.computers = [...s.computers.filter((x) => x.machinePk !== c.machinePk), c];
  });
}
