const DEVICE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  url: string;
  expiresIn: number;
  interval: number;
}

export interface GithubAccount {
  login: string;
  id: number;
  token: string;
}

export interface FlowDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };

export async function startDevice(clientId: string, f: typeof fetch = fetch): Promise<DeviceStart> {
  const res = await f(DEVICE_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ client_id: clientId }) });
  const body = (await res.json().catch(() => ({}))) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number; error?: string };
  if (!res.ok || !body.device_code || !body.user_code || !body.verification_uri || !URL.canParse(body.verification_uri) || new URL(body.verification_uri).protocol !== "https:") {
    throw new Error(body.error === "device_flow_disabled" ? "the GitHub App doesn’t have device flow turned on" : "GitHub’s sign-in didn’t start");
  }
  return { deviceCode: body.device_code, userCode: body.user_code, url: body.verification_uri, expiresIn: body.expires_in ?? 900, interval: body.interval ?? 5 };
}

export async function finishDevice(clientId: string, start: DeviceStart, deps: FlowDeps): Promise<GithubAccount> {
  const until = deps.now() + start.expiresIn * 1000;
  let wait = start.interval;
  for (;;) {
    await deps.sleep(wait * 1000);
    if (deps.now() > until) throw new Error("linking timed out");
    const res = await deps.fetch(TOKEN_URL, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ client_id: clientId, device_code: start.deviceCode, grant_type: GRANT }) });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; interval?: number };
    if (body.access_token) return account(body.access_token, deps.fetch);
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      wait = body.interval ?? wait + 5;
      continue;
    }
    throw new Error(body.error === "access_denied" ? "linking was declined" : body.error === "expired_token" ? "linking timed out" : "GitHub refused the link");
  }
}

async function account(token: string, f: typeof fetch): Promise<GithubAccount> {
  const res = await f(USER_URL, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "channels-desktop" } });
  const body = (await res.json().catch(() => ({}))) as { login?: string; id?: number };
  if (!res.ok || typeof body.login !== "string" || typeof body.id !== "number") throw new Error("GitHub didn’t say who this is");
  return { login: body.login, id: body.id, token };
}
