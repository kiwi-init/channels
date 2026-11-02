const GITHUB_DEVICE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };

export type SignInFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  url: string;
  expiresIn: number;
  interval: number;
}

export interface PollDeps {
  fetch: SignInFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  signal?: AbortSignal;
}

export async function startDevice(clientId: string, f: SignInFetch = fetch, signal?: AbortSignal): Promise<DeviceStart> {
  const res = await f(GITHUB_DEVICE_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ client_id: clientId }), ...(signal ? { signal } : {}) });
  const body = (await res.json().catch(() => ({}))) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number; error?: string };
  if (!res.ok || !body.device_code || !body.user_code || !body.verification_uri || !URL.canParse(body.verification_uri) || new URL(body.verification_uri).protocol !== "https:") {
    throw new Error(body.error === "device_flow_disabled" ? "the GitHub App doesn’t have device flow turned on" : "GitHub’s sign-in didn’t start");
  }
  return { deviceCode: body.device_code, userCode: body.user_code, url: body.verification_uri, expiresIn: body.expires_in ?? 900, interval: body.interval ?? 5 };
}

export async function pollToken(clientId: string, start: DeviceStart, deps: PollDeps): Promise<string> {
  const until = deps.now() + start.expiresIn * 1000;
  let wait = start.interval;
  for (;;) {
    await deps.sleep(wait * 1000);
    if (deps.signal?.aborted) throw new Error("sign-in was stopped");
    if (deps.now() > until) throw new Error("linking timed out");
    const res = await deps
      .fetch(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ client_id: clientId, device_code: start.deviceCode, grant_type: GRANT }),
        ...(deps.signal ? { signal: deps.signal } : {}),
      })
      .catch((err: unknown) => {
        if (deps.signal?.aborted) throw err;
        return null;
      });
    if (!res) continue;
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; interval?: number };
    if (body.access_token) return body.access_token;
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      wait = body.interval ?? wait + 5;
      continue;
    }
    throw new Error(body.error === "access_denied" ? "linking was declined" : body.error === "expired_token" ? "linking timed out" : "GitHub refused the link");
  }
}
