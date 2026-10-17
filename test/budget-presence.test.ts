import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { AgentLive } from "../src/agent.ts";
import { Channel, type Live, type PresenceFields } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { trafficProxy } from "./traffic.ts";

setDefaultTimeout(60_000);

const BUDGET = { ephDownPerBeacon: 1 } as const;
const LISTENERS = 4;
const BEACONS = 10;

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-budget-presence-"));
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;
const fibers: Fiber.Fiber<void>[] = [];

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
});
afterAll(async () => {
  for (const f of fibers) await Effect.runPromise(Fiber.interrupt(f));
  proxy?.stop();
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

function watch(ch: Channel, presence: boolean, on: (ev: Live) => void): void {
  const run = Stream.runForEach(ch.fx.live(0, { presence }), (ev) => Effect.sync(() => on(ev))).pipe(Effect.provide(AgentLive)) as Effect.Effect<void>;
  fibers.push(Effect.runFork(run));
}

async function until(pred: () => boolean, label: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(25);
  }
}

describe("presence fan-out", () => {
  test("listeners opened with presence: false are not sent presence frames", async () => {
    const owner = await generateIdentity("human");
    const { access } = await Channel.create(server!.url.origin, owner, { name: "lead" });
    const at = () => new Channel(access, proxy!.url, owner);

    let beacon: ((p: PresenceFields) => Effect.Effect<void>) | null = null;
    watch(at(), true, (ev) => {
      if (ev._tag === "Open") beacon = ev.presence;
    });
    let heard = 0;
    let watcherReady = false;
    watch(at(), true, (ev) => {
      if (ev._tag === "Ready") watcherReady = true;
      if (ev._tag === "Presence" && ev.presence.client === "budget") heard++;
    });
    let ready = 0;
    let quietHeard = 0;
    for (let i = 0; i < LISTENERS; i++) {
      watch(at(), false, (ev) => {
        if (ev._tag === "Ready") ready++;
        if (ev._tag === "Presence") quietHeard++;
      });
    }
    await until(() => beacon !== null && watcherReady && ready === LISTENERS, "every socket open");

    proxy!.reset();
    const send = beacon!;
    for (let i = 0; i < BEACONS; i++) await Effect.runPromise(send({ client: "budget" }));
    await until(() => heard === BEACONS, "the watcher to hear every beacon");
    await Bun.sleep(300);
    const stats = proxy!.reset();

    const up = stats.framesUp.eph ?? 0;
    const down = stats.framesDown.eph ?? 0;
    console.log(`presence: ${up} eph up, ${down} eph down (${(down / BEACONS).toFixed(1)} per beacon; 1 presence:true watcher, ${LISTENERS} presence:false listeners)`);
    expect(up).toBe(BEACONS);
    expect(quietHeard).toBe(0);
    expect(down).toBeLessThanOrEqual(BEACONS * BUDGET.ephDownPerBeacon);
  });
});
