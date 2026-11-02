import { b64url } from "@kiwi/core/crypto.ts";
import type { PushPlatform, PushWake } from "@kiwi/core/push.ts";
import { pkcs8Of } from "./github-app.ts";

export interface PushTarget {
  pk: string;
  platform: PushPlatform;
  token: string;
  tag: string;
  sandbox: boolean;
}

export interface Wake extends PushTarget {
  seq: number;
}

export interface Pusher {
  send(wakes: readonly Wake[]): Promise<string[]>;
}

export interface PushConfig {
  apnsKey?: string | null;
  apnsKeyId?: string | null;
  apnsTeamId?: string | null;
  apnsTopic?: string | null;
  fcmServiceAccount?: string | null;
  fetch?: typeof fetch;
  now?: () => number;
}

export const APNS_HOST = "https://api.push.apple.com";
export const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const APNS_JWT_MS = 40 * 60_000;
const WAKE_TTL_S = 86_400;

const apnsBody = (w: PushWake) => ({ aps: { alert: { title: "Channels", body: "New message" }, "mutable-content": 1, sound: "default" }, k: w.tag, s: w.seq });

const fcmMessage = (token: string, w: PushWake) => ({ message: { token, data: { k: w.tag, s: String(w.seq) }, android: { priority: "HIGH", ttl: `${WAKE_TTL_S}s` } } });

const json64 = (o: object): string => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function signedJwt(alg: "ES256" | "RS256", pem: string, header: object, claims: object): Promise<string> {
  const es = alg === "ES256";
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Of(pem), es ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const unsigned = `${json64({ alg, ...header })}.${json64(claims)}`;
  const sig = await crypto.subtle.sign(es ? { name: "ECDSA", hash: "SHA-256" } : "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

interface ServiceAccount {
  email: string;
  key: string;
  project: string;
  tokenUri: string;
}

function serviceAccount(raw: string | null | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const a = JSON.parse(raw) as Record<string, unknown>;
    if (typeof a.client_email !== "string" || typeof a.private_key !== "string" || typeof a.project_id !== "string") return null;
    return { email: a.client_email, key: a.private_key, project: a.project_id, tokenUri: typeof a.token_uri === "string" ? a.token_uri : GOOGLE_TOKEN_URI };
  } catch {
    // A service account that isn't JSON leaves Android push off, as if it were unset.
    return null;
  }
}

export const pushConfigFrom = (env: Record<string, string | undefined>): PushConfig => ({
  apnsKey: env.APNS_KEY,
  apnsKeyId: env.APNS_KEY_ID,
  apnsTeamId: env.APNS_TEAM_ID,
  apnsTopic: env.APNS_TOPIC,
  fcmServiceAccount: env.FCM_SERVICE_ACCOUNT,
});

export function pusherFrom(c: PushConfig): Pusher | null {
  const get = c.fetch ?? fetch;
  const now = c.now ?? Date.now;
  const apnsKey = c.apnsKey?.includes("PRIVATE KEY") ? c.apnsKey : null;
  const keyId = c.apnsKeyId?.trim();
  const team = c.apnsTeamId?.trim();
  const topic = c.apnsTopic?.trim();
  const apns = apnsKey && keyId && team && topic ? { key: apnsKey, keyId, team, topic } : null;
  const fcm = serviceAccount(c.fcmServiceAccount);
  if (!apns && !fcm) return null;

  let apnsJwt: { jwt: Promise<string>; at: number } | null = null;
  const apnsAuth = (key: string, keyId: string, team: string): Promise<string> => {
    if (!apnsJwt || now() - apnsJwt.at > APNS_JWT_MS) {
      const jwt = signedJwt("ES256", key, { kid: keyId }, { iss: team, iat: Math.floor(now() / 1000) });
      apnsJwt = { jwt, at: now() };
      jwt.catch(() => {
        if (apnsJwt?.jwt === jwt) apnsJwt = null;
      });
    }
    return apnsJwt.jwt;
  };

  let fcmAccess: { token: Promise<string | null>; until: number } | null = null;
  const fetchAccess = async (a: ServiceAccount): Promise<{ token: string; ms: number } | null> => {
    const secs = Math.floor(now() / 1000);
    const assertion = await signedJwt("RS256", a.key, { typ: "JWT" }, { iss: a.email, scope: FCM_SCOPE, aud: a.tokenUri, iat: secs, exp: secs + 3600 });
    const res = await get(a.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    return typeof b.access_token === "string" ? { token: b.access_token, ms: (Number(b.expires_in) || 3600) * 1000 } : null;
  };
  const fcmAuth = (a: ServiceAccount): Promise<string | null> => {
    if (fcmAccess && fcmAccess.until > now()) return fcmAccess.token;
    const pending: { token: Promise<string | null>; until: number } = { token: Promise.resolve(null), until: Infinity };
    pending.token = fetchAccess(a)
      .catch(() => null)
      .then((got) => {
        if (!got) {
          if (fcmAccess === pending) fcmAccess = null;
          return null;
        }
        pending.until = now() + got.ms - 300_000;
        return got.token;
      });
    fcmAccess = pending;
    return pending.token;
  };

  const toApns = async (w: Wake): Promise<boolean> => {
    if (!apns) return false;
    const res = await get(`${w.sandbox ? APNS_SANDBOX_HOST : APNS_HOST}/3/device/${w.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${await apnsAuth(apns.key, apns.keyId, apns.team)}`,
        "apns-topic": apns.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(now() / 1000) + WAKE_TTL_S),
        "content-type": "application/json",
      },
      body: JSON.stringify(apnsBody(w)),
    });
    if (res.ok) return false;
    if (res.status === 403) apnsJwt = null;
    if (res.status === 410) return true;
    const reason = ((await res.json().catch(() => ({}))) as { reason?: unknown }).reason;
    console.error(`apns refused a wake: ${res.status} ${typeof reason === "string" ? reason : ""}`);
    return res.status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic");
  };

  const toFcm = async (w: Wake): Promise<boolean> => {
    if (!fcm) return false;
    const access = await fcmAuth(fcm);
    if (!access) return false;
    const res = await get(`https://fcm.googleapis.com/v1/projects/${fcm.project}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify(fcmMessage(w.token, w)),
    });
    if (res.ok) return false;
    if (res.status === 401) fcmAccess = null;
    if (res.status === 404) return true;
    const text = await res.text().catch(() => "");
    console.error(`fcm refused a wake: ${res.status}`);
    return res.status === 400 && text.includes("registration token");
  };

  return {
    async send(wakes) {
      const dead = await Promise.all(
        wakes.map((w) =>
          (w.platform === "apns" ? toApns(w) : toFcm(w)).catch((e: unknown) => {
            console.error(`a wake failed: ${e instanceof Error ? e.message : "error"}`);
            return false;
          }),
        ),
      );
      return wakes.filter((_, i) => dead[i]).map((w) => w.token);
    },
  };
}
