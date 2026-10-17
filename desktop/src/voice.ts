import type { VoiceAuth, VoiceView } from "./bridge.ts";

export const VOICE_MINT_URL = "https://api.x.ai/v1/realtime/client_secrets";
export const VOICE_ORIGINS = ["https://api.x.ai", "wss://api.x.ai"] as const;

export interface VoiceStore {
  key?: string;
  consent?: Record<string, boolean>;
}

export interface VoiceResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type VoiceHttp = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<VoiceResponse>;

export function hasVoiceKey(voice: VoiceStore | undefined): boolean {
  return typeof voice?.key === "string" && voice.key.length > 0;
}

export function voiceOriginsFor(voice: VoiceStore | undefined): readonly string[] {
  return hasVoiceKey(voice) ? VOICE_ORIGINS : [];
}

export function voiceViewOf(voice: VoiceStore | undefined): VoiceView {
  const consent: Record<string, boolean> = {};
  if (voice?.consent) {
    for (const [id, on] of Object.entries(voice.consent)) {
      if (on === true && id) consent[id] = true;
    }
  }
  return { configured: hasVoiceKey(voice), consent };
}

function expiresAtMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

export async function mintVoiceToken(key: string, http: VoiceHttp): Promise<VoiceAuth> {
  const res = await http(VOICE_MINT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds: 600 } }),
  });
  if (!res.ok) throw new Error(`voice token mint failed (${res.status})`);
  const body: unknown = await res.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("voice token mint came back without a token");
  const rec = body as { value?: unknown; expires_at?: unknown };
  if (typeof rec.value !== "string" || !rec.value) throw new Error("voice token mint came back without a token");
  const expiresAt = expiresAtMs(rec.expires_at);
  if (expiresAt === null) throw new Error("voice token mint came back without an expiry");
  return { token: rec.value, expiresAt };
}

export async function voiceToken(args: { key: string | undefined; consent: Record<string, boolean> | undefined; roomId: string; http: VoiceHttp }): Promise<VoiceAuth> {
  if (typeof args.roomId !== "string" || !args.roomId) throw new Error("no consent");
  if (typeof args.key !== "string" || !args.key) throw new Error("no voice key");
  if (args.consent?.[args.roomId] !== true) throw new Error("no consent");
  return mintVoiceToken(args.key, args.http);
}
