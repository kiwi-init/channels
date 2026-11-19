// Agent identities: an Ed25519 key pair per agent name. Every message an
// agent sends is signed, and the first key to speak for a name in a channel
// owns that name there. Runs in Bun and in the browser (WebCrypto only).

import { b64url, freshKeyPair, fromB64url } from "./crypto.ts";

export interface Identity {
  name: string;
  /** Raw Ed25519 public key, base64url. Signs everything this agent sends. */
  pk: string;
  /** PKCS#8 Ed25519 private key, base64url. */
  sk: string;
  /** X25519 key pair: channel keys are wrapped to `xpk` when this agent is approved. */
  xpk?: string;
  xsk?: string;
}

const ALG = { name: "Ed25519" } as const;
const signingKeys = new Map<string, Promise<CryptoKey>>();

export async function generateIdentity(name: string): Promise<Identity> {
  const pair = await freshKeyPair(ALG, ["sign", "verify"]);
  return withExchangeKey({
    name,
    pk: b64url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
    sk: b64url(new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer)),
  });
}

/** Add an X25519 key pair to an identity that predates membership channels. */
export async function withExchangeKey(id: Identity): Promise<Identity> {
  if (id.xpk && id.xsk) return id;
  const x = await freshKeyPair({ name: "X25519" }, ["deriveBits"]);
  return {
    ...id,
    xpk: b64url(new Uint8Array((await crypto.subtle.exportKey("raw", x.publicKey)) as ArrayBuffer)),
    xsk: b64url(new Uint8Array((await crypto.subtle.exportKey("pkcs8", x.privateKey)) as ArrayBuffer)),
  };
}

/** Sign raw text (for request authentication). */
export async function signText(id: Identity, text: string): Promise<string> {
  let key = signingKeys.get(id.sk);
  if (!key) signingKeys.set(id.sk, (key = crypto.subtle.importKey("pkcs8", fromB64url(id.sk), ALG, false, ["sign"])));
  return b64url(new Uint8Array(await crypto.subtle.sign(ALG, await key, new TextEncoder().encode(text))));
}

export async function verifyText(pk: string, sig: string, text: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", fromB64url(pk), ALG, false, ["verify"]);
    return await crypto.subtle.verify(ALG, key, fromB64url(sig), new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

/** JSON with object keys sorted, so signer and verifier hash the same bytes. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/** Return `obj` with `pk` and `sig` added, signing everything else. */
export async function sign<T extends object>(id: Identity, obj: T): Promise<T & { pk: string; sig: string }> {
  let key = signingKeys.get(id.sk);
  if (!key) signingKeys.set(id.sk, (key = crypto.subtle.importKey("pkcs8", fromB64url(id.sk), ALG, false, ["sign"])));
  const unsigned = { ...obj, pk: id.pk, sig: undefined };
  const sig = await crypto.subtle.sign(ALG, await key, new TextEncoder().encode(canonical(unsigned)));
  return { ...obj, pk: id.pk, sig: b64url(new Uint8Array(sig)) };
}

const verifyKeys = new Map<string, Promise<CryptoKey | null>>();
const MAX_VERIFY_KEYS = 4_096;

export class VerifyCouldNotRun extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause), { cause });
    this.name = "VerifyCouldNotRun";
  }
}

const badInput = (e: unknown): boolean => e instanceof DOMException && e.name === "DataError";

function verifyKey(pk: string, raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey | null> {
  const known = verifyKeys.get(pk);
  if (known) return known;
  const key = crypto.subtle.importKey("raw", raw, ALG, false, ["verify"]).catch((e: unknown) => {
    if (badInput(e)) return null;
    verifyKeys.delete(pk);
    throw new VerifyCouldNotRun(e);
  });
  if (verifyKeys.size >= MAX_VERIFY_KEYS) verifyKeys.delete(verifyKeys.keys().next().value!);
  verifyKeys.set(pk, key);
  return key;
}

/** Whether `obj.sig` is a valid signature by `obj.pk` over the rest of `obj`; throws VerifyCouldNotRun when WebCrypto fails on input it should take. */
export async function signedBy(signed: object): Promise<boolean> {
  const obj = signed as { pk?: unknown; sig?: unknown };
  if (typeof obj.pk !== "string" || typeof obj.sig !== "string") return false;
  let raw: Uint8Array<ArrayBuffer>;
  let sig: Uint8Array<ArrayBuffer>;
  try {
    raw = fromB64url(obj.pk);
    sig = fromB64url(obj.sig);
  } catch {
    // A pk or sig that isn't base64url names no key or signature, so it can't verify.
    return false;
  }
  const k = await verifyKey(obj.pk, raw);
  if (!k) return false;
  try {
    return await crypto.subtle.verify(ALG, k, sig, new TextEncoder().encode(canonical({ ...obj, sig: undefined })));
  } catch (e) {
    if (badInput(e)) return false;
    throw new VerifyCouldNotRun(e);
  }
}

/** Whether `obj.sig` is a valid signature by `obj.pk` over the rest of `obj`. */
export async function verify(signed: object): Promise<boolean> {
  try {
    return await signedBy(signed);
  } catch {
    // Callers that only need a yes read a check that couldn't run as unverified.
    return false;
  }
}

/** Short, human-checkable fingerprint of a public key. */
export function fingerprint(pk: string): string {
  return pk.slice(0, 8);
}
