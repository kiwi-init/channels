import { describe, expect, test } from "bun:test";
import { relayConfig } from "../src/relay/room/http.ts";
import { finishDevice, startDevice, type DeviceStart, type FlowDeps } from "../desktop/src/github-flow.ts";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const start: DeviceStart = { deviceCode: "dev", userCode: "ABCD-1234", url: "https://github.com/login/device", expiresIn: 900, interval: 5 };

function deps(replies: Response[], calls: { url: string; body?: unknown }[] = []): FlowDeps & { slept: number[] } {
  const slept: number[] = [];
  let clock = 0;
  return {
    slept,
    sleep: async (ms) => void (slept.push(ms), (clock += ms)),
    now: () => clock,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const next = replies.shift();
      if (!next) throw new Error("no reply left");
      return next;
    }) as typeof fetch,
  };
}

describe("starting the device flow", () => {
  test("hands back the code to type and where to type it", async () => {
    const f = (async () => json({ device_code: "dev", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 })) as unknown as typeof fetch;
    expect(await startDevice("Iv23abc", f)).toEqual(start);
  });

  test("sends only the public client id", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return json({ device_code: "d", user_code: "u", verification_uri: "https://github.com/login/device" });
    }) as unknown as typeof fetch;
    await startDevice("Iv23abc", f);
    expect(calls).toEqual([{ url: "https://github.com/login/device/code", body: { client_id: "Iv23abc" } }]);
  });

  test("says so when the App has device flow off, and refuses a link that is not https", async () => {
    const off = (async () => json({ error: "device_flow_disabled" }, 400)) as unknown as typeof fetch;
    await expect(startDevice("x", off)).rejects.toThrow("device flow turned on");
    const http = (async () => json({ device_code: "d", user_code: "u", verification_uri: "http://github.com/login/device" })) as unknown as typeof fetch;
    await expect(startDevice("x", http)).rejects.toThrow("didn’t start");
  });
});

describe("finishing the device flow", () => {
  test("waits while GitHub says pending, then names the account", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const d = deps([json({ error: "authorization_pending" }), json({ access_token: "gho_x" }), json({ login: "octo", id: 7 })], calls);
    expect(await finishDevice("Iv23abc", start, d)).toEqual({ login: "octo", id: 7, token: "gho_x" });
    expect(d.slept).toEqual([5000, 5000]);
    expect(calls[1]!.body).toEqual({ client_id: "Iv23abc", device_code: "dev", grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
    expect(calls[2]!.url).toBe("https://api.github.com/user");
  });

  test("slows down when told to", async () => {
    const d = deps([json({ error: "slow_down", interval: 10 }), json({ access_token: "t" }), json({ login: "octo", id: 1 })]);
    await finishDevice("c", start, d);
    expect(d.slept).toEqual([5000, 10000]);
  });

  test("a declined link, an expired code and a refusal each say what happened", async () => {
    await expect(finishDevice("c", start, deps([json({ error: "access_denied" })]))).rejects.toThrow("declined");
    await expect(finishDevice("c", start, deps([json({ error: "expired_token" })]))).rejects.toThrow("timed out");
    await expect(finishDevice("c", start, deps([json({ error: "unsupported_grant_type" })]))).rejects.toThrow("refused");
  });

  test("gives up when the code's time is spent", async () => {
    const d = deps([json({ error: "authorization_pending" }), json({ error: "authorization_pending" })]);
    await expect(finishDevice("c", { ...start, expiresIn: 8 }, d)).rejects.toThrow("timed out");
  });

  test("a token GitHub won't name an account for is not a link", async () => {
    await expect(finishDevice("c", start, deps([json({ access_token: "t" }), json({ message: "Bad credentials" }, 401)]))).rejects.toThrow("didn’t say who");
  });
});

describe("the relay's config", () => {
  test("carries the GitHub App's public client id only when the relay has one", async () => {
    expect(await relayConfig(null, "Iv23abc").json()).toEqual({ workosClientId: null, githubClientId: "Iv23abc" });
    expect(await relayConfig(null).json()).toEqual({ workosClientId: null });
    expect(await relayConfig(null, "").json()).toEqual({ workosClientId: null });
  });
});
