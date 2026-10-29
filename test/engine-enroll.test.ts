import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeviceList, type DeviceLink } from "@kiwi/core/devices.ts";
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

function desktop(person: Identity, user: string, channels: { label: string; code: string }[]): DeviceHost {
  const held: { device: Identity | null; links: DeviceLink[] } = { device: null, links: [] };
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
    const waiting = ask<{ digits: string }>({ op: "enrollWait" });
    const id = await answered(host);
    const { digits } = await waiting;
    expect(digits).toMatch(/^\d{6}$/);
    expect(await host.confirm(id, digits)).toEqual({ ok: true, label: "Pixel 9" });

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

  test("a dev relay needs the sign-in name", async () => {
    await expect(ask({ op: "enrollBegin", relay, label: "Pixel 9", os: "Android 16" })).rejects.toThrow("dev sign-in");
  });
});
