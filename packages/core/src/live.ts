import { open, seal } from "./crypto.ts";

export const LIVE_PATH = "/live";
export const LIVE_TOKEN_PATH = "/live-token";
export const MAX_LIVE_BLOBS = 6;
const MAX_LIVE_CT = 480;
const MAX_LIVE_PLAIN = 340;

export interface LiveBlob {
  iv: string;
  ct: string;
}

export interface LiveTokens {
  start?: string;
  update?: string;
  sandbox?: boolean;
}

export interface LiveState {
  v: 1;
  n: string;
  f: string;
  c?: string;
  t?: string;
  s: number;
  h: string;
}

export const LIVE_LIMITS = { n: 32, f: 16, c: 16, t: 64, h: 40 } as const;

const IV = /^[A-Za-z0-9_-]{16}$/;
const CT = new RegExp(`^[A-Za-z0-9_-]{22,${MAX_LIVE_CT}}$`);
const TOKEN = /^[0-9a-f]{64,400}$/;

export function wellFormedLiveBlob(x: unknown): x is LiveBlob {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return Object.keys(r).length === 2 && typeof r.iv === "string" && IV.test(r.iv) && typeof r.ct === "string" && CT.test(r.ct);
}

export function wellFormedLiveTokens(x: unknown): x is LiveTokens {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  if (Object.keys(r).some((k) => k !== "start" && k !== "update" && k !== "sandbox")) return false;
  if (r.start === undefined && r.update === undefined) return false;
  for (const t of [r.start, r.update]) if (t !== undefined && (typeof t !== "string" || !TOKEN.test(t))) return false;
  return r.sandbox === undefined || typeof r.sandbox === "boolean";
}

const cut = (s: string, max: number): string => {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : s;
};

const bytes = (s: LiveState): number => new TextEncoder().encode(JSON.stringify(s)).byteLength;

function fitted(s: LiveState): LiveState {
  for (const k of ["t", "h", "n"] as const) {
    while (bytes(s) > MAX_LIVE_PLAIN) {
      const len = Array.from(s[k] ?? "").length;
      if (len <= 2) break;
      s[k] = cut(s[k]!, len - 1);
    }
  }
  return s;
}

export function liveState(x: { name: string; face: string; color?: string | null; task?: string | null; since: number; title: string }): LiveState {
  return fitted({
    v: 1,
    n: cut(x.name, LIVE_LIMITS.n),
    f: cut(x.face, LIVE_LIMITS.f),
    ...(x.color ? { c: cut(x.color, LIVE_LIMITS.c) } : {}),
    ...(x.task ? { t: cut(x.task, LIVE_LIMITS.t) } : {}),
    s: Math.floor(x.since),
    h: cut(x.title, LIVE_LIMITS.h),
  });
}

export const sealLive = (key: string, roomId: string, state: LiveState): Promise<LiveBlob> => seal(key, roomId, state);

export async function openLive(key: string, roomId: string, blob: LiveBlob): Promise<LiveState | null> {
  const x = await open(key, roomId, blob.iv, blob.ct);
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  return r.v === 1 && typeof r.n === "string" && typeof r.f === "string" && typeof r.s === "number" && typeof r.h === "string" ? (r as unknown as LiveState) : null;
}
