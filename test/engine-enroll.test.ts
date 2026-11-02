import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeviceList, type DeviceLink } from "@kiwi/core/devices.ts";
import { personFingerprint } from "@kiwi/core/fingerprint.ts";
import { withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { createDeviceHost, type DeviceHost } from "../desktop/src/devices.ts";
import type { EnrollStart, Push, Reply, Saved } from "../ios/engine/wire.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

interface Engine {
  ask(json: string): Promise<string>;
  listen(next: (p: Push) => void): void;
  fetched(json: string): void;
}

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-engine-enroll-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let engine: Engine;
const pushes: Push[] = [];

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
  relay = server.url.origin;
  await import("../ios/engine/main.ts");
  engine = (globalThis as unknown as { kiwi: Engine }).kiwi;
  engine.listen((p) => void pushes.push(p));
});

afterAll(async () => {
  await ask({ op: "start", saved: { relay, person: null, seats: [] } });
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function ask<T>(request: object): Promise<T> {
  const reply = JSON.parse(await engine.ask(JSON.stringify(request))) as Reply;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value as T;
}

function desktop(person: Identity, user: string, channels: { label: string; code: string }[], held: { device: Identity | null; links: DeviceLink[] } = { device: null, links: [] }): DeviceHost {
  return createDeviceHost({
    relayUrl: () => relay,
    token: async () => `dev:${user}`,
    person: () => person,
    who: () => ({ name: person.name, pk: person.pk, xpk: person.xpk! }),
    device: () => held.device,
    saveDevice: (d) => void (held.device = d),
    links: () => held.links,
    saveLinks: (l) => void (held.links = l),
    channels: () => channels,
    label: () => "studio",
    os: () => "macOS",
    wipe: () => {},
  });
}

async function answered(host: DeviceHost): Promise<string> {
  for (;;) {
    const e = await host.poll();
    if (e) {
      await host.answer(e.id);
      return e.id;
    }
    await Bun.sleep(50);
  }
}

async function letIn(s: OwnerSetup, until: () => boolean): Promise<void> {
  while (!until()) {
    await s.ownerCh.autoApprove(s.person.pk, [], []).catch(() => []);
    await Bun.sleep(250);
  }
}

describe("the phone engine signs in and enrolls (T640)", () => {
  test("it asks as a phone, shows the digits, keeps its own key and joins the person's channels as them", async () => {
    const s = await setupChannel(relay, { ownerName: "jow", personName: "Jow", human: "dev:phone1" });
    const person = await withExchangeKey(s.person);
    const host = desktop(person, "phone1", [{ label: "onemouse", code: s.code }]);
    await host.poll();

    expect(await ask<EnrollStart>({ op: "enrollBegin", relay, label: "Pixel 9", os: "Android 16", user: "phone1" })).toEqual({ url: null, code: "" });
    expect(await ask({ op: "enrollAsk" })).toBeNull();
    expect(await host.poll()).toMatchObject({ label: "Pixel 9", stage: "new" });
    const waiting = ask<{ digits: string }>({ op: "enrollWait" });
    const id = await answered(host);
    const { digits } = await waiting;
    expect(digits).toMatch(/^\d{6}$/);
    expect(await host.confirm(id, digits)).toEqual({ ok: true, label: "Pixel 9" });

    expect(await ask({ op: "enrollCheck" })).toEqual({ name: "Jow", fingerprint: await personFingerprint(person.pk) });
    expect(pushes.some((p) => p.type === "saved")).toBe(false);
    const saved = await ask<Saved>({ op: "enrollFinish" });
    expect(saved.person).toBeNull();
    expect(saved.device?.person).toEqual({ name: "Jow", pk: person.pk, xpk: person.xpk! });
    expect(saved.device?.key.pk).not.toBe(person.pk);
    const read = await readDeviceList(saved.device!.links);
    expect(read.ok && read.list.devices.find((d) => d.device === saved.device!.key.pk)).toMatchObject({ as: "phone", approve: false, label: "Pixel 9", os: "Android 16" });
    expect(saved.seats).toHaveLength(1);
    expect(saved.seats[0]).toMatchObject({ code: s.code, idName: "jow" });
    expect(saved.seats[0]!.access).toBeUndefined();
    expect(pushes.some((p) => p.type === "saved" && p.saved.device?.key.pk === saved.device!.key.pk)).toBe(true);

    await letIn(s, () => pushes.some((p) => p.type === "room" && p.room.code === s.code && p.room.connection === "live"));
    const member = (await s.ownerCh.members()).find((m) => m.pk === saved.seats[0]!.pk);
    expect(member).toMatchObject({ kind: "human" });
    const kept = pushes.findLast((p) => p.type === "saved");
    expect(kept?.type === "saved" && kept.saved.seats.find((c) => c.code === s.code)?.access).toBeTruthy();
    await s.ownerCh.close();
  });

  test("a renewal posted into a channel reaches the phone, and a revoke wipes it (T1007)", async () => {
    await ask({ op: "start", saved: { relay, person: null, seats: [] } });
    const s = await setupChannel(relay, { ownerName: "jow", personName: "Jow", human: "dev:phone3" });
    const person = await withExchangeKey(s.person);
    const held: { device: Identity | null; links: DeviceLink[] } = { device: null, links: [] };
    const host = desktop(person, "phone3", [{ label: "onemouse", code: s.code }], held);
    await host.poll();
    await ask({ op: "enrollBegin", relay, label: "Pixel 9", os: "Android 16", user: "phone3" });
    const waiting = ask<{ digits: string }>({ op: "enrollWait" });
    const id = await answered(host);
    await host.confirm(id, (await waiting).digits);
    await ask({ op: "enrollCheck" });
    const saved = await ask<Saved>({ op: "enrollFinish" });
    const phone = saved.device!.key.pk;
    await letIn(s, () => pushes.some((p) => p.type === "room" && p.room.code === s.code && p.room.connection === "live"));

    await host.renew(phone);
    await host.list();
    const post = () => s.ownerCh.send("updated their list of devices", { kind: "event", ev: { op: "devices", links: held.links } });
    await post();
    const longer = held.links.length;
    for (let i = 0; i < 200 && !pushes.some((p) => p.type === "saved" && p.saved.device?.links.length === longer); i++) await Bun.sleep(50);
    expect(pushes.some((p) => p.type === "saved" && p.saved.device?.links.length === longer)).toBe(true);

    await host.forget(phone);
    await host.list();
    await post();
    for (let i = 0; i < 200 && !pushes.some((p) => p.type === "removed"); i++) await Bun.sleep(50);
    expect(pushes.find((p) => p.type === "removed")).toEqual({ type: "removed", by: "studio" });
    await s.ownerCh.close();
  });

  test("a phone the computer turns away stops waiting", async () => {
    await ask({ op: "start", saved: { relay, person: null, seats: [] } });
    const s = await setupChannel(relay, { personName: "Jow", human: "dev:phone2" });
    const host = desktop(await withExchangeKey(s.person), "phone2", []);
    await host.poll();
    await ask({ op: "enrollBegin", relay, label: "Pixel 9", os: "Android 16", user: "phone2" });
    const waiting = ask({ op: "enrollWait" });
    const id = await answered(host);
    await host.deny(id);
    await expect(waiting).rejects.toThrow("turned this phone away");
  });

  test("the phone keeps nothing until its person's key is confirmed, and a turned-down key leaves nothing behind (#1323)", async () => {
    await ask({ op: "start", saved: { relay, person: null, seats: [] } });
    const s = await setupChannel(relay, { personName: "Jow", human: "dev:phone4" });
    const person = await withExchangeKey(s.person);
    const host = desktop(person, "phone4", [{ label: "onemouse", code: s.code }]);
    await host.poll();
    await ask({ op: "enrollBegin", relay, label: "Pixel 9", os: "Android 16", user: "phone4" });
    const waiting = ask<{ digits: string }>({ op: "enrollWait" });
    const id = await answered(host);
    await host.confirm(id, (await waiting).digits);
    const before = pushes.length;
    await expect(ask({ op: "enrollFinish" })).rejects.toThrow("check your person's key");
    expect(await ask({ op: "enrollCheck" })).toEqual({ name: "Jow", fingerprint: await personFingerprint(person.pk) });
    await ask({ op: "enrollCancel" });
    await expect(ask({ op: "enrollFinish" })).rejects.toThrow("signing in hasn't started");
    expect(pushes.slice(before).some((p) => p.type === "saved")).toBe(false);
    await s.ownerCh.close();
  });

  test("a cancel that lands while the phone keeps its person wins, and nothing is saved (#1323)", async () => {
    await ask({ op: "start", saved: { relay, person: null, seats: [] } });
    const s = await setupChannel(relay, { personName: "Jow", human: "dev:phone5" });
    const host = desktop(await withExchangeKey(s.person), "phone5", [{ label: "onemouse", code: s.code }]);
    await host.poll();
    await ask({ op: "enrollBegin", relay, label: "Pixel 9", os: "Android 16", user: "phone5" });
    const waiting = ask<{ digits: string }>({ op: "enrollWait" });
    const id = await answered(host);
    await host.confirm(id, (await waiting).digits);
    await ask({ op: "enrollCheck" });
    const before = pushes.length;
    const finishing = ask({ op: "enrollFinish" });
    await ask({ op: "enrollCancel" });
    await expect(finishing).rejects.toThrow("cancelled, so this phone kept nothing");
    expect(pushes.slice(before).some((p) => p.type === "saved")).toBe(false);
    await s.ownerCh.close();
  });

  test("a dev relay needs the sign-in name", async () => {
    await expect(ask({ op: "enrollBegin", relay, label: "Pixel 9", os: "Android 16" })).rejects.toThrow("dev sign-in");
  });
});

describe("the phone engine's sign-in opens or says why (T13)", () => {
  const configOnly = (answer: () => Promise<Response>) => Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: answer });
  const asHost = () => Object.assign(globalThis, { kiwiAndroid: { postMessage: () => {} } });
  const noHost = () => Reflect.deleteProperty(globalThis, "kiwiAndroid");

  async function asked(after: number): Promise<Extract<Push, { type: "fetch" }>> {
    for (;;) {
      const got = pushes.slice(after).find((p) => p.type === "fetch");
      if (got?.type === "fetch") return got;
      await Bun.sleep(10);
    }
  }

  test("a relay that never answers its config fails within the wait, with the reason", async () => {
    const stuck = configOnly(() => new Promise<Response>(() => {}));
    try {
      const at = Date.now();
      await expect(ask({ op: "enrollBegin", relay: stuck.url.origin, label: "iPhone", os: "iOS 27", waitMs: 300 })).rejects.toThrow(
        `${stuck.url.origin} didn't answer in 1 second: check the connection`,
      );
      expect(Date.now() - at).toBeLessThan(5_000);
    } finally {
      stuck.stop(true);
    }
  });

  test("Cancel stops a sign-in that is still opening", async () => {
    const stuck = configOnly(() => new Promise<Response>(() => {}));
    try {
      const opening = ask({ op: "enrollBegin", relay: stuck.url.origin, label: "iPhone", os: "iOS 27", waitMs: 30_000 });
      await Bun.sleep(100);
      await ask({ op: "enrollCancel" });
      await expect(opening).rejects.toThrow("signing in was cancelled");
    } finally {
      stuck.stop(true);
    }
  });

  test("the app makes the WorkOS calls, and a blocked one says what failed", async () => {
    const workos = configOnly(async () => Response.json({ workosClientId: "client_test" }));
    asHost();
    try {
      const before = pushes.length;
      const opening = ask({ op: "enrollBegin", relay: workos.url.origin, label: "iPhone", os: "iOS 27", waitMs: 5_000 });
      const call = await asked(before);
      expect(call.url).toBe("https://api.workos.com/user_management/authorize/device");
      expect(JSON.parse(call.body)).toMatchObject({ client_id: "client_test" });
      engine.fetched(JSON.stringify({ id: call.id, error: "Load failed" }));
      await expect(opening).rejects.toThrow("couldn't reach the sign-in service: Load failed");

      const again = pushes.length;
      const started = ask<EnrollStart>({ op: "enrollBegin", relay: workos.url.origin, label: "iPhone", os: "iOS 27", waitMs: 5_000 });
      const answer = { device_code: "dc", user_code: "ABCD-EFGH", verification_uri_complete: "https://auth.example/device?user_code=ABCD-EFGH", interval: 60 };
      engine.fetched(JSON.stringify({ id: (await asked(again)).id, status: 200, body: JSON.stringify(answer) }));
      expect(await started).toEqual({ url: "https://auth.example/device?user_code=ABCD-EFGH", code: "ABCD-EFGH" });
      expect(pushes.slice(again).some((p) => p.type === "log" && p.line === "sign-in: page ready")).toBe(true);
      await ask({ op: "enrollCancel" });
    } finally {
      noHost();
      workos.stop(true);
    }
  });

  test("on a relay that takes GitHub sign-in, the app makes GitHub's calls, shows its code, and a check cut off in the browser is asked again (T254)", async () => {
    const both = configOnly(async () => Response.json({ workosClientId: "client_test", githubSignIn: true, githubClientId: "Iv23phoneTest" }));
    asHost();
    try {
      const before = pushes.length;
      const started = ask<EnrollStart>({ op: "enrollBegin", relay: both.url.origin, label: "iPhone", os: "iOS 27", waitMs: 5_000 });
      const call = await asked(before);
      expect(call.url).toBe("https://github.com/login/device/code");
      expect(JSON.parse(call.body)).toEqual({ client_id: "Iv23phoneTest" });
      const answer = { device_code: "dc", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0.05 };
      engine.fetched(JSON.stringify({ id: call.id, status: 200, body: JSON.stringify(answer) }));
      expect(await started).toEqual({ url: "https://github.com/login/device", code: "WDJB-MJHT" });
      ask({ op: "enrollAsk" }).catch(() => {});

      const cut = pushes.length;
      const first = await asked(cut);
      expect(first.url).toBe("https://github.com/login/oauth/access_token");
      expect(JSON.parse(first.body)).toEqual({ client_id: "Iv23phoneTest", device_code: "dc", grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
      engine.fetched(JSON.stringify({ id: first.id, error: "The network connection was lost." }));

      const next = pushes.length;
      const pending = await asked(next);
      engine.fetched(JSON.stringify({ id: pending.id, status: 200, body: JSON.stringify({ error: "authorization_pending" }) }));
      const last = pushes.length;
      const granted = await asked(last);
      engine.fetched(JSON.stringify({ id: granted.id, status: 200, body: JSON.stringify({ access_token: `ghu_${"p".repeat(36)}`, token_type: "bearer" }) }));
      for (let i = 0; i < 200 && !pushes.slice(last).some((p) => p.type === "log" && p.line === "sign-in: signed in, asking your computer"); i++) await Bun.sleep(10);
      expect(pushes.slice(last).some((p) => p.type === "log" && p.line === "sign-in: signed in, asking your computer")).toBe(true);
      expect(pushes.slice(before).some((p) => p.type === "fetch" && p.url.startsWith("https://api.workos.com"))).toBe(false);
      await ask({ op: "enrollCancel" });
    } finally {
      noHost();
      both.stop(true);
    }
  });

  test("a token check cut off while the phone is in Safari is asked again", async () => {
    const workos = configOnly(async () => Response.json({ workosClientId: "client_test" }));
    asHost();
    try {
      const before = pushes.length;
      const started = ask<EnrollStart>({ op: "enrollBegin", relay: workos.url.origin, label: "iPhone", os: "iOS 27", waitMs: 5_000 });
      const answer = { device_code: "dc", user_code: "ABCD-EFGH", verification_uri_complete: "https://auth.example/device?user_code=ABCD-EFGH", interval: 0.05 };
      engine.fetched(JSON.stringify({ id: (await asked(before)).id, status: 200, body: JSON.stringify(answer) }));
      await started;
      let signedIn = false;
      ask({ op: "enrollAsk" }).then(
        () => (signedIn = true),
        () => (signedIn = true),
      );
      const waiting = ask({ op: "enrollWait" });
      waiting.catch(() => {});

      const cut = pushes.length;
      const first = await asked(cut);
      expect(first.url).toBe("https://api.workos.com/user_management/authenticate");
      engine.fetched(JSON.stringify({ id: first.id, error: "The network connection was lost." }));
      expect(signedIn).toBe(false);

      const next = pushes.length;
      const second = await asked(next);
      expect(second.id).not.toBe(first.id);
      engine.fetched(JSON.stringify({ id: second.id, status: 200, body: JSON.stringify({ access_token: "at", refresh_token: "rt" }) }));
      for (let i = 0; i < 200 && !pushes.slice(next).some((p) => p.type === "log" && p.line === "sign-in: signed in, asking your computer"); i++) await Bun.sleep(10);
      expect(pushes.slice(next).some((p) => p.type === "log" && p.line === "sign-in: signed in, asking your computer")).toBe(true);
      expect(pushes.slice(next).filter((p) => p.type === "log" && p.line === "sign-in: signed in, asking your computer")).toHaveLength(1);
      await ask({ op: "enrollCancel" });
    } finally {
      noHost();
      workos.stop(true);
    }
  });
});
