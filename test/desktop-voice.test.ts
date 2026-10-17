import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { csp, mediaAllowed, snapshotOf } from "../desktop/src/guard.ts";
import { mintVoiceToken, VOICE_MINT_URL, VOICE_ORIGINS, voiceOriginsFor, voiceToken, voiceViewOf, type VoiceHttp } from "../desktop/src/voice.ts";

const PROJECT_KEY = "xai-project-secret-never-leave-main";

function httpOk(value: string, expires_at: number): VoiceHttp {
  return async (url, init) => {
    expect(url).toBe(VOICE_MINT_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(`Bearer ${PROJECT_KEY}`);
    expect(init.headers["content-type"]).toBe("application/json");
    return { ok: true, status: 200, json: async () => ({ value, expires_at }) };
  };
}

describe("desktop voice (T11)", () => {
  test("the Mac entitlement allows the microphone and not the camera", () => {
    const plist = readFileSync(join(import.meta.dir, "../desktop/build/entitlements.mac.plist"), "utf8");
    expect(plist).toContain("com.apple.security.device.audio-input");
    expect(plist).not.toContain("com.apple.security.device.camera");
  });

  test("CSP names api.x.ai only when a voice key exists", () => {
    const off = csp("https://r.example");
    expect(off).not.toContain("api.x.ai");
    expect(off).not.toContain("worker-src");
    const on = csp("https://r.example", VOICE_ORIGINS);
    const connect = /connect-src ([^;]+)/.exec(on)?.[1]?.split(" ");
    expect(connect).toEqual(["'self'", "https://r.example", "wss://r.example", "https://api.x.ai", "wss://api.x.ai"]);
    expect(on).toContain("worker-src 'self' blob:");
    expect(voiceOriginsFor({ key: PROJECT_KEY })).toEqual([...VOICE_ORIGINS]);
    expect(voiceOriginsFor(undefined)).toEqual([]);
    expect(voiceOriginsFor({ key: "" })).toEqual([]);
  });

  test("the snapshot has configured and consent, never the project key", () => {
    expect(voiceViewOf(undefined)).toEqual({ configured: false, consent: {} });
    expect(voiceViewOf({ consent: { r1: false } })).toEqual({ configured: false, consent: {} });
    const snap = snapshotOf({
      relayUrl: "https://r.example",
      person: null,
      channels: [],
      computers: [],
      pending: [],
      voice: { key: PROJECT_KEY, consent: { r1: true, r2: false } },
    });
    expect(snap.voice).toEqual({ configured: true, consent: { r1: true } });
    const json = JSON.stringify(snap);
    expect(json).not.toContain(PROJECT_KEY);
    expect(json).not.toContain('"key"');
    expect(snapshotOf({ relayUrl: "https://r.example", person: null, channels: [], computers: [], pending: [] }).voice).toEqual({
      configured: false,
      consent: {},
    });
  });

  test("media is allowed only from kiwi-app://", () => {
    expect(mediaAllowed("kiwi-app://app/index.html", "media")).toBe(true);
    expect(mediaAllowed("kiwi-app://app/", "notifications")).toBe(false);
    expect(mediaAllowed("https://api.x.ai/", "media")).toBe(false);
    expect(mediaAllowed("https://evil.example/", "media")).toBe(false);
  });

  test("mint maps value and expires_at and never returns the project key", async () => {
    const auth = await mintVoiceToken(PROJECT_KEY, httpOk("live-token-not-ek-prefixed", 1_750_000_000));
    expect(auth).toEqual({ token: "live-token-not-ek-prefixed", expiresAt: 1_750_000_000_000 });
    expect(JSON.stringify(auth)).not.toContain(PROJECT_KEY);
    const ms = await mintVoiceToken(PROJECT_KEY, httpOk("tok", 1_750_000_000_000));
    expect(ms.expiresAt).toBe(1_750_000_000_000);
  });

  test("voice.token refuses without a key or consent, and does not call the vendor", async () => {
    let called = 0;
    const http: VoiceHttp = async () => {
      called++;
      return { ok: true, status: 200, json: async () => ({ value: "tok", expires_at: 1 }) };
    };
    await expect(voiceToken({ key: undefined, consent: { r1: true }, roomId: "r1", http })).rejects.toThrow("no voice key");
    await expect(voiceToken({ key: PROJECT_KEY, consent: {}, roomId: "r1", http })).rejects.toThrow("no consent");
    await expect(voiceToken({ key: PROJECT_KEY, consent: { r1: false }, roomId: "r1", http })).rejects.toThrow("no consent");
    await expect(voiceToken({ key: PROJECT_KEY, consent: { r1: true }, roomId: "", http })).rejects.toThrow("no consent");
    expect(called).toBe(0);
    const auth = await voiceToken({ key: PROJECT_KEY, consent: { r1: true }, roomId: "r1", http: httpOk("ephemeral", 99) });
    expect(auth.token).toBe("ephemeral");
    expect(JSON.stringify(auth)).not.toContain(PROJECT_KEY);
  });

  test("a failed mint does not put the project key in the error", async () => {
    const http: VoiceHttp = async () => ({ ok: false, status: 401, json: async () => ({ error: PROJECT_KEY }) });
    const err = await mintVoiceToken(PROJECT_KEY, http).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("voice token mint failed (401)");
    expect((err as Error).message).not.toContain(PROJECT_KEY);
  });
});
