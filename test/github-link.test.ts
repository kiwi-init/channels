import { describe, expect, test } from "bun:test";
import { relayConfig } from "../src/relay/room/http.ts";
import { avatar, finishDevice, linkedHere, listRepos, startDevice, tokenForRelay, type DeviceStart, type FlowDeps } from "../desktop/src/github-flow.ts";

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

describe("listing the repos the linked account can reach", () => {
  const repo = (n: number) => ({ full_name: `octo/repo-${n}`, private: n % 2 === 0, pushed_at: new Date(1_700_000_000_000 + n).toISOString() });

  test("pages through them, most recently pushed first, with the token only in the header", async () => {
    const urls: string[] = [];
    const auth: (string | null)[] = [];
    const pages = [Array.from({ length: 100 }, (_, i) => repo(i)), [repo(100), repo(101)]];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      auth.push(new Headers(init?.headers).get("authorization"));
      return json(pages.shift() ?? []);
    }) as unknown as typeof fetch;
    const repos = await listRepos("ghu_secret", f);
    expect(repos).toHaveLength(102);
    expect(repos[0]).toEqual({ fullName: "octo/repo-0", private: true, pushedAt: 1_700_000_000_000 });
    expect(urls).toEqual(["https://api.github.com/user/repos?per_page=100&sort=pushed&page=1", "https://api.github.com/user/repos?per_page=100&sort=pushed&page=2"]);
    expect(urls.some((u) => u.includes("ghu_secret"))).toBe(false);
    expect(auth).toEqual(["Bearer ghu_secret", "Bearer ghu_secret"]);
  });

  test("stops at five pages", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return json(Array.from({ length: 100 }, (_, i) => repo(i)));
    }) as unknown as typeof fetch;
    expect(await listRepos("t", f)).toHaveLength(500);
    expect(calls).toBe(5);
  });

  test("says to link again when the token has expired, and skips what isn't a repo", async () => {
    await expect(listRepos("t", (async () => json({ message: "Bad credentials" }, 401)) as unknown as typeof fetch)).rejects.toThrow("link it again in Settings");
    await expect(listRepos("t", (async () => json({ message: "nope" }, 500)) as unknown as typeof fetch)).rejects.toThrow("didn’t list the repos");
    expect(await listRepos("t", (async () => json([{ full_name: 7 }, repo(1)])) as unknown as typeof fetch)).toEqual([{ fullName: "octo/repo-1", private: false, pushedAt: 1_700_000_000_001 }]);
  });
});

describe("the linked account's picture", () => {
  const image = (bytes: number, mime = "image/jpeg"): Response => new Response(new Uint8Array(bytes).fill(7), { headers: { "content-type": mime } });
  const fetchOf = (replies: Response[], urls: string[]) =>
    (async (url: string | URL | Request) => {
      urls.push(String(url));
      return replies.shift() ?? new Response(null, { status: 404 });
    }) as typeof fetch;

  test("fetched by the account's id at 96px, as base64 the person can publish", async () => {
    const urls: string[] = [];
    const p = await avatar(42, fetchOf([image(3000)], urls));
    expect(urls).toEqual(["https://avatars.githubusercontent.com/u/42?s=96&v=4"]);
    expect(p?.mime).toBe("image/jpeg");
    expect(Buffer.from(p!.data, "base64").length).toBe(3000);
  });

  test("too big at 96px, it tries 64px, then 48px and 32px; still too big, or not an image, or not there, it's null", async () => {
    const urls: string[] = [];
    expect((await avatar(42, fetchOf([image(40_000), image(5000)], urls)))?.mime).toBe("image/jpeg");
    expect(urls.map((u) => new URL(u).searchParams.get("s"))).toEqual(["96", "64"]);
    expect(await avatar(42, fetchOf([image(40_000), image(40_000), image(40_000), image(40_000)], []))).toBeNull();
    expect(await avatar(42, fetchOf([image(3000, "image/svg+xml")], []))).toBeNull();
    expect(await avatar(42, fetchOf([new Response(null, { status: 404 })], []))).toBeNull();
  });

  test("a photo GitHub serves as PNG, a little over the limit at 64px, goes out at 48px", async () => {
    const urls: string[] = [];
    const p = await avatar(42, fetchOf([image(55_474, "image/png"), image(24_710, "image/png"), image(13_942, "image/png")], urls));
    expect(urls.map((u) => new URL(u).searchParams.get("s"))).toEqual(["96", "64", "48"]);
    expect(p?.mime).toBe("image/png");
    expect(Buffer.from(p!.data, "base64").length).toBe(13_942);
  });
});

test("the link token goes only to the relay it was made for, while that relay still names the same App", async () => {
  const asked: string[] = [];
  const relayWith = (config: unknown, ok = true) =>
    (async (url: string | URL | Request) => (asked.push(String(url)), new Response(JSON.stringify(config), { status: ok ? 200 : 500 }))) as unknown as typeof fetch;
  const link = { token: "gho_x", relay: "https://relay.example", clientId: "Iv1.abc" };
  expect(await tokenForRelay("https://relay.example", link, relayWith({ githubClientId: "Iv1.abc" }))).toBe("gho_x");
  expect(await tokenForRelay("https://relay.example", link, relayWith({ githubClientId: "Iv1.other" }))).toBeNull();
  expect(await tokenForRelay("https://relay.example", link, relayWith({ workosClientId: "w" }))).toBeNull();
  expect(await tokenForRelay("https://relay.example", link, relayWith({}, false))).toBeNull();
  const down = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  expect(await tokenForRelay("https://relay.example", link, down)).toBeNull();
  asked.length = 0;
  expect(await tokenForRelay("https://other.example", link, relayWith({ githubClientId: "Iv1.abc" }))).toBeNull();
  expect(await tokenForRelay("https://relay.example", { token: "gho_x" }, relayWith({ githubClientId: "Iv1.abc" }))).toBeNull();
  expect(await tokenForRelay("https://relay.example", null, relayWith({ githubClientId: "Iv1.abc" }))).toBeNull();
  expect(asked).toEqual([]);
});

test("Settings shows the GitHub link only on the relay it was made for", () => {
  const link = { token: "gho_x", relay: "https://relay.example", clientId: "Iv1.abc" };
  expect(linkedHere(link, "https://relay.example")).toBe(true);
  expect(linkedHere(link, "https://other.example")).toBe(false);
  expect(linkedHere({ token: "gho_x" }, "https://relay.example")).toBe(false);
  expect(linkedHere(undefined, "https://relay.example")).toBe(false);
});
