import { b64url, openFrom, sealTo } from "./crypto.ts";
import { canonical, sign, verify, type Identity } from "./identity.ts";
import type { DeviceList } from "./devices.ts";
import { recoveryWords } from "./recovery-words.ts";

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;
const PHRASE_WORDS = 24;
const ENTROPY_BYTES = 32;
const RECOVERY_DELAY_DAYS = 7;
const RECOVERY_MAX = 256;
const VAULT_BOX_MAX = 512 * 1024;
const VAULT_SECTIONS_MAX = 64;
const enc = new TextEncoder();

const PKCS8_PREFIX = { Ed25519: "302e020100300506032b657004220420", X25519: "302e020100300506032b656e04220420" } as const;

let index: Map<string, number> | null = null;
let byPrefix: Map<string, number> | null = null;

function wordIndex(word: string): number | undefined {
  if (!index || !byPrefix) {
    index = new Map(recoveryWords().map((w, i) => [w, i]));
    byPrefix = new Map(recoveryWords().map((w, i) => [w.slice(0, 4), i]));
  }
  const exact = index.get(word);
  if (exact !== undefined || word.length < 4) return exact;
  const i = byPrefix.get(word.slice(0, 4));
  return i !== undefined && recoveryWords()[i]!.startsWith(word) ? i : undefined;
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
    words.push(recoveryWords()[n]!);
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
  root: string;
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
  const now = signer.pk === (prior?.root ?? person) || (!!prior && prior.rpk === signer.pk);
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
    const pinned = list.reroots.find((x) => x.n === link.n);
    if (pinned && pinned.head !== head) return { ok: false, why: `recovery link ${link.n} isn't the one the re-root at link ${pinned.seq} was signed against` };
    const after = list.reroots.findLast((x) => x.n < link.n);
    if (after && link.at < after.at) return { ok: false, why: `recovery link ${link.n} is dated before the re-root it follows` };
    const root = after?.root ?? list.person;
    if (!r) {
      if (link.pk !== root || link.after !== null) return { ok: false, why: "the person key sets up the first recovery key" };
      r = { person: link.person, root: list.root, n: 1, head, rpk: link.rpk, rxpk: link.rxpk, pending: null };
      continue;
    }
    if (r.pending && link.at >= r.pending.after) r = { ...r, rpk: r.pending.rpk, rxpk: r.pending.rxpk, pending: null };
    if (link.after === null) {
      if (link.pk !== root && link.pk !== r.rpk) return { ok: false, why: `recovery link ${link.n}: only the person key or the recovery key replaces it at once` };
      r = { ...r, n: link.n, head, rpk: link.rpk, rxpk: link.rxpk, pending: null };
      continue;
    }
    if (link.after !== recoveryAfter(link.at)) return { ok: false, why: `recovery link ${link.n}: a new recovery key waits ${RECOVERY_DELAY_DAYS} days` };
    const cut = list.revokes.find((x) => x.device === link.pk);
    if (cut ? !cut.approve || cut.as === "computer" : !approver(list, link.pk)) return { ok: false, why: `recovery link ${link.n}: signed by a key that may not propose a recovery key` };
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
  pk: string;
  box: string;
}

export interface VaultSection {
  device: string;
  rxpk: string;
  box: string;
}

export interface Vault {
  kind: "kiwi-vault";
  v: 1;
  person: string;
  version: number;
  at: number;
  held: SealedPerson;
  boxes: VaultSection[];
  pk: string;
  sig: string;
}

const VAULT_FIELDS = "at,boxes,held,kind,person,pk,sig,v,version";
const HELD_FIELDS = "box,pk,rxpk";
const SECTION_FIELDS = "box,device,rxpk";
const personInfo = (person: string, pk: string, rxpk: string) => `kiwi-vault-person\n${person}\n${pk}\n${rxpk}`;
const sectionInfo = (person: string, device: string, rxpk: string) => `kiwi-vault-channels\n${person}\n${device}\n${rxpk}`;

const boxSize = (v: { held: SealedPerson; boxes: readonly VaultSection[] }): number => v.boxes.reduce((n, s) => n + s.box.length, v.held.box.length);

export async function sealPerson(recovery: Recovery, person: Identity): Promise<SealedPerson> {
  if (person.pk !== recovery.root) throw new Error("that person key isn't the one this recovery key is for");
  return { rxpk: recovery.rxpk, pk: person.pk, box: await sealTo(recovery.rxpk, JSON.stringify(person), personInfo(recovery.person, person.pk, recovery.rxpk)) };
}

export async function sealVault(
  signer: Identity,
  recovery: Recovery,
  version: number,
  contents: { person: Identity | SealedPerson; channels: VaultChannel[]; device?: string; others?: readonly VaultSection[] },
  at = Date.now(),
): Promise<Vault> {
  const given = contents.person;
  if ("box" in given && given.rxpk !== recovery.rxpk) throw new Error("the person key is sealed to an earlier recovery key");
  if (given.pk !== recovery.root) throw new Error("that person key was replaced by a re-root");
  const held = "box" in given ? given : await sealPerson(recovery, given);
  const device = contents.device ?? signer.pk;
  const own = { device, rxpk: recovery.rxpk, box: await sealTo(recovery.rxpk, JSON.stringify(contents.channels), sectionInfo(recovery.person, device, recovery.rxpk)) };
  const boxes = [...(contents.others ?? []).filter((s) => s.device !== device && s.rxpk === recovery.rxpk), own];
  if (boxes.length > VAULT_SECTIONS_MAX || boxSize({ held, boxes }) > VAULT_BOX_MAX) throw new Error("the vault would grow past what the relay keeps");
  return sign(signer, { kind: "kiwi-vault" as const, v: 1 as const, person: recovery.person, version, at, held, boxes });
}

const fieldsOf = (x: unknown, fields: string): Record<string, unknown> | null =>
  !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).sort().join(",") === fields ? (x as Record<string, unknown>) : null;

const keyed = (x: Record<string, unknown>, ...keys: string[]): boolean => keys.every((k) => typeof x[k] === "string" && KEY_RE.test(x[k]));

function boxesOk(x: Record<string, unknown>): string | null {
  const held = fieldsOf(x["held"], HELD_FIELDS);
  if (!held || !keyed(held, "pk", "rxpk") || typeof held["box"] !== "string") return "a vault with a bad person box";
  const boxes = x["boxes"];
  if (!Array.isArray(boxes) || boxes.length > VAULT_SECTIONS_MAX) return "a vault with bad channel boxes";
  const devices = new Set<string>();
  let size = held["box"].length;
  for (const b of boxes as unknown[]) {
    const s = fieldsOf(b, SECTION_FIELDS);
    if (!s || !keyed(s, "device", "rxpk") || typeof s["box"] !== "string" || devices.has(s["device"] as string)) return "a vault with bad channel boxes";
    devices.add(s["device"] as string);
    size += s["box"].length;
  }
  return size > VAULT_BOX_MAX ? "a vault too large" : null;
}

export async function checkVault(raw: unknown, list: DeviceList, known = 0): Promise<string | null> {
  if (!raw || typeof raw !== "object") return "not a vault";
  const x = raw as Record<string, unknown>;
  if (x["kind"] !== "kiwi-vault" || x["v"] !== 1 || Object.keys(x).sort().join(",") !== VAULT_FIELDS) return "not a vault";
  if (typeof x["person"] !== "string" || typeof x["pk"] !== "string" || !KEY_RE.test(x["pk"])) return "a vault with a bad key";
  if (!Number.isSafeInteger(x["version"]) || (x["version"] as number) < 1 || !Number.isSafeInteger(x["at"])) return "a vault with a bad version";
  const bad = boxesOk(x);
  if (bad) return bad;
  if (!(await verify(x))) return "a vault that isn't signed by the key it names";
  if (x["person"] !== list.person) return "a vault for another person";
  if (x["pk"] !== list.root && !approver(list, x["pk"])) return "a vault signed by a key that isn't one of this person's approving devices";
  if ((x["version"] as number) < known) return `vault version ${x["version"] as number} is older than version ${known}, already seen`;
  return null;
}

const isKey = (k: unknown): k is Identity =>
  !!k && typeof k === "object" && typeof (k as Identity).pk === "string" && typeof (k as Identity).sk === "string" && typeof (k as Identity).name === "string";

const channelOf = (ch: unknown): ch is VaultChannel => {
  const v = ch as Partial<VaultChannel> | null;
  return !!v && typeof v === "object" && typeof v.label === "string" && typeof v.code === "string" && isKey(v.owner);
};

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

export async function openVault(vault: Vault, key: Identity, root = vault.person): Promise<VaultContents | null> {
  if (!key.xsk || !key.xpk || vault.held.pk !== root || vault.held.rxpk !== key.xpk) return null;
  const person = await opened(key.xsk, vault.held.box, personInfo(vault.person, root, key.xpk));
  if (!isKey(person) || person.pk !== root) return null;
  const owners = new Map<string, VaultChannel>();
  for (const s of vault.boxes) {
    if (s.rxpk !== key.xpk) continue;
    const channels = await opened(key.xsk, s.box, sectionInfo(vault.person, s.device, key.xpk));
    if (!Array.isArray(channels) || !channels.every(channelOf)) continue;
    for (const c of channels) owners.set(c.owner.pk, c);
  }
  return { person, channels: [...owners.values()] };
}
