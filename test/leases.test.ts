import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession, wants } from "../src/agent.ts";
import { formatStatus, leaseLine, statusJson } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormedEvent, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, LEASE_WAIT_MS, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event, at: number, to?: string[]): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: at, ...(to ? { to } : {}) });
  return { ...p, seq, rts: at, sigOk: await verify(p) };
}
const take = (from: string, at: number, minutes = 30, note?: string) => ev(from, { op: "lease.take", name: "build", ttl: minutes * 60, ...(note ? { note } : {}) }, at);
const free = (from: string, at: number, to?: string[]) => ev(from, { op: "lease.free", name: "build" }, at, to);

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ann", "bob", "cat"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "bob", pk: ids.bob!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "cat", pk: ids.cat!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

describe("a lease in fold", () => {
  test("the first to ask holds it; the rest wait in line, in log order", async () => {
    const ms = [await take("ann", T0, 30, "release 0.18"), await take("bob", T0 + 1000), await take("cat", T0 + 2000)];
    const l = fold(ms, roster, T0 + MIN).leases.get("build")!;
    expect(l).toMatchObject({ holder: "ann", until: T0 + 30 * MIN, note: "release 0.18" });
    expect(l.queue.map((q) => q.name)).toEqual(["bob", "cat"]);
  });

  test("letting go hands it to the next in line at once, with the time they asked for", async () => {
    const ms = [await take("ann", T0), await take("bob", T0 + 1000, 10), await free("ann", T0 + 5 * MIN, ["bob"])];
    const s = fold(ms, roster, T0 + 6 * MIN);
    expect(s.leases.get("build")).toMatchObject({ holder: "bob", since: T0 + 5 * MIN, until: T0 + 15 * MIN, queue: [] });
    expect(wants("bob", ms[2]!, s)).toBe(true);
    expect(wants("cat", ms[2]!, s)).toBe(false);
  });

  test("when it runs out, the next in line holds it from then; with no one waiting it's gone", async () => {
    const ms = [await take("ann", T0, 10), await take("bob", T0 + 1000, 20)];
    expect(fold(ms, roster, T0 + 15 * MIN).leases.get("build")).toMatchObject({ holder: "bob", since: T0 + 10 * MIN, until: T0 + 30 * MIN });
    expect(fold(ms, roster, T0 + 31 * MIN).leases.has("build")).toBe(false);
  });

  test("asking again renews your own; a wait gives up after a while", async () => {
    const renew = fold([await take("ann", T0, 10), await take("ann", T0 + 5 * MIN, 10)], roster, T0 + 6 * MIN).leases.get("build")!;
    expect(renew).toMatchObject({ holder: "ann", since: T0, until: T0 + 15 * MIN });
    const long = [await take("ann", T0, 24 * 60), await take("bob", T0 + 1000)];
    expect(fold(long, roster, T0 + LEASE_WAIT_MS + MIN).leases.get("build")!.queue).toEqual([]);
  });

  test("an agent lets go only of its own; a person may free anyone's; leaving the line works too", async () => {
    const ms = [await take("ann", T0), await take("bob", T0 + 1000), await take("cat", T0 + 2000)];
    const steal = await free("bob", T0 + 3000);
    const s = fold([...ms, steal], roster, T0 + MIN);
    expect(s.leases.get("build")!.holder).toBe("ann");
    expect(s.leases.get("build")!.queue.map((q) => q.name)).toEqual(["cat"]);
    const stranger = await ev("cat", { op: "lease.free", name: "deploy" }, T0 + 4000);
    expect(fold([...ms, stranger], roster, T0 + MIN).rejected.get(stranger.seq)).toBe("cat neither holds nor waits for deploy");
    const broken = fold([...ms, await free("jon", T0 + 5000)], roster, T0 + MIN).leases.get("build")!;
    expect(broken.holder).toBe("bob");
  });

  test("a fold resumed from a snapshot base agrees with the whole log", async () => {
    const ms = [await take("ann", T0, 10), await take("bob", T0 + 1000, 20), await take("cat", T0 + 2000), await free("ann", T0 + 3 * MIN)];
    let base: FoldBase | null = null;
    fold(ms.slice(0, 2), roster, T0 + MIN, null, null, null, (b) => {
      base = b;
    });
    expect(fold(ms, roster, T0 + 4 * MIN, null, null, base).leases).toEqual(fold(ms, roster, T0 + 4 * MIN).leases);
  });

  test("names and times are checked on the wire", () => {
    expect(wellFormedEvent({ op: "lease.take", name: "build", ttl: 600 })).toBe(true);
    expect(wellFormedEvent({ op: "lease.take", name: "Build Lock", ttl: 600 })).toBe(false);
    expect(wellFormedEvent({ op: "lease.take", name: "build", ttl: 10 })).toBe(false);
    expect(wellFormedEvent({ op: "lease.take", name: "build", ttl: 25 * 3600 })).toBe(false);
    expect(wellFormedEvent({ op: "lease.free", name: "release/0.18" })).toBe(true);
  });

  test("status shows who holds it, how long is left and who's next, not a chat line", async () => {
    const ms = [await take("ann", T0, 30, "release 0.18"), await take("bob", T0 + 1000)];
    const s = fold(ms, roster, T0 + 10 * MIN);
    const l = s.leases.get("build")!;
    expect(leaseLine(l, "bob", T0 + 10 * MIN)).toBe("build: ann, 20m left: release 0.18 · next: you");
    expect(formatStatus({ alias: "c", me: "bob", state: s, online: new Map(), unread: 0, now: T0 + 10 * MIN })).toContain("leases:\n  build: ann, 20m left");
    expect(statusJson({ alias: "c", me: "bob", state: s, online: new Map(), unread: 0 }).leases).toEqual([
      { name: "build", holder: "ann", until: T0 + 30 * MIN, note: "release 0.18", queue: ["bob"] },
    ]);
    for (const n of ["bob", "cat", "jon"]) expect(wants(n, ms[0]!, s)).toBe(false);
  });
});

describe("over a relay", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-leases-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-leases-home-"));
  const was = process.env.KIWI_HOME;
  let server: ReturnType<typeof startRelay>;
  let owner: OwnerSetup;
  let ann: AgentSession;
  let bob: AgentSession;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    const computer = await pairComputer(owner.person);
    const session = async (name: string) => {
      const { id, ch } = await joinAgent(owner, name, computer);
      return new AgentSession("leases", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
    };
    ann = await session("ann");
    bob = await session("bob");
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("two agents ask at once: one holds it, the other waits; letting go hands it over and tells them", async () => {
    const [a, b] = await Promise.all([run(ann.lease("deploy", 600)), run(bob.lease("deploy", 600))]);
    const holder = a.holder!;
    expect(["ann", "bob"]).toContain(holder);
    const [first, second] = holder === "ann" ? [ann, bob] : [bob, ann];
    const waiting = holder === "ann" ? "bob" : "ann";
    expect((holder === "ann" ? b : a).queue.map((q) => q.name)).toEqual([waiting]);
    const { next, state } = await run(first.unlease("deploy"));
    expect(next).toBe(waiting);
    expect(state.leases.get("deploy")!.holder).toBe(waiting);
    const { messages, state: theirs } = await run(second.state());
    const handed = messages.filter((m) => m.ev?.op === "lease.free").at(-1)!;
    expect(wants(waiting, handed, theirs)).toBe(true);
    await expect(run(first.unlease("deploy"))).rejects.toThrow("you neither hold nor wait for deploy");
    await expect(run(first.lease("Deploy Now", 600))).rejects.toThrow("lowercase letters");
  });
});
