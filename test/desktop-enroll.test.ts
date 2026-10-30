import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountClient } from "@kiwi/core/account.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { accountScope, askToEnroll, enrollDigits, enrollMailbox, readEnrollGrant, type Enrollment } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { personFingerprint } from "@kiwi/core/fingerprint.ts";
import type { ComputerView, PublicPerson } from "../desktop/src/bridge.ts";
import { createDeviceHost, createEnrollee, type DeviceHost } from "../desktop/src/devices.ts";
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
  who: PublicPerson;
  token: string;
  user: string;
  held: { device: Identity | null; links: DeviceLink[]; wiped: boolean; computers: ComputerView[] };
}

interface Enrolled {
  who: PublicPerson;
  device: Identity;
  links: DeviceLink[];
}

async function app(opts: { fetchImpl?: typeof fetch; person?: Identity; enrolled?: Enrolled; token?: string; now?: () => number } = {}): Promise<App> {
  const name = `desk${++users}`;
  const token = opts.token ?? `dev:${name}`;
  const person = opts.enrolled ? null : (opts.person ?? (await device("Jow")));
  const who = opts.enrolled?.who ?? { name: person!.name, pk: person!.pk, xpk: person!.xpk! };
  const held: App["held"] = { device: opts.enrolled?.device ?? null, links: opts.enrolled?.links ?? [], wiped: false, computers: [] };
  const host = createDeviceHost({
    relayUrl: () => relay,
    token: async () => token,
    person: () => person,
    who: () => who,
    device: () => held.device,
    saveDevice: (d) => void (held.device = d),
    links: () => held.links,
    saveLinks: (l) => void (held.links = l),
    channels: () => [{ label: "general", code: "mc2-code" }],
    computer: (c) => void held.computers.push(c),
    label: () => "desk",
    os: () => "macOS",
    wipe: () => {
      held.device = null;
      held.links = [];
      held.wiped = true;
    },
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { host, who, token, user: token.replace(/^dev:/, "dev_"), held };
}

async function call(a: App, id: Identity, method: string, path: string, body?: unknown): Promise<Response> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "x-human-token": a.token, authorization: `Bearer ${await signRequest(id, accountScope(a.user), method, path, text)}` };
  return fetch(relay + path, { method, headers, ...(text ? { body: text } : {}) });
}

async function newDevice(a: App, as: "desktop" | "phone" | "computer" = "desktop") {
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

async function enrolled(a: App, as: "desktop" | "phone" | "computer" = "desktop") {
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
      who: () => null,
      device: () => null,
      saveDevice: () => {},
      links: () => [],
      saveLinks: () => {},
      channels: () => [],
      label: () => "x",
      os: () => "y",
      wipe: () => {},
    });
    expect(await out.list()).toBeNull();
    expect(a.held.links).toEqual([]);
  });
});

function newDesktop(a: App) {
  const held: { device: Identity | null; enrolled: Enrolled | null; writes: number } = { device: null, enrolled: null, writes: 0 };
  const enrollee = createEnrollee({
    relayUrl: () => relay,
    token: async () => a.token,
    who: () => held.enrolled?.who ?? null,
    enrolled: (grant, device) => {
      held.writes++;
      held.device = device;
      held.enrolled = { who: grant.person, device, links: grant.links };
    },
    label: () => "studio",
    os: () => "Linux",
  });
  return { enrollee, held };
}

describe("a new desktop enrolls with no person key (T837)", () => {
  test("it asks, shows the digits the person types on the other app, and gets the person and channels", async () => {
    const a = await app();
    await a.host.poll();
    const b = newDesktop(a);
    await b.enrollee.begin();
    expect(await b.enrollee.status()).toEqual({ stage: "asking" });
    const asking = await a.host.poll();
    expect(asking).toMatchObject({ label: "studio", os: "Linux", as: "desktop", stage: "new" });
    await a.host.answer(asking!.id);
    const shown = await b.enrollee.status();
    expect(shown?.stage).toBe("digits");
    expect(await b.enrollee.status()).toEqual(shown!);
    expect((await a.host.poll())?.stage).toBe("digits");
    expect(await a.host.confirm(asking!.id, shown!.stage === "digits" ? shown!.digits : "")).toEqual({ ok: true, label: "studio" });

    expect(await b.enrollee.status()).toEqual({ stage: "check", person: { name: "Jow", fingerprint: await personFingerprint(a.who.pk) } });
    const done = await b.enrollee.keep();
    const person = (await readDeviceList(a.held.links)).ok ? a.held.links[0]!.person : "";
    expect(done).toEqual({ stage: "done", person: { name: "Jow", pk: person, xpk: expect.any(String) }, channels: [{ label: "general", code: "mc2-code" }] });
    const read = await readDeviceList(b.held.enrolled!.links);
    expect(read.ok && read.list.devices.find((d) => d.device === b.held.device!.pk)).toMatchObject({ label: "studio", as: "desktop", approve: true });
    expect(await b.enrollee.status()).toBeNull();
    await expect(b.enrollee.begin()).rejects.toThrow("already holds your person");
  });

  test("the enrolled desktop approves the next device, with no person key of its own", async () => {
    const a = await app();
    await a.host.poll();
    const b = newDesktop(a);
    await b.enrollee.begin();
    await b.enrollee.status();
    const { id } = (await a.host.poll())!;
    await a.host.answer(id);
    const shown = await b.enrollee.status();
    await a.host.confirm(id, shown?.stage === "digits" ? shown.digits : "");
    await b.enrollee.status();
    await b.enrollee.keep();

    const c = await app({ token: a.token, enrolled: b.held.enrolled! });
    const laptop = await enrolled(c, "phone");
    const read = await readDeviceList(c.held.links);
    expect(read.ok && read.list.devices.map((d) => d.label)).toEqual(["desk", "studio", "laptop"]);
    expect(read.ok && read.list.devices.find((d) => d.device === laptop.pk)?.approve).toBe(false);
    expect((await a.host.list())?.map((d) => d.label)).toEqual(["desk", "studio", "laptop"]);
  });

  test("an ask turned away on the other app ends as gone", async () => {
    const a = await app();
    await a.host.poll();
    const b = newDesktop(a);
    await b.enrollee.begin();
    const { id } = (await a.host.poll())!;
    await a.host.deny(id);
    expect(await b.enrollee.status()).toEqual({ stage: "gone" });
    expect(b.held.enrolled).toBeNull();
  });

  test("cancel takes the ask back before anyone answers", async () => {
    const a = await app();
    await a.host.poll();
    const b = newDesktop(a);
    await b.enrollee.begin();
    expect(await a.host.poll()).not.toBeNull();
    await b.enrollee.cancel();
    expect(await a.host.poll()).toBeNull();
    expect(await b.enrollee.status()).toBeNull();
  });

  test("a new desktop that isn't signed in can't ask", async () => {
    const e = createEnrollee({ relayUrl: () => relay, token: async () => null, who: () => null, enrolled: () => {}, label: () => "x", os: () => "y" });
    await expect(e.begin()).rejects.toThrow("sign in first");
  });
});

async function toCheck(a: App, b: ReturnType<typeof newDesktop>): Promise<string> {
  await a.host.poll();
  await b.enrollee.begin();
  await b.enrollee.status();
  const { id } = (await a.host.poll())!;
  await a.host.answer(id);
  const shown = await b.enrollee.status();
  const approving = await a.host.poll();
  await a.host.confirm(id, shown?.stage === "digits" ? shown.digits : "");
  return approving?.fingerprint ?? "";
}

describe("a new device keeps nothing until its person confirms the key (#1323)", () => {
  const own = mkdtempSync(join(tmpdir(), "kiwi-desktop-keycheck-"));
  let mine: ReturnType<typeof startRelay>;
  let shared = "";
  beforeAll(() => {
    mine = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: own, human: devHumanAuth() });
    shared = relay;
    relay = mine.url.origin;
  });
  afterAll(() => {
    relay = shared;
    mine.stop(true);
    rmSync(own, { recursive: true, force: true });
  });

  test("the new desktop shows the key the approving app showed, and writes nothing before keep", async () => {
    const a = await app();
    const b = newDesktop(a);
    const approving = await toCheck(a, b);
    expect(approving).toBe(await personFingerprint(a.who.pk));
    const check = await b.enrollee.status();
    expect(check).toEqual({ stage: "check", person: { name: "Jow", fingerprint: approving } });
    expect(await b.enrollee.status()).toEqual(check!);
    expect(b.held).toEqual({ device: null, enrolled: null, writes: 0 });

    await b.enrollee.keep();
    expect(b.held.writes).toBe(1);
    expect(b.held.enrolled?.who.pk).toBe(a.who.pk);
  });

  test("the approving app shows the key for desktops and phones, not only computers", async () => {
    const a = await app();
    await a.host.poll();
    const b = newDesktop(a);
    await b.enrollee.begin();
    expect((await a.host.poll())?.fingerprint).toBe(await personFingerprint(a.who.pk));
  });

  test("a grant from someone else's person shows their key, and turning it down keeps nothing and drops the grant", async () => {
    const mine = await app();
    const theirs = await app();
    const b = newDesktop(theirs);
    await toCheck(theirs, b);
    const check = await b.enrollee.status();
    const shown = check?.stage === "check" ? check.person.fingerprint : "";
    expect(shown).toBe(await personFingerprint(theirs.who.pk));
    expect(shown).not.toBe(await personFingerprint(mine.who.pk));

    await b.enrollee.cancel();
    expect(b.held).toEqual({ device: null, enrolled: null, writes: 0 });
    expect(await b.enrollee.status()).toBeNull();
    await expect(b.enrollee.keep()).rejects.toThrow("check your person's key");
  });

  test("keep before the key check refuses, and writes nothing", async () => {
    const a = await app();
    const b = newDesktop(a);
    await a.host.poll();
    await b.enrollee.begin();
    await expect(b.enrollee.keep()).rejects.toThrow("check your person's key");
    expect(b.held.writes).toBe(0);
  });

  test("a device that took a person while it waited refuses another, naming the one it holds", async () => {
    const a = await app();
    const other = await app();
    const b = newDesktop(a);
    await toCheck(a, b);
    await b.enrollee.status();
    b.held.enrolled = { who: other.who, device: await device("held"), links: [] };
    await expect(b.enrollee.keep()).rejects.toThrow(`kept nothing: while this waited, this app became one of Jow's devices (key ${await personFingerprint(other.who.pk)})`);
    expect(b.held.writes).toBe(0);
    expect(b.held.enrolled.who.pk).toBe(other.who.pk);
    await expect(b.enrollee.begin()).rejects.toThrow("already holds your person");
  });

  test("every ask uses a new device key, so a turned-down grant's key is never reused", async () => {
    const a = await app();
    const b = newDesktop(a);
    await toCheck(a, b);
    const look = accountClient(relay, async () => a.token, a.held.device!);
    await b.enrollee.cancel();
    await b.enrollee.begin();
    const first = (await look.enrollment())!.ask.device;
    await b.enrollee.cancel();
    await b.enrollee.begin();
    expect((await look.enrollment())!.ask.device).not.toBe(first);
    await b.enrollee.cancel();
  });
});

async function secondDesktop(a: App): Promise<App> {
  await a.host.poll();
  const b = newDesktop(a);
  await b.enrollee.begin();
  await b.enrollee.status();
  const { id } = (await a.host.poll())!;
  await a.host.answer(id);
  const shown = await b.enrollee.status();
  await a.host.confirm(id, shown?.stage === "digits" ? shown.digits : "");
  await b.enrollee.status();
  await b.enrollee.keep();
  return app({ token: a.token, enrolled: b.held.enrolled! });
}

describe("revoke, renew and wipe on the desktop (T1006)", () => {
  const own = mkdtempSync(join(tmpdir(), "kiwi-desktop-revoke-"));
  let mine: ReturnType<typeof startRelay>;
  let shared = "";
  beforeAll(() => {
    mine = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: own, human: devHumanAuth() });
    shared = relay;
    relay = mine.url.origin;
  });
  afterAll(() => {
    relay = shared;
    mine.stop(true);
    rmSync(own, { recursive: true, force: true });
  });

  test("an approving app renews every device near its expiry, once a round", async () => {
    let t = Date.now();
    const a = await app({ now: () => t });
    const laptop = await enrolled(a, "phone");
    t += 80 * 86_400_000;
    await a.host.poll();
    const list = (await a.host.list())!;
    expect(list.map((d) => d.until - t)).toEqual([90 * 86_400_000, 90 * 86_400_000]);
    expect(list.find((d) => d.id === laptop.pk)).toBeDefined();
    const links = a.held.links.length;
    await a.host.poll();
    expect(a.held.links.length).toBe(links);
  });

  test("a desktop with no person key that sees itself forgotten wipes its keys, and says who did it", async () => {
    const a = await app();
    const c = await secondDesktop(a);
    expect(await c.host.poll()).toBeNull();
    const studio = c.held.device!.pk;
    await a.host.forget(studio);
    expect(await c.host.poll()).toBeNull();
    expect(c.held.wiped).toBe(true);
    expect(await c.host.news()).toEqual({ links: [], revokes: [], removed: { wiped: true, by: "desk" } });
    expect(await c.host.list()).toBeNull();
    const told = (await a.host.news())!;
    expect(told.revokes).toEqual([{ device: studio, label: "studio", as: "desktop", by: "desk", at: expect.any(Number), older: false }]);
  });

  test("the desktop holding the person key is told, never wiped, and every device hears an older one was forgotten", async () => {
    const a = await app();
    const c = await secondDesktop(a);
    await c.host.poll();
    await c.host.forget(a.held.device!.pk);
    expect(await a.host.poll()).toBeNull();
    expect(a.held.wiped).toBe(false);
    expect(a.held.device).not.toBeNull();
    expect((await a.host.news())?.removed).toEqual({ wiped: false, by: "studio" });
    await expect(a.host.renew(c.held.device!.pk)).rejects.toThrow("sign in");
    const news = (await c.host.news())!;
    expect(news.revokes.map((r) => [r.label, r.by, r.older])).toEqual([["desk", "studio", true]]);
    expect(news.links).toEqual(c.held.links);
  });
});

describe("computers, from a desktop with no person key (T898)", () => {
  const ownDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-computers-"));
  let own: ReturnType<typeof startRelay>;
  beforeAll(() => {
    own = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: ownDir, human: devHumanAuth() });
    relay = own.url.origin;
  });
  afterAll(() => {
    own.stop(true);
    rmSync(ownDir, { recursive: true, force: true });
  });

  test("an enrolled desktop approves a computer with no cert, and keeps it as one of yours", async () => {
    const a = await app();
    const c = await secondDesktop(a);
    await c.host.poll();
    const d = await newDevice(c, "computer");
    const { id } = (await c.host.poll())!;
    await c.host.answer(id);
    const digits = await d.reveal();
    const seen = await d.read();
    expect(await c.host.confirm(id, digits)).toMatchObject({ ok: true });
    const grant = await readEnrollGrant(await (await enrollMailbox(relay, d.laptop, seen)).wait("b", { timeoutMs: 5_000 }), d.laptop.pk);
    expect(grant?.cert).toBeUndefined();
    const read = await readDeviceList(grant!.links);
    expect(read.ok && read.list.devices.find((x) => x.device === d.laptop.pk)).toMatchObject({ as: "computer", approve: false });
    expect(c.held.computers).toEqual([expect.objectContaining({ machinePk: d.laptop.pk, machineXpk: d.laptop.xpk!, personPk: read.ok ? read.list.person : "" })]);
  });

  test("this computer goes in the list once, and a removed key can't come back", async () => {
    const a = await app();
    const c = await secondDesktop(a);
    const box = await device("box");
    const links = await c.host.addComputer({ pk: box.pk, xpk: box.xpk!, label: "studio", os: "macOS" });
    const read = await readDeviceList(links ?? []);
    expect(read.ok && read.list.devices.find((x) => x.device === box.pk)).toMatchObject({ as: "computer", approve: false, label: "studio" });
    expect(await c.host.addComputer({ pk: box.pk, xpk: box.xpk!, label: "studio", os: "macOS" })).toEqual(links);
    expect((await a.host.list())?.map((x) => x.id)).toContain(box.pk);
    await c.host.forget(box.pk);
    await expect(c.host.addComputer({ pk: box.pk, xpk: box.xpk!, label: "studio", os: "macOS" })).rejects.toThrow("removed from your devices");
    await expect(c.host.addComputer({ pk: c.held.device!.pk, xpk: c.held.device!.xpk!, label: "studio", os: "macOS" })).rejects.toThrow("another kind of device");
  });

  test("a phone can't add a computer", async () => {
    const a = await app();
    const c = await secondDesktop(a);
    const phone = await enrolled(c, "phone");
    const p = await app({ token: a.token, enrolled: { who: c.who, device: phone, links: c.held.links } });
    const box = await device("box");
    expect(await p.host.addComputer({ pk: box.pk, xpk: box.xpk!, label: "studio", os: "macOS" })).toBeNull();
  });
});
