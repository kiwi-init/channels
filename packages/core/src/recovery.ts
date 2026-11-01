import { b64url, openFrom, sealTo } from "./crypto.ts";
import { canonical, sign, verify, type Identity } from "./identity.ts";
import type { DeviceList } from "./devices.ts";
import { RECOVERY_WORDS } from "./recovery-words.ts";

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;
const PHRASE_WORDS = 24;
const ENTROPY_BYTES = 32;
const RECOVERY_DELAY_DAYS = 7;
export const PERSON_WORDS_WAIT_FROM = Date.UTC(2026, 10, 1, 2);
const RECOVERY_MAX = 256;
const VAULT_BOX_MAX = 512 * 1024;
const enc = new TextEncoder();

const PKCS8_PREFIX = { Ed25519: "302e020100300506032b657004220420", X25519: "302e020100300506032b656e04220420" } as const;

let index: Map<string, number> | null = null;
let byPrefix: Map<string, number> | null = null;

function wordIndex(word: string): number | undefined {
  if (!index || !byPrefix) {
    index = new Map(RECOVERY_WORDS.map((w, i) => [w, i]));
    byPrefix = new Map(RECOVERY_WORDS.map((w, i) => [w.slice(0, 4), i]));
  }
  const exact = index.get(word);
  if (exact !== undefined || word.length < 4) return exact;
  const i = byPrefix.get(word.slice(0, 4));
  return i !== undefined && RECOVERY_WORDS[i]!.startsWith(word) ? i : undefined;
}

async function checksum(entropy: Uint8Array<ArrayBuffer>): Promise<number> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", entropy))[0]!;
}

export async function phraseOf(entropy: Uint8Array<ArrayBuffer>): Promise<string[]> {
  if (entropy.length !== ENTROPY_BYTES) throw new Error("a recovery key holds 32 bytes");
  const bytes = [...entropy, await checksum(entropy)];
  const words: string[] = [];
  for (let w = 0; w < PHRASE_WORDS; w++) {
    let n = 0;
    for (let b = w * 11; b < w * 11 + 11; b++) n = (n << 1) | ((bytes[b >> 3]! >> (7 - (b & 7))) & 1);
    words.push(RECOVERY_WORDS[n]!);
  }
  return words;
}

export function newRecoveryPhrase(): Promise<string[]> {
  return phraseOf(crypto.getRandomValues(new Uint8Array(ENTROPY_BYTES)));
}

export type ReadPhrase = { ok: true; entropy: Uint8Array<ArrayBuffer> } | { ok: false; why: string; word?: number };

export async function readRecoveryPhrase(text: string): Promise<ReadPhrase> {
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (words.length !== PHRASE_WORDS) return { ok: false, why: `a recovery key is ${PHRASE_WORDS} words, and that's ${words.length}` };
  const bytes = new Uint8Array(ENTROPY_BYTES + 1);
  for (const [w, word] of words.entries()) {
    const n = wordIndex(word);
    if (n === undefined) return { ok: false, why: `word ${w + 1} isn't one of the recovery words`, word: w };
    for (let b = 0; b < 11; b++) if ((n >> (10 - b)) & 1) bytes[(w * 11 + b) >> 3]! |= 1 << (7 - ((w * 11 + b) & 7));
  }
  const entropy = bytes.slice(0, ENTROPY_BYTES);
  if ((await checksum(entropy)) !== bytes[ENTROPY_BYTES]) return { ok: false, why: "those words don't add up: one is wrong or out of place" };
  return { ok: true, entropy };
}

async function seeded(entropy: Uint8Array<ArrayBuffer>, info: string, alg: keyof typeof PKCS8_PREFIX): Promise<{ pk: string; sk: string }> {
  const hk = await crypto.subtle.importKey("raw", entropy, "HKDF", false, ["deriveBits"]);
  const seed = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode("kiwi-recovery"), info: enc.encode(info) }, hk, 256));
  const prefix = Uint8Array.from(PKCS8_PREFIX[alg].match(/../g)!.map((h) => parseInt(h, 16)));
  const der = new Uint8Array([...prefix, ...seed]);
  const key = await crypto.subtle.importKey("pkcs8", der, { name: alg }, true, alg === "Ed25519" ? ["sign"] : ["deriveBits"]);
  const { x } = (await crypto.subtle.exportKey("jwk", key)) as { x?: string };
  if (!x) throw new Error("a recovery key without a public half");
  return { pk: x, sk: b64url(der) };
}

export async function recoveryKey(entropy: Uint8Array<ArrayBuffer>): Promise<Identity> {
  const s = await seeded(entropy, "kiwi-recovery/sign", "Ed25519");
  const x = await seeded(entropy, "kiwi-recovery/box", "X25519");
  return { name: "recovery", pk: s.pk, sk: s.sk, xpk: x.pk, xsk: x.sk };
}

export interface RecoveryLink {
  kind: "kiwi-recovery";
  v: 1;
  person: string;
  n: number;
  prev: string | null;
  at: number;
  rpk: string;
  rxpk: string;
  after: number | null;
  pk: string;
  sig: string;
}

interface Pending {
  rpk: string;
  rxpk: string;
  after: number;
  by: string;
}

export interface Recovery {
  person: string;
  n: number;
  head: string;
  rpk: string;
  rxpk: string;
  pending: Pending | null;
}

export type ReadRecovery = { ok: true; recovery: Recovery } | { ok: false; why: string };

const LINK_FIELDS = "after,at,kind,n,person,pk,prev,rpk,rxpk,sig,v";

async function digest(link: object): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(canonical(link)))));
}

export const recoveryAfter = (at: number): number => at + RECOVERY_DELAY_DAYS * DAY_MS;

export function recoveryLink(signer: Identity, person: string, prior: Recovery | null, key: { pk: string; xpk: string }, at = Date.now()): Promise<RecoveryLink> {
  if (!key.xpk) throw new Error("a recovery key needs its exchange half");
  const now = prior ? prior.rpk === signer.pk : signer.pk === person;
  return sign(signer, {
    kind: "kiwi-recovery" as const,
    v: 1 as const,
    person,
    n: (prior?.n ?? 0) + 1,
    prev: prior?.head ?? null,
    at,
    rpk: key.pk,
    rxpk: key.xpk,
    after: now ? null : recoveryAfter(at),
  });
}

function shapeOf(x: Record<string, unknown>): string | null {
  if (x["kind"] !== "kiwi-recovery" || x["v"] !== 1) return "not a recovery link";
  if (Object.keys(x).sort().join(",") !== LINK_FIELDS) return "a recovery link with fields it shouldn't have";
  for (const k of ["person", "rpk", "rxpk", "pk"]) if (typeof x[k] !== "string" || !KEY_RE.test(x[k])) return "a recovery link with a bad key";
  if (!Number.isSafeInteger(x["n"]) || !Number.isSafeInteger(x["at"])) return "a recovery link with a bad number";
  if (x["prev"] !== null && typeof x["prev"] !== "string") return "a recovery link with a bad chain";
  if (x["after"] !== null && !Number.isSafeInteger(x["after"])) return "a recovery link with a bad delay";
  return null;
}

function approver(list: DeviceList, pk: string): boolean {
  return list.devices.some((d) => d.device === pk && d.approve && d.as !== "computer");
}

export async function readRecovery(links: readonly unknown[], list: DeviceList, now = Date.now()): Promise<ReadRecovery> {
  if (!links.length) return { ok: false, why: "no recovery key set up" };
  if (links.length > RECOVERY_MAX) return { ok: false, why: "a recovery chain longer than any person needs" };
  let r: Recovery | null = null;
  let last = 0;
  for (const raw of links) {
    if (!raw || typeof raw !== "object") return { ok: false, why: "not a recovery link" };
    const bad = shapeOf(raw as Record<string, unknown>);
    if (bad) return { ok: false, why: bad };
    const link = raw as RecoveryLink;
    if (!(await verify(link))) return { ok: false, why: `recovery link ${link.n} isn't signed by the key it names` };
    if (link.person !== list.person) return { ok: false, why: `recovery link ${link.n} is for another person` };
    if (link.n !== (r?.n ?? 0) + 1 || link.prev !== (r?.head ?? null)) return { ok: false, why: `recovery link ${link.n} doesn't follow link ${r?.n ?? 0}` };
    if (link.at < last) return { ok: false, why: `recovery link ${link.n} is dated before the one it follows` };
    last = link.at;
    const head = await digest(link);
    if (!r) {
      if (link.pk !== link.person || link.after !== null) return { ok: false, why: "the person key sets up the first recovery key" };
      r = { person: link.person, n: 1, head, rpk: link.rpk, rxpk: link.rxpk, pending: null };
      continue;
    }
    if (r.pending && link.at >= r.pending.after) r = { ...r, rpk: r.pending.rpk, rxpk: r.pending.rxpk, pending: null };
    if (link.after === null) {
      const before = link.pk === link.person && link.at < PERSON_WORDS_WAIT_FROM;
      if (link.pk !== r.rpk && !before) return { ok: false, why: `recovery link ${link.n}: only the recovery key replaces it at once; new words from the person key wait ${RECOVERY_DELAY_DAYS} days` };
      r = { ...r, n: link.n, head, rpk: link.rpk, rxpk: link.rxpk, pending: null };
      continue;
    }
    if (link.after !== recoveryAfter(link.at)) return { ok: false, why: `recovery link ${link.n}: a new recovery key waits ${RECOVERY_DELAY_DAYS} days` };
    const cut = list.revokes.find((x) => x.device === link.pk);
    if (link.pk !== link.person && (cut ? !cut.approve || cut.as === "computer" : !approver(list, link.pk)))
      return { ok: false, why: `recovery link ${link.n}: signed by a key that may not propose a recovery key` };
    const voided = !!cut && cut.at < link.after;
    r = { ...r, n: link.n, head, pending: voided ? r.pending : { rpk: link.rpk, rxpk: link.rxpk, after: link.after, by: link.pk } };
  }
  if (r!.pending && now >= r!.pending.after) r = { ...r!, rpk: r!.pending.rpk, rxpk: r!.pending.rxpk, pending: null };
  return { ok: true, recovery: r! };
}

export const newerRecovery = (known: Recovery | undefined, read: Recovery): Recovery => (known && known.n > read.n ? known : read);

interface VaultChannel {
  label: string;
  code: string;
  owner: Identity;
}

export interface VaultContents {
  person: Identity;
  channels: VaultChannel[];
}

export interface SealedPerson {
  rxpk: string;
  box: string;
}

export interface Vault {
  kind: "kiwi-vault";
  v: 1;
  person: string;
  version: number;
  at: number;
  box: string;
  pk: string;
  sig: string;
}

const VAULT_FIELDS = "at,box,kind,person,pk,sig,v,version";
const vaultInfo = (v: { person: string; version: number; at: number }) => `kiwi-vault\n${v.person}\n${v.version}\n${v.at}`;
const personInfo = (person: string, rxpk: string) => `kiwi-vault-person\n${person}\n${rxpk}`;

export async function sealPerson(recovery: Recovery, person: Identity): Promise<SealedPerson> {
  if (person.pk !== recovery.person) throw new Error("that person key isn't the one this recovery key is for");
  return { rxpk: recovery.rxpk, box: await sealTo(recovery.rxpk, JSON.stringify(person), personInfo(person.pk, recovery.rxpk)) };
}

export async function sealVault(signer: Identity, recovery: Recovery, version: number, contents: { person: Identity | SealedPerson; channels: VaultChannel[] }, at = Date.now()): Promise<Vault> {
  const held = contents.person;
  if ("box" in held && held.rxpk !== recovery.rxpk) throw new Error("the person key is sealed to an earlier recovery key");
  const head = { person: recovery.person, version, at };
  const inner = { person: "box" in held ? held.box : held, channels: contents.channels };
  return sign(signer, { kind: "kiwi-vault" as const, v: 1 as const, ...head, box: await sealTo(recovery.rxpk, JSON.stringify(inner), vaultInfo(head)) });
}

export async function checkVault(raw: unknown, list: DeviceList, known = 0): Promise<string | null> {
  if (!raw || typeof raw !== "object") return "not a vault";
  const x = raw as Record<string, unknown>;
  if (x["kind"] !== "kiwi-vault" || x["v"] !== 1 || Object.keys(x).sort().join(",") !== VAULT_FIELDS) return "not a vault";
  if (typeof x["person"] !== "string" || typeof x["pk"] !== "string" || !KEY_RE.test(x["pk"])) return "a vault with a bad key";
  if (!Number.isSafeInteger(x["version"]) || (x["version"] as number) < 1 || !Number.isSafeInteger(x["at"])) return "a vault with a bad version";
  if (typeof x["box"] !== "string" || x["box"].length > VAULT_BOX_MAX) return "a vault too large";
  if (!(await verify(x))) return "a vault that isn't signed by the key it names";
  if (x["person"] !== list.person) return "a vault for another person";
  if (x["pk"] !== list.person && !approver(list, x["pk"])) return "a vault signed by a key that isn't one of this person's approving devices";
  if ((x["version"] as number) < known) return `vault version ${x["version"] as number} is older than version ${known}, already seen`;
  return null;
}

const isKey = (k: unknown): k is Identity =>
  !!k && typeof k === "object" && typeof (k as Identity).pk === "string" && typeof (k as Identity).sk === "string" && typeof (k as Identity).name === "string";

function contentsOf(x: unknown, person: string): VaultContents | null {
  if (!x || typeof x !== "object") return null;
  const c = x as Partial<VaultContents>;
  if (!isKey(c.person) || c.person.pk !== person || !Array.isArray(c.channels)) return null;
  for (const ch of c.channels as unknown[]) {
    const v = ch as Partial<VaultChannel> | null;
    if (!v || typeof v.label !== "string" || typeof v.code !== "string" || !isKey(v.owner)) return null;
  }
  return c as VaultContents;
}

async function opened(xsk: string, box: string, info: string): Promise<unknown> {
  const text = await openFrom(xsk, box, info);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A box that opens but holds no JSON was sealed wrong; there's nothing in it to restore.
    return null;
  }
}

export async function openVault(vault: Vault, key: Identity): Promise<VaultContents | null> {
  if (!key.xsk) return null;
  const inner = await opened(key.xsk, vault.box, vaultInfo(vault));
  if (!inner || typeof inner !== "object") return null;
  const held = (inner as { person?: unknown }).person;
  const person = typeof held === "string" ? await opened(key.xsk, held, personInfo(vault.person, key.xpk ?? "")) : held;
  return contentsOf({ ...inner, person }, vault.person);
}
