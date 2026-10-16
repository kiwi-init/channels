import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, eachLive, fetchRelay, Relay, type Live } from "../src/client.ts";
import { generateIdentity } from "../src/identity.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

async function until(pred: () => boolean, label: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(25);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-watch-live-"));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

function watch(ch: Channel, quietMs: number): { events: Live[]; status: string[]; stop: () => Promise<void> } {
  const events: Live[] = [];
  const status: string[] = [];
  const program = eachLive(
    ch.fx.live(0, { presence: false, watch: true, quietMs }),
    (ev) => Effect.sync(() => void events.push(ev)),
    (line) => Effect.sync(() => void status.push(line)),
  );
  const fiber = Effect.runFork(Effect.provideService(program, Relay, fetchRelay));
  return { events, status, stop: () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined) };
}

test("a watch connection says when the relay is back after an outage", async () => {
  let server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const port = server.port;
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(relay, owner, { name: "human" });
  const w = watch(new Channel(access, relay, owner), 300);
  try {
    await until(() => w.events.some((e) => e._tag === "Ready"), "the first ready");

    server.stop(true);
    await until(() => w.status.length >= 1, "the outage line");
    server = startRelay({ port, hostname: "127.0.0.1", dataDir });
    await until(() => w.status.length >= 2, "the line when the relay is back");

    expect(w.status[0]).toMatch(/can't reach the relay for \d+s/);
    expect(w.status[1]).toMatch(/reconnected after \d+s; nothing was missed/);
    const opens = w.events.filter((e): e is Extract<Live, { _tag: "Open" }> => e._tag === "Open");
    expect(opens.at(-1)?.outage).toBeGreaterThan(0);
  } finally {
    await w.stop();
    server.stop(true);
  }
});

test("a watch connection takes the new key when the channel rotates", async () => {
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(relay, owner, { name: "human" });
  const watching = new Channel(access, relay, owner);
  const w = watch(watching, 1_500);
  try {
    await until(() => w.events.some((e) => e._tag === "Ready"), "the first ready");

    const next = await new Channel(access, relay, owner).rotate();
    await until(() => watching.access.epoch === next, "the new epoch on the watching channel");
    expect(watching.access.keys[String(next)]).toBeDefined();
  } finally {
    await w.stop();
    server.stop(true);
  }
});
