import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { fetchRelay, Relay, RelayError, Unreachable } from "@kiwi/core/client.ts";
import type { CallInit, RelayApi } from "@kiwi/core/client/relay.ts";
import { AFTER_SKEW_MS } from "@kiwi/core/protocol.ts";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { LocalFiles } from "../src/config.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const bareHome = mkdtempSync(join(tmpdir(), "kiwi-lease-throttle-bare-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-lease-throttle-relay-"));
const home = mkdtempSync(join(tmpdir(), "kiwi-lease-throttle-home-"));
const was = process.env.KIWI_HOME;
let server: ReturnType<typeof startRelay>;
let owner: OwnerSetup;
let ann: AgentSession;
let bob: AgentSession;
let cat: AgentSession;
let annAgain: () => AgentSession;

let ticker: ReturnType<typeof setInterval> | undefined;
const clockAt = (at: number) => {
  clearInterval(ticker);
  const real = performance.now();
  setSystemTime(new Date(at));
  ticker = setInterval(() => setSystemTime(new Date(at + performance.now() - real)), 5);
};

const limited = { reads: 0, until: 0, gets: 0, only: [] as number[] };
const write = { lateAt: 0, interject: false, lost: false, refused: [] as string[] };
const historyRead = (path: string, init?: { method?: string }) => {
  if (path !== "/messages" || (init?.method ?? "GET") !== "GET") return false;
  limited.gets++;
  return Date.now() < limited.until || limited.only.includes(limited.gets);
};
const appending = (path: string, init?: { method?: string }) => init?.method === "POST" && (path === "/messages" || path.startsWith("/messages/after/"));
const tooMany = () =>
  Effect.andThen(
    Effect.sync(() => limited.reads++),
    Effect.fail(new RelayError(429, "too many history reads; wait a minute", "TooMany", null)),
  );
type Params = Record<string, string | number>;
const conditional: RelayApi["conditional"] = <T>(relay: string, roomId: string, path: string, etag: string | null, init?: CallInit, params?: Params) => {
  if (historyRead(path, init)) return tooMany();
  const real = fetchRelay.conditional<T>(relay, roomId, path, etag, init, params);
  if (!appending(path, init)) return real;
  return Effect.gen(function* () {
    if (write.lateAt) {
      clockAt(write.lateAt);
      write.lateAt = 0;
    }
    if (write.interject) {
      write.interject = false;
      yield* Effect.promise(() => run(bob.send("a word in between")));
    }
    const got = yield* Effect.tapError(real, (err) => Effect.sync(() => void (err instanceof RelayError && write.refused.push(err.tag))));
    if (!write.lost) return got;
    write.lost = false;
    return yield* new Unreachable({ cause: new Error("the connection dropped before the answer came back") });
  });
};
const throttled: RelayApi = {
  ...fetchRelay,
  conditional,
  call: <T>(relay: string, roomId: string, path: string, init?: CallInit, params?: Params) =>
    Effect.flatMap(conditional<T>(relay, roomId, path, null, init, params), (a) => (a.fresh ? Effect.succeed(a.data) : Effect.die(new Error("not modified")))),
};
const ThrottledLive = Layer.mergeAll(Layer.succeed(Relay, throttled), LocalFiles);

const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
const runLimited = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(ThrottledLive)) as Effect.Effect<A, E, never>);

const annTakes = async (name: string, since: number) => {
  const { messages } = await run(bob.state());
  return messages.filter((m) => m.from === "ann" && m.seq > since && (m.ev?.op === "lease.take" || m.ev?.op === "lease.free") && m.ev.name === name).map((m) => ({ op: m.ev?.op, at: m.rts ?? m.ts }));
};
const headNow = async () => (await run(bob.state())).state.head;

beforeAll(async () => {
  process.env.KIWI_HOME = home;
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  owner = await setupChannel(server.url.origin, { ownerName: "jon" });
  const computer = await pairComputer(owner.person);
  const session = async (name: string) => {
    const { id, ch } = await joinAgent(owner, name, computer);
    return new AgentSession("leases", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
  };
  const annSeat = await joinAgent(owner, "ann", computer);
  annAgain = () => new AgentSession("leases", { ...annSeat.ch.access, relay: owner.relay, code: owner.code }, annSeat.id, () => {});
  ann = annAgain();
  bob = await session("bob");
  cat = await session("cat");
});
afterEach(() => {
  clearInterval(ticker);
  setSystemTime();
  Object.assign(limited, { reads: 0, until: 0, gets: 0, only: [] });
  Object.assign(write, { lateAt: 0, interject: false, lost: false, refused: [] });
});
afterAll(() => {
  server.stop(true);
  if (was === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = was;
  for (const d of [dataDir, home, bareHome]) rmSync(d, { recursive: true, force: true });
});

test("a renewal under a short read limit retries and keeps the lease", async () => {
  const held = await run(ann.lease("build", 120));
  expect(held.holder).toBe("ann");
  await run(bob.lease("build", 120));
  limited.until = Date.now() + 2_500;
  const renewed = await runLimited(ann.lease("build", 600));
  expect(limited.reads).toBeGreaterThan(0);
  expect(renewed).toMatchObject({ holder: "ann", since: held.since });
  expect(renewed.until).toBeGreaterThan(held.until);
  expect(renewed.queue.map((q) => q.name)).toEqual(["bob"]);
  await run(ann.unlease("build"));
  await run(bob.unlease("build"));
});

test("a read limit that clears shortly before the last safe moment still renews, with an ordinary take stored before the old expiry; a seat that never posted, asking after that expiry, waits behind it", async () => {
  const held = await run(ann.lease("pack", 60));
  await run(bob.lease("pack", 60));
  const from = await headNow();
  clockAt(held.until - AFTER_SKEW_MS - 9_000);
  limited.until = held.until - AFTER_SKEW_MS - 3_500;
  const renewed = await runLimited(ann.lease("pack", 600));
  expect(limited.reads).toBeGreaterThanOrEqual(3);
  expect(renewed).toMatchObject({ holder: "ann", since: held.since });
  const takes = await annTakes("pack", from);
  expect(takes.map((t) => t.op)).toEqual(["lease.take"]);
  expect(takes[0]!.at).toBeLessThan(held.until - AFTER_SKEW_MS);
  clockAt(held.until + 5_000);
  const waits = await run(cat.lease("pack", 60));
  expect(waits).toMatchObject({ holder: "ann", since: held.since });
  expect(waits.queue.map((q) => q.name)).toEqual(["bob", "cat"]);
});

test("a read limit that lasts into the last ten seconds fails without sending anything, and the next in line holds it once the hold ends", async () => {
  const held = await run(ann.lease("deploy", 60));
  await run(bob.lease("deploy", 60));
  const from = await headNow();
  clockAt(held.until - AFTER_SKEW_MS - 3_000);
  limited.until = Number.MAX_SAFE_INTEGER;
  const failed = await runLimited(ann.lease("deploy", 600)).then(
    () => null,
    (err: unknown) => ({ err: String(err), at: Date.now() }),
  );
  expect(failed?.err).toContain("your hold on deploy ends at");
  expect(failed?.err).toContain("so none was sent");
  expect(failed?.at).toBeGreaterThanOrEqual(held.until - AFTER_SKEW_MS);
  expect(limited.reads).toBeGreaterThan(0);
  limited.until = 0;
  clockAt(held.until + 1_000);
  const lease = (await run(bob.state())).state.leases.get("deploy");
  expect(lease?.holder).toBe("bob");
  expect(lease?.queue.map((q) => q.name)).toEqual([]);
  expect(await annTakes("deploy", from)).toEqual([]);
});

test("a renewal whose write is delayed past the expiry is refused by the relay, with no one waiting: nothing is stored and no hold is left", async () => {
  const held = await run(ann.lease("ship", 60));
  const from = await headNow();
  write.lateAt = held.until + 1_000;
  await expect(runLimited(ann.lease("ship", 600))).rejects.toThrow("your hold on ship ended before it could be renewed, so none was sent");
  expect(write.refused).toEqual(["OffClock"]);
  expect((await run(bob.state())).state.leases.get("ship")?.holder).toBeUndefined();
  expect(await annTakes("ship", from)).toEqual([]);
});

test("a renewal whose write is delayed past the expiry is refused by the relay, with a seat waiting: that seat holds it and the old holder isn't in line", async () => {
  const held = await run(ann.lease("cut", 60));
  await run(bob.lease("cut", 60));
  const from = await headNow();
  write.lateAt = held.until + 1_000;
  await expect(runLimited(ann.lease("cut", 600))).rejects.toThrow("your hold on cut ended before it could be renewed, so none was sent");
  expect(write.refused).toEqual(["OffClock"]);
  const lease = (await run(bob.state())).state.leases.get("cut");
  expect(lease).toMatchObject({ holder: "bob", since: held.until });
  expect(lease?.queue.map((q) => q.name)).toEqual([]);
  expect(await annTakes("cut", from)).toEqual([]);
});

test("a message that lands between the read and the renewal makes the relay refuse it once; the renewal reads again and lands", async () => {
  const held = await run(ann.lease("tag", 120));
  const from = await headNow();
  write.interject = true;
  const renewed = await runLimited(ann.lease("tag", 600));
  expect(write.refused).toEqual(["MovedOn"]);
  expect(renewed).toMatchObject({ holder: "ann", since: held.since });
  expect((await annTakes("tag", from)).map((t) => t.op)).toEqual(["lease.take"]);
  await run(ann.unlease("tag"));
});

test("a renewal whose answer is lost is sent again under the same send id: the relay keeps the one copy, stored before the expiry, and the hold is still ann's after the old deadline", async () => {
  const held = await run(ann.lease("sign", 60));
  await run(bob.lease("sign", 60));
  const from = await headNow();
  write.lost = true;
  const renewed = await runLimited(ann.lease("sign", 600));
  expect(renewed).toMatchObject({ holder: "ann", since: held.since });
  const takes = await annTakes("sign", from);
  expect(takes.map((t) => t.op)).toEqual(["lease.take"]);
  expect(takes[0]!.at).toBeLessThan(held.until - AFTER_SKEW_MS);
  clockAt(held.until + 5_000);
  const lease = (await run(bob.state())).state.leases.get("sign");
  expect(lease).toMatchObject({ holder: "ann", since: held.since });
  expect(lease?.queue.map((q) => q.name)).toEqual(["bob"]);
});

test("a limit that comes and goes, refusing the first and third history reads of the renewal, is retried at every read: renewed with one take", async () => {
  const held = await run(ann.lease("roll", 120));
  await run(bob.lease("roll", 120));
  const from = await headNow();
  Object.assign(limited, { gets: 0, only: [1, 3] });
  const renewed = await runLimited(ann.lease("roll", 600));
  expect(limited.reads).toBe(2);
  expect(renewed).toMatchObject({ holder: "ann", since: held.since });
  expect(renewed.until).toBeGreaterThan(held.until);
  expect(renewed.queue.map((q) => q.name)).toEqual(["bob"]);
  expect((await annTakes("roll", from)).map((t) => t.op)).toEqual(["lease.take"]);
  await run(ann.unlease("roll"));
  await run(bob.unlease("roll"));
});

test("a limit that refuses every other history read still renews, with one take", async () => {
  const held = await run(ann.lease("flip", 120));
  const from = await headNow();
  Object.assign(limited, { gets: 0, only: [1, 3, 5, 7, 9, 11] });
  const renewed = await runLimited(ann.lease("flip", 600));
  expect(limited.reads).toBeGreaterThanOrEqual(2);
  expect(renewed).toMatchObject({ holder: "ann", since: held.since });
  expect((await annTakes("flip", from)).map((t) => t.op)).toEqual(["lease.take"]);
  await run(ann.unlease("flip"));
});

test("on a computer with no copy of the channel, a limited first read is retried too, so the renewal still goes out guarded", async () => {
  const held = await run(ann.lease("cold", 120));
  await run(bob.lease("cold", 120));
  const from = await headNow();
  process.env.KIWI_HOME = bareHome;
  try {
    Object.assign(limited, { gets: 0, only: [1, 2] });
    const renewed = await runLimited(annAgain().lease("cold", 600));
    expect(limited.reads).toBe(2);
    expect(renewed).toMatchObject({ holder: "ann", since: held.since });
    expect(renewed.queue.map((q) => q.name)).toEqual(["bob"]);
  } finally {
    process.env.KIWI_HOME = home;
  }
  expect((await annTakes("cold", from)).map((t) => t.op)).toEqual(["lease.take"]);
  await run(ann.unlease("cold"));
  await run(bob.unlease("cold"));
});
