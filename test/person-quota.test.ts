import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import * as Layer from "effect/Layer";
import { GithubApp, GithubPush } from "../src/relay/github-app.ts";
import { githubHumanAuth, Human } from "../src/relay/human.ts";
import { Directory, leaseTake, onClientFrame, RoomDb, type Sql } from "../src/relay/room.ts";
import { makeRelay, runRoomSync } from "../src/relay/route.ts";
import { grantFor, LEASE_BATCH, limitOf, PeopleBook, type Plan } from "../src/relay/people.ts";
import { OPEN_POLICY, Policy, policyFrom, upgradeFor, type RelayPolicy } from "../src/relay/policy.ts";
import { stripeSignature } from "../src/relay/stripe.ts";

setDefaultTimeout(30_000);

const CLIENT = "Iv23liQuotaTest";
const PEOPLE: Record<string, number> = { alice: 1, bob: 2, carol: 3 };
const github = (async (_input: string | URL | Request, init?: RequestInit) => {
  const login = /^ghu_([a-z]+)_0+$/.exec((JSON.parse(String(init?.body ?? "{}")) as { access_token?: string }).access_token ?? "")?.[1];
  const id = login ? PEOPLE[login] : undefined;
  return id ? Response.json({ app: { client_id: CLIENT }, user: { id, login, name: null, email: null } }) : new Response("not found", { status: 404 });
}) as typeof fetch;
const human = githubHumanAuth({ clientId: CLIENT, clientSecret: "secret" }, github)!;
const token = (login: string) => `ghu_${login}_${"0".repeat(24)}`;

const dirs: string[] = [];
const servers: ReturnType<typeof startRelay>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const STRIPE_SECRET = "whsec_test";

function relayWith(policy: Partial<RelayPolicy>, clock = { now: Date.UTC(2026, 10, 8, 23, 50) }) {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-person-quota-"));
  dirs.push(dataDir);
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human, stripeWebhookSecret: STRIPE_SECRET, policy: { ...OPEN_POLICY, ...policy }, now: () => clock.now });
  servers.push(server);
  return { relay: server.url.origin, dataDir, clock };
}

async function channelOf(relay: string, login: string) {
  const owner = await generateIdentity(login);
  const { access } = await Channel.create(relay, owner, { name: login, kind: "human" }, [], undefined, token(login));
  return new Channel(access, relay, owner);
}

function setPlan(dataDir: string, user: string, plan: Plan, blocked = false) {
  const db = new Database(join(dataDir, "people.sqlite"));
  new PeopleBook({ run: (q, ...p) => void db.query(q).run(...p), all: <T>(q: string, ...p: (string | number | null)[]) => db.query(q).all(...p) as T[] }).setPerson(user, { plan, blocked });
  db.close();
}

describe("settings", () => {
  test("the person quota, the paid quota, the upgrade link and admins come from the environment", () => {
    expect(policyFrom({ KIWI_QUOTA_PERSON_MESSAGES_PER_DAY: "500", KIWI_QUOTA_PAID_MESSAGES_PER_DAY: "3000", KIWI_UPGRADE_URL: " https://x/up ", KIWI_ADMINS: "github_1, GitHub_2" })).toMatchObject({
      personMessagesPerDay: 500,
      paidMessagesPerDay: 3000,
      upgradeUrl: "https://x/up",
      admins: ["github_1", "github_2"],
    });
    expect(policyFrom({})).toMatchObject({ personMessagesPerDay: null, paidMessagesPerDay: null, upgradeUrl: null, admins: [] });
  });

  test("each plan's limit, and grants that never pass it", () => {
    const ask = { free: 500, paid: 3000, admin: false };
    expect(limitOf("free", ask)).toBe(500);
    expect(limitOf("paid", ask)).toBe(3000);
    expect(limitOf("paid", { ...ask, paid: null })).toBe(500);
    expect(limitOf("unlimited", ask)).toBeNull();
    expect(limitOf("free", { ...ask, admin: true })).toBeNull();
    expect(grantFor(0, 500)).toBe(LEASE_BATCH);
    expect(grantFor(495, 500)).toBe(2);
    expect(grantFor(499, 500)).toBe(1);
    expect(grantFor(500, 500)).toBe(0);
    expect(grantFor(10_000, null)).toBe(LEASE_BATCH);
  });

  test("grants across a person's channels add up to the limit and no more; a new day starts over", () => {
    const db = new Database(":memory:");
    const book = new PeopleBook({ run: (q, ...p) => void db.query(q).run(...p), all: <T>(q: string, ...p: (string | number | null)[]) => db.query(q).all(...p) as T[] });
    const ask = (room: string, day: string, used = 0) => ({ room, day, used, free: 50, paid: null, admin: false });
    let total = 0;
    for (let i = 0; i < 40; i++) total += book.lease("github_1", ask(`r${i % 3}`, "2026-11-08")).grant;
    expect(total).toBe(50);
    expect(book.lease("github_2", ask("r9", "2026-11-08")).grant).toBe(grantFor(0, 50));
    book.lease("github_1", ask("r0", "2026-11-08", 30));
    expect(book.usedOn("github_1", "2026-11-08")).toBe(30);
    expect(book.lease("github_1", ask("r0", "2026-11-09")).grant).toBe(grantFor(0, 50));
    expect(book.usedOn("github_1", "2026-11-08")).toBe(0);
  });
});

describe("messages per person per day", () => {
  test("one owner's channels share the quota; others aren't affected; the next UTC day starts over", async () => {
    const { relay, clock } = relayWith({ personMessagesPerDay: 3, upgradeUrl: "https://kiwi.test/upgrade" });
    const [one, two, bobs] = [await channelOf(relay, "alice"), await channelOf(relay, "alice"), await channelOf(relay, "bob")];
    await one.send("a");
    await one.send("b");
    await two.send("c");
    const over = { status: 429, message: expect.stringMatching(/used today's 3 messages.*00:00 UTC \(in 10m\).*kiwi\.test\/upgrade\?client_reference_id=github_1/) };
    await expect(two.send("one too many")).rejects.toMatchObject(over);
    await expect(one.send("here too")).rejects.toMatchObject(over);
    for (let i = 0; i < 3; i++) await bobs.send(`bob ${i}`);
    clock.now = Date.UTC(2026, 10, 9, 0, 1);
    await one.send("a new day");
  });

  test("the paid plan has its own quota, and an upgrade during the day takes effect within a minute", async () => {
    const { relay, dataDir, clock } = relayWith({ personMessagesPerDay: 2, paidMessagesPerDay: 5 });
    const ch = await channelOf(relay, "carol");
    await ch.send("1");
    await ch.send("2");
    await expect(ch.send("3")).rejects.toMatchObject({ status: 429 });
    setPlan(dataDir, "github_3", "paid");
    await expect(ch.send("3")).rejects.toMatchObject({ status: 429 });
    clock.now += 61_000;
    for (let i = 3; i <= 5; i++) await ch.send(String(i));
    await expect(ch.send("6")).rejects.toMatchObject({ status: 429, message: expect.stringContaining("today's 5 messages") });
  });

  test("admins and unlimited people have no daily limit", async () => {
    const { relay, dataDir } = relayWith({ personMessagesPerDay: 1, admins: ["github_1"] });
    const admin = await channelOf(relay, "alice");
    const unlimited = await channelOf(relay, "bob");
    setPlan(dataDir, "github_2", "unlimited");
    for (let i = 0; i < LEASE_BATCH + 5; i++) {
      await admin.send(`a${i}`);
      await unlimited.send(`b${i}`);
    }
  });

  test("a blocked person can't create channels or post in the ones they own", async () => {
    const { relay, dataDir } = relayWith({ personMessagesPerDay: 100 });
    const ch = await channelOf(relay, "bob");
    setPlan(dataDir, "github_2", "free", true);
    await expect(channelOf(relay, "bob")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("blocked") });
    await expect(ch.send("hi")).rejects.toMatchObject({ status: 403, message: expect.stringContaining("blocked") });
    await channelOf(relay, "alice");
  });

  test("with no person quota configured, signed-in owners post as before", async () => {
    const { relay } = relayWith({});
    const ch = await channelOf(relay, "alice");
    for (let i = 0; i < LEASE_BATCH + 5; i++) await ch.send(`m${i}`);
  });
});

describe("over a socket", () => {
  test("sends spend the channel's lease without waiting or writing (the message row only; the counters are saved every 50), refills come after, and the limit holds exactly", async () => {
    const { relay, dataDir } = relayWith({});
    const id = await generateIdentity("alice");
    const { access } = await Channel.create(relay, id, { name: "alice", kind: "human" }, [], undefined, token("alice"));
    const roomId = access.roomId;
    const owner = id.pk;
    const file = new Database(join(dataDir, `${roomId}.sqlite`));
    const sql: Sql = { run: (q, ...p) => void file.query(q).run(...p), all: <T>(q: string, ...p: (string | number | null)[]) => file.query(q).all(...p) as T[] };
    const mem = new Database(":memory:");
    const book = new PeopleBook({ run: (q, ...p) => void mem.query(q).run(...p), all: <T>(q: string, ...p: (string | number | null)[]) => mem.query(q).all(...p) as T[] });
    const ctx = makeRelay(
      Layer.mergeAll(
        Layer.succeed(Human, null),
        Layer.succeed(GithubApp, null),
        Layer.succeed(GithubPush, null),
        Layer.succeed(Policy, { ...OPEN_POLICY, personMessagesPerDay: 30, noRateLimits: true }),
        Layer.succeed(Directory, {
          list: async () => [],
          reserve: async () => true,
          release: async () => {},
          person: async (u) => book.person(u),
          seen: async () => {},
          lease: async (u, a) => book.lease(u, a),
        }),
      ),
    );
    const writes: string[] = [];
    const counted: Sql = { run: (q, ...p) => (writes.push(`${q} ${String(p[0])}`), sql.run(q, ...p)), all: sql.all };
    const room = () => new RoomDb(counted, roomId);
    let acks = 0;
    let saves = 0;
    let refused = "";
    for (let i = 0; i < 40; i++) {
      writes.length = 0;
      const fx = runRoomSync(ctx, room(), onClientFrame(JSON.stringify({ t: "send", id: `f${i}`, iv: "aXZpdml2aXZpdml2", ct: "Y3Z2", e: 0 }), owner));
      if (JSON.parse(String(fx.reply)).t === "ack") {
        expect(writes.filter((q) => q.startsWith("INSERT INTO msgs"))).toHaveLength(1);
        saves += writes.filter((q) => q.startsWith("INSERT INTO meta") && q.endsWith(" usage")).length;
      }
      const reply = JSON.parse(String(fx.reply)) as { t: string; error?: string };
      if (reply.t === "ack") acks++;
      else refused = reply.error ?? "";
      if (fx.lease) runRoomSync(ctx, room(), leaseTake(book.lease(fx.lease.user, fx.lease.ask), fx.lease.ask.day));
    }
    file.close();
    expect(acks).toBe(30);
    expect(saves).toBeLessThanOrEqual(2);
    expect(refused).toContain("used today's 30 messages");
  });
});

describe("admins", () => {
  const as = (relay: string, login: string, path: string, init: RequestInit = {}) =>
    fetch(`${relay}${path}`, { ...init, headers: { "x-human-token": token(login), "content-type": "application/json", ...init.headers } });

  test("an admin lists people with plan and today's use, and sets a plan or a block", async () => {
    const { relay } = relayWith({ personMessagesPerDay: 2, admins: ["github_1"] });
    const bobs = await channelOf(relay, "bob");
    await bobs.send("1");
    await bobs.send("2");
    await expect(bobs.send("3")).rejects.toMatchObject({ status: 429 });
    const list = (await (await as(relay, "alice", "/v1/admin/people")).json()) as { people: { user: string; login: string | null; plan: string; used: number; channels: number; blocked: boolean }[] };
    expect(list.people.find((p) => p.user === "github_2")).toMatchObject({ login: "bob", plan: "free", used: 2, channels: 1, blocked: false });
    const set = await as(relay, "alice", "/v1/admin/people/github_2", { method: "PUT", body: JSON.stringify({ plan: "unlimited" }) });
    expect(await set.json()).toMatchObject({ user: "github_2", plan: "unlimited", blocked: false });
    const blocked = await as(relay, "alice", "/v1/admin/people/github_2", { method: "PUT", body: JSON.stringify({ blocked: true }) });
    expect(await blocked.json()).toMatchObject({ plan: "unlimited", blocked: true });
    await expect(channelOf(relay, "bob")).rejects.toMatchObject({ status: 403 });
    expect((await as(relay, "alice", "/v1/admin/people/github_2", { method: "PUT", body: JSON.stringify({ plan: "gold" }) })).status).toBe(400);
  });

  test("anyone else is refused, signed in or not", async () => {
    const { relay } = relayWith({ personMessagesPerDay: 2, admins: ["github_1"] });
    expect((await as(relay, "bob", "/v1/admin/people")).status).toBe(403);
    expect((await as(relay, "bob", "/v1/admin/people/github_2", { method: "PUT", body: JSON.stringify({ plan: "unlimited" }) })).status).toBe(403);
    expect((await fetch(`${relay}/v1/admin/people`)).status).toBe(401);
  });
});

describe("today's use", () => {
  test("a signed-in person reads their plan, today's count, the limit and when it resets", async () => {
    const clock = { now: Date.UTC(2026, 10, 8, 21, 0) };
    const { relay } = relayWith({ personMessagesPerDay: 5, paidMessagesPerDay: 50, upgradeUrl: "https://kiwi.test/upgrade", admins: ["github_1"] }, clock);
    const ch = await channelOf(relay, "bob");
    await ch.send("1");
    await ch.send("2");
    const read = async (login: string) => (await fetch(`${relay}/v1/me/usage`, { headers: { "x-human-token": token(login) } })).json();
    const bob = (await read("bob")) as { used: number };
    expect(bob).toMatchObject({ plan: "free", blocked: false, limit: 5, channels: 1, resetsAt: Date.UTC(2026, 10, 9), upgradeUrl: "https://kiwi.test/upgrade?client_reference_id=github_2" });
    expect(bob.used).toBeGreaterThanOrEqual(1);
    expect(bob.used).toBeLessThanOrEqual(2);
    expect(await read("alice")).toMatchObject({ plan: "unlimited", limit: null, used: 0 });
    expect((await fetch(`${relay}/v1/me/usage`)).status).toBe(401);
  });

  test("an admin also reads how many people use the relay and how many were on it today; nobody else does (spec #131)", async () => {
    const clock = { now: Date.UTC(2026, 10, 8, 21, 0) };
    const { relay } = relayWith({ personMessagesPerDay: 5, admins: ["github_1"] }, clock);
    const read = async (login: string) => (await (await fetch(`${relay}/v1/me/usage`, { headers: { "x-human-token": token(login) } })).json()) as { people?: { total: number; today: number } };
    await (await channelOf(relay, "bob")).send("hi");
    clock.now = Date.UTC(2026, 10, 9, 9, 0);
    await (await channelOf(relay, "carol")).send("hi");
    expect((await read("alice")).people).toEqual({ total: 2, today: 1 });
    expect((await read("bob")).people).toBeUndefined();
    clock.now = Date.UTC(2026, 10, 10, 9, 0);
    expect((await read("alice")).people).toEqual({ total: 2, today: 0 });
  });

  test("with no quota configured there's no limit to show", async () => {
    const { relay } = relayWith({});
    await channelOf(relay, "bob");
    expect(await (await fetch(`${relay}/v1/me/usage`, { headers: { "x-human-token": token("bob") } })).json()).toMatchObject({ limit: null });
  });
});

describe("Stripe", () => {
  const hook = async (relay: string, clock: { now: number }, event: object, secret = STRIPE_SECRET, at = Math.floor(clock.now / 1000)) => {
    const body = JSON.stringify(event);
    return fetch(`${relay}/v1/stripe/webhook`, { method: "POST", headers: { "stripe-signature": `t=${at},v1=${await stripeSignature(secret, body, at)}` }, body });
  };
  const usage = async (relay: string, login: string) => (await (await fetch(`${relay}/v1/me/usage`, { headers: { "x-human-token": token(login) } })).json()) as { plan: string; limit: number };

  test("a paid checkout moves the person to paid; a lapsed or cancelled subscription moves them back", async () => {
    const clock = { now: Date.UTC(2026, 10, 8, 12) };
    const { relay } = relayWith({ personMessagesPerDay: 5, paidMessagesPerDay: 50 }, clock);
    await channelOf(relay, "bob");
    const paid = await hook(relay, clock, { type: "checkout.session.completed", data: { object: { client_reference_id: "github_2", customer: "cus_1", payment_status: "paid" } } });
    expect(await paid.json()).toEqual({ ok: true, did: "paid" });
    expect(await usage(relay, "bob")).toMatchObject({ plan: "paid", limit: 50 });
    await hook(relay, clock, { type: "customer.subscription.updated", data: { object: { customer: "cus_1", status: "past_due" } } });
    expect(await usage(relay, "bob")).toMatchObject({ plan: "free", limit: 5 });
    await hook(relay, clock, { type: "customer.subscription.updated", data: { object: { customer: "cus_1", status: "active" } } });
    expect((await usage(relay, "bob")).plan).toBe("paid");
    await hook(relay, clock, { type: "customer.subscription.deleted", data: { object: { customer: "cus_1", status: "canceled" } } });
    expect((await usage(relay, "bob")).plan).toBe("free");
  });

  test("Stripe never lowers an unlimited person, and ignores what it doesn't know", async () => {
    const clock = { now: Date.UTC(2026, 10, 8, 12) };
    const { relay, dataDir } = relayWith({ personMessagesPerDay: 5 }, clock);
    setPlan(dataDir, "github_3", "unlimited");
    await hook(relay, clock, { type: "checkout.session.completed", data: { object: { client_reference_id: "github_3", customer: "cus_3", payment_status: "paid" } } });
    await hook(relay, clock, { type: "customer.subscription.deleted", data: { object: { customer: "cus_3" } } });
    expect((await usage(relay, "carol")).plan).toBe("unlimited");
    expect(await (await hook(relay, clock, { type: "invoice.paid", data: { object: {} } })).json()).toEqual({ ok: true, did: "ignored" });
    expect(await (await hook(relay, clock, { type: "customer.subscription.deleted", data: { object: { customer: "cus_nobody" } } })).json()).toEqual({ ok: true, did: "unknown customer" });
    expect(await (await hook(relay, clock, { type: "checkout.session.completed", data: { object: { client_reference_id: "alice" } } })).json()).toEqual({ ok: true, did: "no person on the session" });
  });

  test("a bad or stale signature is refused and changes nothing", async () => {
    const clock = { now: Date.UTC(2026, 10, 8, 12) };
    const { relay } = relayWith({ personMessagesPerDay: 5 }, clock);
    await channelOf(relay, "bob");
    const event = { type: "checkout.session.completed", data: { object: { client_reference_id: "github_2", payment_status: "paid" } } };
    expect((await hook(relay, clock, event, "whsec_wrong")).status).toBe(401);
    expect((await hook(relay, clock, event, STRIPE_SECRET, Math.floor(clock.now / 1000) - 600)).status).toBe(401);
    expect((await fetch(`${relay}/v1/stripe/webhook`, { method: "POST", body: JSON.stringify(event) })).status).toBe(401);
    expect((await usage(relay, "bob")).plan).toBe("free");
  });

  test("upgrade links carry who's paying", () => {
    expect(upgradeFor("https://buy.stripe.com/abc", "github_9")).toBe("https://buy.stripe.com/abc?client_reference_id=github_9");
    expect(upgradeFor(null, "github_9")).toBeNull();
  });
});
