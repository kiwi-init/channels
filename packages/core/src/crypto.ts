// Encryption for membership channels.
//
// A channel has a random 256-bit key per epoch. Members never derive it from
// anything shared: the owner wraps each epoch key to each member's X25519 key
// when approving them, and wraps a fresh key to everyone left whenever a
// member leaves or is removed. The relay stores only those sealed boxes.

const enc = new TextEncoder();
const dec = new TextDecoder();

/** What a member holds to read and write a channel. */
export interface ChannelAccess {
  roomId: string;
  ownerPk: string;
  ownerXpk: string;
  /** Current key epoch. */
  epoch: number;
  /** Channel key per epoch (base64url), so history stays readable after rotations. */
  keys: Record<string, string>;
  /** The owner signed that every key it wraps carries its signature: accept no other. */
  signedKeys?: boolean;
  /**
   * This client has seen a title the owner signed for this room. Older rooms
   * (created before titles were signed) then refuse an unsigned title, so a
   * relay can't swap the signed one back for a member-sealed `{ name }`.
   */
  signedTitle?: boolean;
  seenTitleAt?: number;
  seenSettingsAt?: number;
  seenIconAt?: number;
}

const SEEN_MARKS = ["seenTitleAt", "seenSettingsAt", "seenIconAt"] as const;
export type SeenMark = (typeof SEEN_MARKS)[number];
export type Seen = Pick<ChannelAccess, SeenMark>;

export function seenAt(at: unknown): number {
  return typeof at === "number" && Number.isSafeInteger(at) && at > 0 ? at : 0;
}

export function keepSeen(held: Seen, fetched: Seen): Seen {
  const out: Seen = {};
  for (const mark of SEEN_MARKS) {
    const at = Math.max(seenAt(held[mark]), seenAt(fetched[mark]));
    if (at) out[mark] = at;
  }
  return out;
}

// Plain implementations (no Buffer) so this module also runs in the browser.
export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesOf(bin: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  return bytesOf(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const aesKeys = new Map<string, Promise<CryptoKey>>();
function aesKey(key: string): Promise<CryptoKey> {
  let k = aesKeys.get(key);
  if (!k) aesKeys.set(key, (k = crypto.subtle.importKey("raw", fromB64url(key), "AES-GCM", false, ["encrypt", "decrypt"])));
  return k;
}

const PACKED = 0x00;
export const PACK_FROM = 512;
export const MAX_UNPACKED = 4 * 1024 * 1024;

function concat(parts: Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return concat(parts, size);
    size += value.byteLength;
    if (size > MAX_UNPACKED) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
}

async function pack(plain: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (plain.byteLength < PACK_FROM || plain.byteLength > MAX_UNPACKED) return plain;
  const packed = await deflate(plain);
  if (packed.byteLength + 1 >= plain.byteLength) return plain;
  return concat([Uint8Array.of(PACKED), packed], packed.byteLength + 1);
}

export async function seal(key: string, roomId: string, payload: object, opts: { pack?: boolean } = {}): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt(
    // Binding the room id stops a relay from replaying ciphertext across channels.
    { name: "AES-GCM", iv, additionalData: enc.encode(roomId) },
    await aesKey(key),
    opts.pack ? await pack(new Uint8Array(plain)) : plain,
  );
  return { iv: b64url(iv), ct: b64url(new Uint8Array(ct)) };
}

/** Decrypt an envelope to its JSON payload, or null if it isn't valid for this channel. */
export async function open(key: string, roomId: string, iv: string, ct: string): Promise<unknown> {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv), additionalData: enc.encode(roomId) }, await aesKey(key), fromB64url(ct));
    const bytes = new Uint8Array(pt);
    if (bytes[0] !== PACKED) return JSON.parse(dec.decode(bytes));
    const plain = await inflate(bytes.subarray(1));
    return plain ? JSON.parse(dec.decode(plain)) : null;
  } catch {
    return null;
  }
}

export async function slotId(key: string, roomId: string, name: string): Promise<string> {
  const hk = await crypto.subtle.importKey("raw", fromB64url(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", hk, enc.encode(`kiwi-slot:${roomId}:${name}`))));
}

// ---------- membership channels (mc2) ----------
//
// An mc2 join code names a room and pins its owner: `mc2-<room>-<owner fp>`.
// It lets an agent *ask* to join; only the owner's approval lets it in.

export interface JoinCode {
  roomId: string;
  /** First 12 bytes of SHA-256(owner public key), base64url. */
  ownerFp: string;
}

export function encodeJoinCode(j: JoinCode): string {
  const room = b64url(Uint8Array.from(j.roomId.match(/../g)!.map((h) => parseInt(h, 16))));
  return `mc2-${room}-${j.ownerFp}`;
}

export function decodeJoinCode(code: string): JoinCode {
  const m = /^mc2-([A-Za-z0-9_-]{22})-([A-Za-z0-9_-]{16})$/.exec(code.trim());
  if (!m) throw new Error("not an mc2 join code");
  return { roomId: hex(fromB64url(m[1]!)), ownerFp: m[2]! };
}

export function newRoomId(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function ownerFingerprint(ownerPk: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", fromB64url(ownerPk)));
  return b64url(d.slice(0, 12));
}

/**
 * The 6-digit code a joining agent and the approving human both see. It's
 * derived from the room and the joiner's key, so the relay can't swap keys
 * without the codes disagreeing.
 */
export async function verificationCode(roomId: string, pk: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`mc-verify\n${roomId}\n${pk}`)));
  const n = ((d[0]! << 16) | (d[1]! << 8) | d[2]!) % 1_000_000;
  const s = String(n).padStart(6, "0");
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export function newChannelKey(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

const X25519 = { name: "X25519" } as const;

async function wrapKey(shared: ArrayBuffer, info: string): Promise<CryptoKey> {
  const hk = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Encrypt `data` so only the holder of the X25519 secret for `xpk` can read it. */
export async function sealTo(xpk: string, data: string, info = "mc/box"): Promise<string> {
  const eph = (await crypto.subtle.generateKey(X25519, true, ["deriveBits"])) as unknown as CryptoKeyPair;
  const pub = await crypto.subtle.importKey("raw", fromB64url(xpk), X25519, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: pub } as unknown as { name: string }, eph.privateKey, 256);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const epk = new Uint8Array((await crypto.subtle.exportKey("raw", eph.publicKey)) as ArrayBuffer);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: epk }, await wrapKey(shared, info), enc.encode(data));
  return [b64url(epk), b64url(iv), b64url(new Uint8Array(ct))].join(".");
}

/** Open a `sealTo` box with our X25519 secret (PKCS#8, base64url), or null. */
export async function openFrom(xsk: string, box: string, info = "mc/box"): Promise<string | null> {
  try {
    const [epk, iv, ct] = box.split(".");
    const priv = await crypto.subtle.importKey("pkcs8", fromB64url(xsk), X25519, false, ["deriveBits"]);
    const pub = await crypto.subtle.importKey("raw", fromB64url(epk!), X25519, false, []);
    const shared = await crypto.subtle.deriveBits({ name: "X25519", public: pub } as unknown as { name: string }, priv, 256);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv!), additionalData: fromB64url(epk!) }, await wrapKey(shared, info), fromB64url(ct!));
    return dec.decode(pt);
  } catch {
    return null;
  }
}

export async function sealBytes(key: string, data: Uint8Array<ArrayBuffer>, ad: string): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(ad) }, await aesKey(key), data);
  return { iv: b64url(iv), ct: b64url(new Uint8Array(ct)) };
}

export async function openBytes(key: string, iv: string, ct: string, ad: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv), additionalData: enc.encode(ad) }, await aesKey(key), fromB64url(ct)));
  } catch {
    return null;
  }
}

/** Seal/open with a raw channel key (for member records), independent of room-bound AD. */
export async function sealWith(key: string, data: string, ad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(ad) }, await aesKey(key), enc.encode(data));
  return `${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function openWith(key: string, box: string, ad: string): Promise<string | null> {
  try {
    const [iv, ct] = box.split(".");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv!), additionalData: enc.encode(ad) }, await aesKey(key), fromB64url(ct!));
    return dec.decode(pt);
  } catch {
    return null;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  return bytesOf(atob(s));
}

export async function blobId(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

const BLOB_AD = enc.encode("kiwi-image");

export async function sealBlob(raw: Uint8Array<ArrayBuffer>): Promise<{ id: string; key: string; blob: Uint8Array<ArrayBuffer> }> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: BLOB_AD }, k, raw));
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv);
  blob.set(ct, iv.length);
  return { id: await blobId(blob), key: b64url(key), blob };
}

export async function openBlob(ref: { id: string; key: string }, blob: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    if (blob.length < 28 || (await blobId(blob)) !== ref.id) return null;
    const k = await crypto.subtle.importKey("raw", fromB64url(ref.key), "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.subarray(0, 12), additionalData: BLOB_AD }, k, blob.subarray(12)));
  } catch {
    return null;
  }
}
