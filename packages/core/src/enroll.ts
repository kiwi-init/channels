import { b64url } from "./crypto.ts";
import type { Identity } from "./identity.ts";

export const ENROLL_TTL_MS = 10 * 60_000;

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const LABEL_MAX = 64;
const OS_MAX = 32;
const KINDS = ["desktop", "phone", "computer"] as const;
type EnrollKind = (typeof KINDS)[number];

export interface EnrollAsk {
  device: string;
  dxpk: string;
  label: string;
  os: string;
  as: EnrollKind;
  at: number;
  commit: string;
}

export interface EnrollAnswer {
  device: string;
  dxpk: string;
  nonce: string;
}

export const accountScope = (user: string): string => `account:${user}`;

const sha = async (text: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

export const enrollNonce = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));

const isEnrollNonce = (x: unknown): x is string => typeof x === "string" && KEY_RE.test(x);

async function enrollCommit(nonce: string, device: string, dxpk: string): Promise<string> {
  return b64url(await sha(`kiwi-enroll-commit\n${nonce}\n${device}\n${dxpk}`));
}

export async function askToEnroll(device: Identity, info: { label: string; os: string; as: EnrollKind }, at = Date.now()): Promise<{ ask: EnrollAsk; nonce: string }> {
  if (!device.xpk) throw new Error("a device enrolls with its exchange key");
  const nonce = enrollNonce();
  const ask: EnrollAsk = {
    device: device.pk,
    dxpk: device.xpk,
    label: info.label.slice(0, LABEL_MAX),
    os: info.os.slice(0, OS_MAX),
    as: info.as,
    at,
    commit: await enrollCommit(nonce, device.pk, device.xpk),
  };
  return { ask, nonce };
}

export function readEnrollAsk(x: unknown): EnrollAsk | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const a = x as Record<string, unknown>;
  if (Object.keys(a).sort().join(",") !== "as,at,commit,device,dxpk,label,os") return null;
  if (typeof a.device !== "string" || !KEY_RE.test(a.device) || typeof a.dxpk !== "string" || !KEY_RE.test(a.dxpk) || typeof a.commit !== "string" || !KEY_RE.test(a.commit)) return null;
  if (typeof a.label !== "string" || a.label.length > LABEL_MAX || typeof a.os !== "string" || a.os.length > OS_MAX) return null;
  if (!KINDS.includes(a.as as EnrollKind) || !Number.isSafeInteger(a.at)) return null;
  return { device: a.device, dxpk: a.dxpk, label: a.label, os: a.os, as: a.as as EnrollKind, at: a.at as number, commit: a.commit };
}

export function readEnrollAnswer(x: unknown): EnrollAnswer | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const a = x as Record<string, unknown>;
  if (Object.keys(a).sort().join(",") !== "device,dxpk,nonce") return null;
  if (typeof a.device !== "string" || !KEY_RE.test(a.device) || typeof a.dxpk !== "string" || !KEY_RE.test(a.dxpk) || !isEnrollNonce(a.nonce)) return null;
  return { device: a.device, dxpk: a.dxpk, nonce: a.nonce };
}

export async function revealMatches(ask: EnrollAsk, nonce: string): Promise<boolean> {
  return isEnrollNonce(nonce) && (await enrollCommit(nonce, ask.device, ask.dxpk)) === ask.commit;
}

export async function enrollDigits(ask: EnrollAsk, answer: EnrollAnswer, revealed: string): Promise<string> {
  const h = await sha(`kiwi-enroll-digits\n${answer.nonce}\n${revealed}\n${ask.device}\n${ask.dxpk}\n${answer.device}\n${answer.dxpk}`);
  const n = ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}
