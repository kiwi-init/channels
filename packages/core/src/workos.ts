const WORKOS_DEVICE_URL = "https://api.workos.com/user_management/authorize/device";
export const WORKOS_TOKEN_URL = "https://api.workos.com/user_management/authenticate";

export interface WorkosSession {
  access: string;
  refresh: string;
  exp: number;
}

export interface DeviceSignIn {
  url: string;
  code: string;
}

export type WorkosFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function workosDeviceSignIn(clientId: string, show: (start: DeviceSignIn) => Promise<void>, opts: { fetchImpl?: WorkosFetch; signal?: AbortSignal } = {}): Promise<WorkosSession> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const start = (await (
    await fetchImpl(WORKOS_DEVICE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, scope: "openid profile email offline_access" }),
      signal: opts.signal,
    })
  ).json()) as { device_code?: string; user_code?: string; verification_uri?: string; verification_uri_complete?: string; expires_in?: number; interval?: number };
  if (!start.device_code) throw new Error("the relay's sign-in didn't start");
  const given = start.verification_uri_complete ?? (start.verification_uri ? `${start.verification_uri}?user_code=${encodeURIComponent(start.user_code ?? "")}` : null);
  if (!given || !URL.canParse(given) || new URL(given).protocol !== "https:") throw new Error("the relay's sign-in didn't start");
  await show({ url: new URL(given).href, code: start.user_code ?? "" });
  const until = Date.now() + (start.expires_in ?? 600) * 1000;
  for (;;) {
    await new Promise((r) => setTimeout(r, (start.interval ?? 5) * 1000));
    if (opts.signal?.aborted) throw new Error("sign-in was stopped");
    const res = await fetchImpl(WORKOS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code, client_id: clientId }),
      signal: opts.signal,
    });
    if (res.status === 400) {
      const err = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      if (err === "authorization_pending" || err === "slow_down") {
        if (Date.now() > until) throw new Error("sign-in timed out");
        continue;
      }
      throw new Error("sign-in was declined");
    }
    if (!res.ok) throw new Error(`sign-in failed (${res.status})`);
    const tok = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tok.access_token || !tok.refresh_token) throw new Error("sign-in came back without a token");
    return { access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + (tok.expires_in ?? 3600) * 1000 };
  }
}
