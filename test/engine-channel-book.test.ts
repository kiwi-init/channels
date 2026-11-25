import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import type { DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { createDeviceHost, type DeviceHost } from "../desktop/src/devices.ts";
import type { Push, Reply, Saved } from "../ios/engine/wire.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { setupChannel } from "./owner.ts";

setDefaultTimeout(60_000);

interface Engine {
  ask(json: string): Promise<string>;
  listen(next: (p: Push) => void): void;
}

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-engine-book-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let engine: Engine;
const pushes: Push[] = [];

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
  relay = server.url.origin;
  const entry = "../ios/engine/main.ts";
  await import(entry);
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

interface Desk {
  host: DeviceHost;
  channels: { label: string; code: string }[];
}

function desktop(person: Identity, user: string, channels: { label: string; code: string }[]): Desk {
  const held: { device: Identity | null; links: DeviceLink[] } = { device: null, links: [] };
  const host = createDeviceHost({
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
  return { host, channels };
}

async function signIn(desk: Desk, user: string): Promise<Saved> {
  await desk.host.poll();
  await ask({ op: "enrollBegin", relay, label: "iPhone", os: "iOS 27", user });
  const waiting = ask<{ digits: string }>({ op: "enrollWait" });
  let id: string | null = null;
  while (!id) {
    const e = await desk.host.poll();
    if (e) {
      await desk.host.answer(e.id);
      id = e.id;
    } else await Bun.sleep(50);
  }
  await desk.host.confirm(id, (await waiting).digits);
  await ask({ op: "enrollCheck" });
  return ask<Saved>({ op: "enrollFinish" });
}

async function within(ms: number, done: () => boolean, tick: () => Promise<unknown> = async () => {}): Promise<boolean> {
  const until = Date.now() + ms;
  while (!done() && Date.now() < until) {
    await tick();
    await Bun.sleep(100);
  }
  return done();
}

const live = (code: string) => () => pushes.some((p) => p.type === "room" && p.room.code === code && p.room.connection === "live");
const gone = (code: string) => () => pushes.some((p) => p.type === "gone" && p.code === code);
const lastSaved = (): Saved | null => {
  const p = pushes.findLast((x) => x.type === "saved");
  return p?.type === "saved" ? p.saved : null;
};

async function ownedBy(person: Identity, human: string): Promise<{ code: string; ch: Channel }> {
  const owner = await generateIdentity("jow");
  const { code, access } = await Channel.create(relay, owner, { name: owner.name, kind: "human", person: person.pk }, [], undefined, human);
  return { code, ch: new Channel(access, relay, owner) };
}

const approving = (ch: Channel, person: Identity) => () => ch.autoApprove(person.pk, [], []).catch(() => []);

describe("the phone's channels follow the desktop's (T30)", () => {
  test("a channel joined on the desktop reaches the phone, and one left there leaves it, without signing in again", async () => {
    const s = await setupChannel(relay, { ownerName: "jow", personName: "Jow", human: "dev:book1" });
    const person = await withExchangeKey(s.person);
    const desk = desktop(person, "book1", [{ label: "onemouse", code: s.code }]);
    await signIn(desk, "book1");
    expect(await within(20_000, live(s.code), approving(s.ownerCh, person))).toBe(true);

    const b = await ownedBy(person, "dev:book1");
    desk.channels.push({ label: "twomouse", code: b.code });
    await desk.host.poll();
    await ask({ op: "nudge" });
    expect(await within(20_000, live(b.code), approving(b.ch, person))).toBe(true);
    expect(lastSaved()?.seats.some((c) => c.code === b.code && !!c.access)).toBe(true);

    const seatA = lastSaved()!.seats.find((c) => c.code === s.code)!;
    desk.channels.splice(0, 1);
    await desk.host.poll();
    await ask({ op: "nudge" });
    expect(await within(20_000, gone(s.code))).toBe(true);
    expect(lastSaved()?.seats.some((c) => c.code === s.code)).toBe(false);
    const asPhone = new Channel(seatA.access as ChannelAccess, relay, { name: seatA.label, pk: seatA.pk, sk: seatA.sk });
    expect(
      await asPhone.head().then(
        () => null,
        (e: unknown) => e,
      ),
    ).toMatchObject({ why: "removed", how: "left" });
    expect(lastSaved()?.seats.some((c) => c.code === b.code)).toBe(true);
    await s.ownerCh.close();
    await b.ch.close();
  });
});
