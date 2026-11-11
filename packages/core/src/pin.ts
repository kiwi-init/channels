import { b64url, fromB64url, ownerFingerprint, type JoinCode } from "./crypto.ts";
import { sign, verify, type Identity } from "./identity.ts";
import { personaOf, type Persona, type Personality } from "./personality.ts";

export interface Pin {
  id: string;
  name: string;
  hash: string;
}

export const MAX_PIN = 800;
const MAX_ID = 64;
const HASH_RE = /^[0-9a-f]{32}$/;

async function personaHash(p: Persona): Promise<string> {
  const canon = JSON.stringify([p.name, p.role, p.capabilities, p.areas, p.instructions]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon)));
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makePin(owner: Identity, room: string, p: Personality): Promise<string> {
  const signed = await sign(owner, { room, pin: { id: p.id, name: p.name, hash: await personaHash(personaOf(p)) } });
  return b64url(new TextEncoder().encode(JSON.stringify(signed)));
}

export interface PinFailed {
  invalid: true;
}

const failed = (): PinFailed => ({ invalid: true });

async function openPin(token: unknown, room: string): Promise<{ pk: string; pin: Pin } | PinFailed | null> {
  if (token === undefined || token === null || token === "") return null;
  if (typeof token !== "string" || token.length > MAX_PIN || !/^[A-Za-z0-9_-]+$/.test(token)) return failed();
  try {
    const o = JSON.parse(new TextDecoder().decode(fromB64url(token))) as { room?: unknown; pk?: unknown; sig?: unknown; pin?: { id?: unknown; name?: unknown; hash?: unknown } };
    if (o.room !== room || typeof o.pk !== "string" || typeof o.sig !== "string" || !(await verify(o as { pk: string; sig: string }))) return failed();
    const { id, name, hash } = o.pin ?? {};
    if (typeof id !== "string" || !id || id.length > MAX_ID || typeof name !== "string" || !name.trim() || typeof hash !== "string" || !HASH_RE.test(hash)) return failed();
    return { pk: o.pk, pin: { id, name: name.trim(), hash } };
  } catch {
    // A token that isn't base64url JSON, or whose key can't check a signature, failed verification.
    return failed();
  }
}

export async function readPin(token: unknown, room: string, ownerPk: string): Promise<Pin | PinFailed | null> {
  const read = await openPin(token, room);
  if (!read || "invalid" in read) return read;
  return read.pk === ownerPk ? read.pin : failed();
}

export async function pinFits(token: string, code: JoinCode): Promise<boolean> {
  const read = await openPin(token, code.roomId);
  return !!read && !("invalid" in read) && (await ownerFingerprint(read.pk)) === code.ownerFp;
}

export async function pinned(pin: Pick<Pin, "id" | "hash">, options: readonly Personality[]): Promise<Persona | null> {
  const o = options.find((x) => x.id === pin.id);
  if (!o) return null;
  const p = personaOf(o);
  return (await personaHash(p)) === pin.hash ? p : null;
}
