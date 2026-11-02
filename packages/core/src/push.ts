export const MAX_WAKE = 32;

export const PUSH_PATH = "/push";

export type PushPlatform = "apns" | "fcm";

export interface PushRegistration {
  platform: PushPlatform;
  token: string;
  tag: string;
  sandbox?: boolean;
}

export interface PushWake {
  tag: string;
  seq: number;
}

const PK = /^[A-Za-z0-9_-]{43}$/;
const TAG = /^[A-Za-z0-9_-]{8,64}$/;
const APNS_TOKEN = /^[0-9a-f]{64,200}$/;
const FCM_TOKEN = /^[A-Za-z0-9_:-]{20,4096}$/;

export const wellFormedWake = (x: unknown): x is string[] => Array.isArray(x) && x.length <= MAX_WAKE && x.every((pk) => typeof pk === "string" && PK.test(pk));

export function wellFormedPush(x: unknown): x is PushRegistration {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  if (typeof r.token !== "string" || typeof r.tag !== "string" || !TAG.test(r.tag)) return false;
  if (r.sandbox !== undefined && typeof r.sandbox !== "boolean") return false;
  if (r.platform === "apns") return APNS_TOKEN.test(r.token);
  if (r.platform === "fcm") return FCM_TOKEN.test(r.token);
  return false;
}
