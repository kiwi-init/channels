import { b64url, fromB64url, openBytes, sealBytes } from "./crypto.ts";
import { newSecret, openMailbox, type Mailbox } from "./mailbox.ts";

export const LINK_PREFIX = "kl1-";
export const LINK_CHUNK_BYTES = 24 * 1024;
const LINK_MAX_CHUNKS = 64;

const enc = new TextEncoder();
const dec = new TextDecoder();
const X25519 = { name: "X25519" } as const;
const B43 = /^[A-Za-z0-9_-]{43}$/;
const FP16 = /^[A-Za-z0-9_-]{16}$/;

export interface LinkCode {
  secret: string;
  dxpk: string;
  personFp: string;
}

export interface LinkKeys {
  xpk: string;
  xsk: string;
}

interface LinkPerson {
  name: string;
  pk: string;
  sk: string;
  xpk: string;
  xsk: string;
}

export interface LinkChannel {
  label: string;
  pk: string;
  sk: string;
  [field: string]: unknown;
}

export interface LinkPayload {
  kind: "kiwi-link-payload";
  v: 1;
  person: LinkPerson;
  channels: LinkChannel[];
  relayUrl: string;
  at: number;
}

export interface LinkAsk {
  kind: "kiwi-link-ask";
  v: 1;
  mailbox: string;
  pxpk: string;
  label: string;
  at: number;
}

export interface LinkChunk {
  kind: "kiwi-link-chunk";
  v: 1;
  i: number;
  n: number;
  iv: string;
  ct: string;
}

export async function personFingerprint(personPk: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`kiwi-link-person\n${personPk}`)))).slice(0, 16);
}

export function linkCode(c: LinkCode): string {
  return `${LINK_PREFIX}${c.secret}.${c.dxpk}.${c.personFp}`;
}

export function readLinkCode(text: string): LinkCode | null {
  const t = text.trim();
  if (!t.startsWith(LINK_PREFIX)) return null;
  const [secret, dxpk, personFp, ...extra] = t.slice(LINK_PREFIX.length).split(".");
  if (extra.length || !secret || !dxpk || !personFp) return null;
  return B43.test(secret) && B43.test(dxpk) && FP16.test(personFp) ? { secret, dxpk, personFp } : null;
}

export const newLinkSecret = newSecret;

export async function newLinkKeys(): Promise<LinkKeys> {
  const pair = (await crypto.subtle.generateKey(X25519, true, ["deriveBits"])) as unknown as CryptoKeyPair;
  return {
    xpk: b64url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
    xsk: b64url(new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer)),
  };
}

export async function linkDigits(secret: string, dxpk: string, pxpk: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`kiwi-link-digits\n${secret}\n${dxpk}\n${pxpk}`)));
  const n = ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

async function chunkSecret(secret: string, i: number): Promise<string> {
  if (!B43.test(secret) || !Number.isInteger(i) || i < 0 || i >= LINK_MAX_CHUNKS) throw new Error("bad link mailbox");
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`kiwi-link-chunk\n${i}\n${secret}`))));
}

async function linkKey(secret: string, mine: string, theirs: string, dxpk: string, pxpk: string): Promise<string> {
  const priv = await crypto.subtle.importKey("pkcs8", fromB64url(mine), X25519, false, ["deriveBits"]);
  const pub = await crypto.subtle.importKey("raw", fromB64url(theirs), X25519, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: pub } as unknown as { name: string }, priv, 256);
  const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: fromB64url(secret), info: enc.encode(`kiwi-link-key\n${dxpk}\n${pxpk}`) }, ikm, 256);
  return b64url(new Uint8Array(bits));
}

const chunkAd = (dxpk: string, pxpk: string, i: number, n: number) => `kiwi-link\n${dxpk}\n${pxpk}\n${i}\n${n}`;

export async function sealLink(secret: string, dxsk: string, dxpk: string, pxpk: string, payload: LinkPayload): Promise<LinkChunk[]> {
  const key = await linkKey(secret, dxsk, pxpk, dxpk, pxpk);
  const bytes = enc.encode(JSON.stringify(payload));
  const n = Math.max(1, Math.ceil(bytes.length / LINK_CHUNK_BYTES));
  if (n > LINK_MAX_CHUNKS) throw new Error("this person has more channels than a link can carry");
  const out: LinkChunk[] = [];
  for (let i = 0; i < n; i++) {
    const piece = new Uint8Array(bytes.slice(i * LINK_CHUNK_BYTES, (i + 1) * LINK_CHUNK_BYTES));
    const box = await sealBytes(key, piece, chunkAd(dxpk, pxpk, i, n));
    out.push({ kind: "kiwi-link-chunk", v: 1, i, n, iv: box.iv, ct: box.ct });
  }
  return out;
}

function wellFormedChunk(x: unknown): x is LinkChunk {
  if (!x || typeof x !== "object") return false;
  const c = x as Partial<LinkChunk>;
  return c.kind === "kiwi-link-chunk" && c.v === 1 && Number.isInteger(c.i) && Number.isInteger(c.n) && (c.n as number) >= 1 && (c.n as number) <= LINK_MAX_CHUNKS && (c.i as number) >= 0 && (c.i as number) < (c.n as number) && typeof c.iv === "string" && typeof c.ct === "string";
}

const str = (x: unknown) => typeof x === "string" && x.length > 0;

function wellFormedPayload(x: unknown): x is LinkPayload {
  if (!x || typeof x !== "object") return false;
  const p = x as Partial<LinkPayload>;
  const person = p.person as Partial<LinkPerson> | undefined;
  return (
    p.kind === "kiwi-link-payload" &&
    p.v === 1 &&
    !!person &&
    str(person.name) &&
    str(person.pk) &&
    str(person.sk) &&
    str(person.xpk) &&
    str(person.xsk) &&
    Array.isArray(p.channels) &&
    p.channels.every((c) => !!c && typeof c === "object" && str((c as LinkChannel).label) && str((c as LinkChannel).pk) && str((c as LinkChannel).sk)) &&
    str(p.relayUrl)
  );
}

export async function openLink(code: LinkCode, pxsk: string, pxpk: string, chunks: readonly unknown[]): Promise<LinkPayload | null> {
  try {
    const ok = chunks.filter(wellFormedChunk);
    if (!ok.length || ok.length !== chunks.length) return null;
    const n = ok[0]!.n;
    if (ok.length !== n || ok.some((c) => c.n !== n)) return null;
    const ordered = [...ok].sort((a, b) => a.i - b.i);
    if (ordered.some((c, i) => c.i !== i)) return null;
    const key = await linkKey(code.secret, pxsk, code.dxpk, code.dxpk, pxpk);
    const pieces: Uint8Array[] = [];
    for (const c of ordered) {
      const piece = await openBytes(key, c.iv, c.ct, chunkAd(code.dxpk, pxpk, c.i, n));
      if (!piece) return null;
      pieces.push(piece);
    }
    const whole = new Uint8Array(pieces.reduce((sum, p) => sum + p.length, 0));
    let at = 0;
    for (const p of pieces) {
      whole.set(p, at);
      at += p.length;
    }
    const payload: unknown = JSON.parse(dec.decode(whole));
    if (!wellFormedPayload(payload)) return null;
    return (await personFingerprint(payload.person.pk)) === code.personFp ? payload : null;
  } catch {
    return null;
  }
}

export async function askToLink(relay: string, code: LinkCode, pxpk: string, label: string, fetchImpl: typeof fetch = fetch): Promise<Mailbox> {
  const box = await openMailbox(relay, await chunkSecret(code.secret, 0), fetchImpl);
  const ask: LinkAsk = { kind: "kiwi-link-ask", v: 1, mailbox: box.id, pxpk, label: label.slice(0, 64), at: Date.now() };
  await box.put("a", ask);
  return box;
}

export function readLinkAsk(x: unknown, mailboxId: string): LinkAsk | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Partial<LinkAsk>;
  if (a.kind !== "kiwi-link-ask" || a.v !== 1 || a.mailbox !== mailboxId || typeof a.pxpk !== "string" || !B43.test(a.pxpk) || typeof a.label !== "string" || a.label.length > 64 || typeof a.at !== "number") return null;
  return { kind: "kiwi-link-ask", v: 1, mailbox: a.mailbox, pxpk: a.pxpk, label: a.label, at: a.at };
}

export async function waitForLinkAsk(relay: string, secret: string, opts: { timeoutMs?: number; everyMs?: number; signal?: AbortSignal } = {}, fetchImpl: typeof fetch = fetch): Promise<{ ask: LinkAsk; mailbox: Mailbox } | null> {
  const box = await openMailbox(relay, await chunkSecret(secret, 0), fetchImpl);
  const got = await box.wait<unknown>("a", opts);
  const ask = got === null ? null : readLinkAsk(got, box.id);
  return ask ? { ask, mailbox: box } : null;
}

export async function writeLinkChunks(relay: string, secret: string, chunks: readonly LinkChunk[], fetchImpl: typeof fetch = fetch): Promise<void> {
  for (const c of chunks) {
    const box = await openMailbox(relay, await chunkSecret(secret, c.i), fetchImpl);
    await box.put("b", c);
  }
}

export async function waitForLinkChunks(relay: string, secret: string, opts: { timeoutMs?: number; everyMs?: number; signal?: AbortSignal } = {}, fetchImpl: typeof fetch = fetch): Promise<LinkChunk[] | null> {
  const first = await (await openMailbox(relay, await chunkSecret(secret, 0), fetchImpl)).wait<unknown>("b", opts);
  if (!wellFormedChunk(first)) return null;
  const rest = await Promise.all(Array.from({ length: first.n - 1 }, async (_, k) => (await openMailbox(relay, await chunkSecret(secret, k + 1), fetchImpl)).wait<unknown>("b", opts)));
  const all = [first, ...rest];
  return all.every(wellFormedChunk) ? all : null;
}

export async function dropLink(relay: string, secret: string, count: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  for (let i = 0; i < Math.min(count, LINK_MAX_CHUNKS); i++) await (await openMailbox(relay, await chunkSecret(secret, i), fetchImpl)).drop();
}
