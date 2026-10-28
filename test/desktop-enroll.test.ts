import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { accountScope, askToEnroll, enrollDigits, enrollMailbox, readEnrollGrant, type Enrollment } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { createDeviceHost, type DeviceHost } from "../desktop/src/devices.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-enroll-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let users = 0;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
  relay = server.url.origin;
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const device = async (name: string) => withExchangeKey(await generateIdentity(name));

interface App {
  host: DeviceHost;
  token: string;
  user: string;
  held: { device: Identity | null; links: DeviceLink[] };
}

async function app(opts: { fetchImpl?: typeof fetch; person?: Identity; token?: string; now?: () => number } = {}): Promise<App> {
  const name = `desk${++users}`;
  const token = opts.token ?? `dev:${name}`;
  const person = opts.person ?? (await device("Jow"));
  const held: App["held"] = { device: null, links: [] };
  const host = createDeviceHost({
    relayUrl: () => relay,
    token: async () => token,
    person: () => person,
    device: () => held.device,
    saveDevice: (d) => void (held.device = d),
    links: () => held.links,
    saveLinks: (l) => void (held.links = l),
    channels: () => [{ label: "general", code: "mc2-code" }],
    label: () => "desk",
    os: () => "macOS",
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { host, token, user: token.replace(/^dev:/, "dev_"), held };
}

async function call(a: App, id: Identity, method: string, path: string, body?: unknown): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "x-human-token": a.token, authorization: `Bearer ${await signRequest(id, accountScope(a.user), method, path, text)}` };
  return fetch(relay + path, { method, headers, ...(text ? { body: text } : {}) });
}

async function newDevice(a: App, as: "desktop" | "phone" = "desktop") {
  const laptop = await device("laptop");
  const { ask, nonce } = await askToEnroll(laptop, { label: "laptop", os: "Linux", as });
  expect((await call(a, laptop, "POST", "/v1/account/ask", { ask })).status).toBe(202);
  const read = async () => (await (await call(a, laptop, "GET", "/v1/account/ask")).json()) as Enrollment;
  const reveal = async () => {
    const e = await read();
    expect((await call(a, laptop, "PUT", `/v1/account/ask/${e.id}/reveal`, { nonce })).status).toBe(204);
    return enrollDigits(e.ask, e.answer!, nonce);
  };
  return { laptop, ask, read, reveal };
}

const other = (digits: string) => String((Number(digits) + 1) % 1_000_000).padStart(6, "0");

describe("the desktop approves a new device (T636)", () => {
  test("the first poll publishes this app's device list, rooted in the person key", async () => {
    const a = await app();
    expect(await a.host.poll()).toBeNull();
    const read = await readDeviceList(a.held.links);
    expect(read.ok && read.list.devices.map((d) => [d.device, d.as, d.approve])).toEqual([[a.held.device!.pk, "desktop", true]]);
    const kept = (await (await fetch(`${relay}/v1/account`, { headers: { "x-human-token": a.token } })).json()) as { links: DeviceLink[] };
    expect(kept.links).toEqual(a.held.links);
  });

  test("answer, the device reveals, the person types its digits: the device is listed and gets its grant", async () => {
    const a = await app();
    await a.host.poll();
    const d = await newDevice(a);
    const asking = await a.host.poll();
    expect(asking).toMatchObject({ label: "laptop", os: "Linux", as: "desktop", stage: "new" });
    await a.host.answer(asking!.id);
    expect((await a.host.poll())?.stage).toBe("waiting");
    const digits = await d.reveal();
    expect((await a.host.poll())?.stage).toBe("digits");

    expect(await a.host.confirm(asking!.id, other(digits))).toEqual({ ok: false, left: 2 });
    expect(await a.host.confirm(asking!.id, `${digits.slice(0, 3)} ${digits.slice(3)}`)).toEqual({ ok: true, label: "laptop" });

    const read = await readDeviceList(a.held.links);
    expect(read.ok && read.list.devices.find((x) => x.device === d.laptop.pk)).toMatchObject({ as: "desktop", approve: true, label: "laptop" });
    expect(await a.host.poll()).toBeNull();
  });

  test("the grant opens on the new device, and a phone joins without the approve permission", async () => {
    const a = await app();
    await a.host.poll();
    const d = await newDevice(a, "phone");
    const { id } = (await a.host.poll())!;
    await a.host.answer(id);
    const digits = await d.reveal();
    const seen = await d.read();
    expect(await a.host.confirm(id, digits)).toEqual({ ok: true, label: "laptop" });
    const mailbox = await enrollMailbox(relay, d.laptop, seen);
    const grant = await readEnrollGrant(await mailbox.wait("b", { timeoutMs: 5_000 }), d.laptop.pk);
    expect(grant?.channels).toEqual([{ label: "general", code: "mc2-code" }]);
    expect(grant?.person.name).toBe("Jow");
    const read = await readDeviceList(grant!.links);
    expect(read.ok && read.list.devices.find((x) => x.device === d.laptop.pk)).toMatchObject({ as: "phone", approve: false });
    expect(await readEnrollGrant(grant, (await device("stranger")).pk)).toBeNull();
  });

  test("three wrong tries turn the device away", async () => {
    const a = await app();
    await a.host.poll();
    const d = await newDevice(a);
    const { id } = (await a.host.poll())!;
    await a.host.answer(id);
    const digits = await d.reveal();
    expect(await a.host.confirm(id, other(digits))).toEqual({ ok: false, left: 2 });
    expect(await a.host.confirm(id, other(digits))).toEqual({ ok: false, left: 1 });
    expect(await a.host.confirm(id, other(digits))).toEqual({ ok: false, left: 0 });
    expect(await a.host.poll()).toBeNull();
    expect((await readDeviceList(a.held.links)).ok && a.held.links.length).toBe(1);
  });

  test("the app uses its own nonce, never the one the relay hands back", async () => {
    let swap = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const res = await fetch(input, init);
      if (!swap || !String(input).endsWith("/v1/account/ask") || (init?.method ?? "GET") !== "GET" || !res.ok) return res;
      const e = (await res.json()) as Enrollment;
      return Response.json(e.answer ? { ...e, answer: { ...e.answer, nonce: "A".repeat(43) } } : e);
    }) as typeof fetch;
    const a = await app({ fetchImpl });
    await a.host.poll();
    const d = await newDevice(a);
    const { id } = (await a.host.poll())!;
    await a.host.answer(id);
    const digits = await d.reveal();
    swap = true;
    expect(await a.host.confirm(id, digits)).toEqual({ ok: false, left: 2 });
  });

  test("an account already holding another person's list is refused", async () => {
    const first = await app();
    await first.host.poll();
    const second = await app({ token: first.token });
    await expect(second.host.poll()).rejects.toThrow("another Channels person key");
  });

  test("the list kept at the relay wins over the app's own copy", async () => {
    const person = await device("Jow");
    const a = await app({ person });
    await a.host.poll();
    const desk = a.held.device!;
    const b = await app({ person, token: a.token });
    b.held.device = desk;
    b.held.links = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
    expect(await b.host.poll()).toBeNull();
    expect(b.held.links).toEqual(a.held.links);
  });
});

async function enrolled(a: App, as: "desktop" | "phone" = "desktop") {
  await a.host.poll();
  const d = await newDevice(a, as);
  const { id } = (await a.host.poll())!;
  await a.host.answer(id);
  expect(await a.host.confirm(id, await d.reveal())).toMatchObject({ ok: true });
  return d.laptop;
}

describe("Settings → Devices: the signed list, forget and renew (T836)", () => {
  test("the list shows this app and the devices it approved", async () => {
    const a = await app();
    const laptop = await enrolled(a, "phone");
    const list = await a.host.list();
    expect(list?.map((d) => [d.label, d.as, d.approve, d.thisOne])).toEqual([
      ["desk", "desktop", true, true],
      ["laptop", "phone", false, false],
    ]);
    expect(list?.[1]?.id).toBe(laptop.pk);
  });

  test("forget adds a revoke link the relay keeps, and the device can't ask again", async () => {
    const a = await app();
    const laptop = await enrolled(a);
    await a.host.forget(laptop.pk);
    expect((await a.host.list())?.map((d) => d.label)).toEqual(["desk"]);
    const kept = (await (await fetch(`${relay}/v1/account`, { headers: { "x-human-token": a.token } })).json()) as { links: DeviceLink[] };
    const read = await readDeviceList(kept.links);
    expect(read.ok && read.list.revoked).toEqual([laptop.pk]);
    const { ask } = await askToEnroll(laptop, { label: "laptop", os: "Linux", as: "desktop" });
    expect((await call(a, laptop, "POST", "/v1/account/ask", { ask })).status).toBe(403);
  });

  test("this app can't forget itself", async () => {
    const a = await app();
    await a.host.poll();
    await expect(a.host.forget(a.held.device!.pk)).rejects.toThrow("another of your devices");
  });

  test("renew moves a device's expiry out to 90 days from now", async () => {
    let t = Date.now();
    const a = await app({ now: () => t });
    const laptop = await enrolled(a);
    const before = (await a.host.list())!.find((d) => d.id === laptop.pk)!.until;
    t += 30 * 86_400_000;
    await a.host.renew(laptop.pk);
    const after = (await a.host.list())!.find((d) => d.id === laptop.pk)!.until;
    expect(after - before).toBe(30 * 86_400_000);
  });

  test("an app that isn't signed in has no list", async () => {
    const a = await app();
    const out = createDeviceHost({
      relayUrl: () => relay,
      token: async () => null,
      person: () => null,
      device: () => null,
      saveDevice: () => {},
      links: () => [],
      saveLinks: () => {},
      channels: () => [],
      label: () => "x",
      os: () => "y",
    });
    expect(await out.list()).toBeNull();
    expect(a.held.links).toEqual([]);
  });
});
