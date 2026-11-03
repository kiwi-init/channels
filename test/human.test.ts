// Sign-in at the relay: GitHub sign-in, and the one gate it guards (creating
// channels). Everything after creation takes member keys alone: owners approve by their owner
// key's signature, agents join with computer claims and people with person claims.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, relayConfig } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { githubHumanAuth, NO_ONE } from "../src/relay/human.ts";
import { HOLD_MS, holdEntry, reserveSlot } from "../src/relay/room.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { WS_PROTOCOL } from "@kiwi/core/protocol.ts";
import { claimComputer, provePerson } from "@kiwi/core/person.ts";
import { checked, checkedByHand } from "./check.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel } from "./owner.ts";

setDefaultTimeout(30_000);

// A stand-in for GitHub's check-token API: token(login) is a GitHub user token for that login,
// which the relay's GitHub App issued. Alice and Carol have names and emails; the rest have neither.
const CLIENT = "Iv23liHumanTest";
const SECRET = "test-secret";
const PEOPLE: Record<string, { id: number; name: string | null; email: string | null }> = {
  alice: { id: 1, name: "Alice Owner", email: "alice@example.com" },
  bob: { id: 2, name: null, email: null },
  carol: { id: 3, name: "Carol Coder", email: "carol@example.com" },
  dana: { id: 4, name: null, email: null },
  erin: { id: 5, name: null, email: null },
};
const github = (async (_input: string | URL | Request, init?: RequestInit) => {
  const login = /^ghu_([a-z]+)_0+$/.exec((JSON.parse(String(init?.body ?? "{}")) as { access_token?: string }).access_token ?? "")?.[1];
  const p = login ? PEOPLE[login] : undefined;
  return p ? Response.json({ app: { client_id: CLIENT }, user: { id: p.id, login, name: p.name, email: p.email } }) : new Response("not found", { status: 404 });
}) as typeof fetch;

async function token(login: string): Promise<string> {
  return `ghu_${login}_${"0".repeat(24)}`;
}

const human = githubHumanAuth({ clientId: CLIENT, clientSecret: SECRET }, github)!;
const dataDir = mkdtempSync(join(tmpdir(), "mc-relay-"));
let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("a relay that requires sign-in", () => {
  test("advertises GitHub sign-in", async () => {
    expect(await relayConfig(relay)).toEqual({ githubSignIn: true });
  });

  test("only a signed-in human can create a channel; anyone with the code can ask to join", async () => {
    const [owner, agent] = await Promise.all([generateIdentity("human"), generateIdentity("mac")]);
    // No session: refused.
    await expect(Channel.create(relay, owner, { name: "human" })).rejects.toMatchObject({ status: 401 });

    const alice = await token("alice");
    const { code, access } = await Channel.create(relay, owner, { name: "human" }, [], undefined, alice);
    // No session, no vouch: asking is open.
    const req = await Channel.requestJoin(relay, code, agent, { name: "mac" });
    expect(req.requestId).toBeTruthy();

    // The owner key alone (e.g. an agent that copied it) sees and approves requests.
    const keyOnly = new Channel(access, relay, owner);
    const pending = await checked(keyOnly, relay, code, [{ id: agent, requestId: req.requestId }]);
    expect(pending.map((r) => r.code)).toEqual([((await Channel.joinStatus(relay, code, agent, req.requestId)) as { code: string }).code]);
    await keyOnly.approve(pending[0]!);
    expect((await Channel.joinStatus(relay, code, agent, req.requestId)).status).toBe("approved");

    // Members still talk with their keys alone; sign-in is only for creating.
    const st = await Channel.joinStatus(relay, code, agent, req.requestId);
    if (st.status !== "approved") throw new Error("not approved");
    const mac = new Channel(st.access, relay, agent);
    await mac.send("hello");
    expect((await keyOnly.history(0)).messages.map((m) => m.body)).toEqual(["hello"]);

    await expect(keyOnly.close()).resolves.toBeUndefined();
  });
});

describe("agents join with computer claims, people with person claims", () => {
  test("the owner's client verifies both; forgeries read as unclaimed", async () => {
    const s = await setupChannel(relay, { human: await token("alice") });
    const computer = await pairComputer(s.person, "mac-mini");

    // An agent from the owner's own computer: the owner is its sponsor, and it carries `from`.
    const helper = await joinAgent(s, "helper", computer);
    expect(helper.member).toMatchObject({
      kind: "agent",
      sponsor: { user: s.person.pk, handle: "owner" },
      from: { pk: computer.machine.pk, label: "mac-mini" },
    });
    expect(helper.req.computer).toMatchObject({ pk: computer.machine.pk, person: s.person.pk, own: true });

    // A claim for another agent's key, or another channel, checks out to nothing.
    const stray = await generateIdentity("stray");
    const roomId = s.roomId;
    const wrongAgent = await claimComputer(computer.machine, computer.cert, roomId, (await generateIdentity("other")).pk);
    const { requestId } = await Channel.requestJoin(relay, s.code, stray, { name: "stray" }, { computer: wrongAgent });
    const [r] = (await s.ownerCh.requests({ person: s.person.pk })).filter((x) => x.id === requestId);
    expect(r?.computer).toBeUndefined();
    await s.ownerCh.deny(requestId);

    // A person joins as themself: a human member carrying their person key.
    const bob = await generateIdentity("bob-person");
    const joined = await joinPerson(s, "bob", bob);
    expect(joined.member).toMatchObject({ kind: "human", name: "bob", person: bob.pk, sponsor: { user: bob.pk, handle: "bob" } });
    await s.ownerCh.close();
  });

  test("another person's computer: sponsored by them, with no handle here", async () => {
    const s = await setupChannel(relay, { human: await token("alice") });
    const bobsPerson = await generateIdentity("bobs-person");
    const bobsComputer = await pairComputer(bobsPerson, "bob-box");
    const agent = await joinAgent(s, "scout", bobsComputer);
    expect(agent.member.sponsor).toEqual({ user: bobsPerson.pk, name: "bobs-person" });
    expect(agent.req.computer).toMatchObject({ own: false, personName: "bobs-person" });
    await s.ownerCh.close();
  });
});

describe("names", () => {
  test("people get the name they asked under, and the owner can't admit a name twice", async () => {
    const { handleFor } = await import("@kiwi/core/membership.ts");
    expect(handleFor("Jonatas Filho")).toBe("jonatas-filho");
    expect(handleFor("Jonatas Walker")).toBe("jonatas-walker");
    expect(handleFor("  José  da Silva ")).toBe("jose-da-silva");

    const s = await setupChannel(relay, { human: await token("alice") });
    // A person who types someone else's name gets exactly what they typed (there's no account
    // handle anymore); a second requester under a taken name is refused at approval.
    const bob1 = await generateIdentity("b1");
    const ask1 = await Channel.requestJoin(relay, s.code, bob1, { name: "alice" }, { person: await provePerson(await generateIdentity("p1"), s.roomId, bob1.pk) });
    await s.ownerCh.approve((await checked(s.ownerCh, relay, s.code, [{ id: bob1, requestId: ask1.requestId }]))[0]!);
    const bob2 = await generateIdentity("b2");
    const ask2 = await Channel.requestJoin(relay, s.code, bob2, { name: "alice" }, { person: await provePerson(await generateIdentity("p2"), s.roomId, bob2.pk) });
    const dup = (await checked(s.ownerCh, relay, s.code, [{ id: bob2, requestId: ask2.requestId }]))[0]!;
    await expect(s.ownerCh.approve(dup)).rejects.toThrow(/already someone's name/);
    const computer = await pairComputer(s.person);
    const agent = await generateIdentity("agent");
    const claim = await claimComputer(computer.machine, computer.cert, s.roomId, agent.pk);
    const ask3 = await Channel.requestJoin(relay, s.code, agent, { name: "alice" }, { computer: claim });
    const taken = (await checkedByHand(s.ownerCh, relay, s.code, [{ id: agent, requestId: ask3.requestId }])).find((r) => r.id === ask3.requestId)!;
    expect(taken.name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(taken.display).toBeUndefined();
    await s.ownerCh.approve(taken);
    expect(
      (await s.ownerCh.members())
        .filter((m) => m.active)
        .map((m) => m.name)
        .sort(),
    ).toEqual([taken.name, "alice", "owner"].sort());
    await s.ownerCh.close();
  });
});

describe("private beta", () => {
  test("only listed people create channels; anyone can still ask to join", async () => {
    const { OPEN_POLICY } = await import("../src/relay/policy.ts");
    const betaDir = mkdtempSync(join(tmpdir(), "mc-beta-"));
    const beta = startRelay({
      port: 0,
      hostname: "127.0.0.1",
      dataDir: betaDir,
      human,
      policy: { ...OPEN_POLICY, betaUsers: ["github_1", "@example.com"], waitlistUrl: "https://kiwiinit.com/waitlist" },
    });
    const at = beta.url.origin;
    try {
      const [a, b, c, guest] = await Promise.all([generateIdentity("a"), generateIdentity("b"), generateIdentity("c"), generateIdentity("g")]);
      // Listed by id: yes. Listed by email domain: yes. Not listed: a clear 403 with the waitlist.
      const { code } = await Channel.create(at, a, { name: "alice-owner", kind: "human" }, [], undefined, await token("alice"));
      await Channel.create(at, c, { name: "carol", kind: "human" }, [], undefined, await token("carol"));
      await expect(Channel.create(at, b, { name: "bob", kind: "human" }, [], undefined, await token("bob"))).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining("https://kiwiinit.com/waitlist"),
      });
      // Bob isn't in the beta, but he can ask to join Alice's channel.
      expect((await Channel.requestJoin(at, code, guest, { name: "bob" })).requestId).toBeTruthy();
    } finally {
      beta.stop(true);
      rmSync(betaDir, { recursive: true, force: true });
    }
  });

  test("with no list configured, anyone signed in creates channels", async () => {
    // The shared relay in this file has no beta list: Bob could create above too.
    const owner = await generateIdentity("bob");
    const { access } = await Channel.create(relay, owner, { name: "bob", kind: "human" }, [], undefined, await token("bob"));
    await new Channel(access, relay, owner).close();
  });
});

describe("channels per person", () => {
  test("at the limit a person can't create another; closing one frees the slot", async () => {
    const { OPEN_POLICY } = await import("../src/relay/policy.ts");
    const dir = mkdtempSync(join(tmpdir(), "mc-owned-"));
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, human, policy: { ...OPEN_POLICY, channelsPerOwner: 1 } });
    const at = r.url.origin;
    try {
      const [first, second] = await Promise.all([generateIdentity("a"), generateIdentity("b")]);
      const alice = () => token("alice");
      const { access } = await Channel.create(at, first, { name: "alice-owner", kind: "human" }, [], undefined, await alice());
      await expect(Channel.create(at, second, { name: "alice-owner", kind: "human" }, [], undefined, await alice())).rejects.toMatchObject({
        status: 429,
        message: expect.stringContaining("close one to create another"),
      });
      // Others aren't affected.
      const bobs = await Channel.create(at, await generateIdentity("c"), { name: "bob", kind: "human" }, [], undefined, await token("bob"));
      expect(bobs.code).toBeTruthy();
      await new Channel(access, at, first).close();
      expect((await Channel.create(at, second, { name: "alice-owner", kind: "human" }, [], undefined, await alice())).code).toBeTruthy();
    } finally {
      r.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("channels per person, at once (T113)", () => {
  test("parallel creates can't pass the limit together, and a failed create gives its slot back", async () => {
    const { OPEN_POLICY } = await import("../src/relay/policy.ts");
    const dir = mkdtempSync(join(tmpdir(), "mc-owned-race-"));
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, human, policy: { ...OPEN_POLICY, channelsPerOwner: 1 } });
    const at = r.url.origin;
    try {
      const ids = await Promise.all([1, 2, 3, 4, 5].map((i) => generateIdentity(`race-${i}`)));
      const tokens = await Promise.all(ids.map(() => token("dana")));
      const tries = await Promise.allSettled(ids.map((id, i) => Channel.create(at, id, { name: "dana", kind: "human" }, [], undefined, tokens[i])));
      expect(tries.filter((t) => t.status === "fulfilled").length).toBe(1);
      expect(tries.filter((t) => t.status === "rejected").every((t) => (t as PromiseRejectedResult).reason.status === 429)).toBe(true);
      // Erin's broken create (no members) is refused, and doesn't use up her one slot.
      const erin = await generateIdentity("erin");
      const room = "ab".repeat(16);
      const body = JSON.stringify({ owner: { pk: erin.pk, xpk: erin.xpk, sig: "x" }, members: [] });
      const auth = await signRequest(erin, room, "POST", "/create", body);
      const bad = await fetch(`${at}/v1/rooms/${room}/create`, { method: "POST", headers: { authorization: `Bearer ${auth}`, "x-human-token": await token("erin") }, body });
      expect(bad.status).toBe(400);
      expect((await Channel.create(at, erin, { name: "erin", kind: "human" }, [], undefined, await token("erin"))).code).toBeTruthy();
    } finally {
      r.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a create with one bad member writes nothing: the same create, fixed, then goes through", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-half-room-"));
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir });
    const at = r.url.origin;
    const real = globalThis.fetch;
    const owner = await generateIdentity("half");
    let sent: { room: string; body: string } | null = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const room = /\/v1\/rooms\/([^/]+)\/create$/.exec(new URL(url).pathname)?.[1];
      if (!room || typeof init?.body !== "string") return real(input, init);
      sent = { room, body: init.body };
      const b = JSON.parse(init.body) as { members: { keys?: Record<string, string> }[] };
      b.members[1]!.keys = { "5": "not-yet" };
      const body = JSON.stringify(b);
      return real(input, { ...init, body, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await signRequest(owner, room, "POST", "/create", body)}` } });
    }) as typeof fetch;
    try {
      const agent = await generateIdentity("half-agent");
      const tried = await Channel.create(at, owner, { name: "half", kind: "human" }, [{ ...agent, info: { name: "half-agent" } }]).then(
        () => 200,
        (e: { status?: number }) => e.status,
      );
      expect(tried).toBe(400);
      globalThis.fetch = real;
      const { room, body } = sent!;
      const again = await fetch(`${at}/v1/rooms/${room}/create`, { method: "POST", headers: { authorization: `Bearer ${await signRequest(owner, room, "POST", "/create", body)}` }, body });
      expect(again.status).toBe(200);
    } finally {
      globalThis.fetch = real;
      r.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a hold from a create that never finished expires", () => {
    const now = 1_700_000_000_000;
    const real = { room: "r1", code: "mc2-x", owner: true, member: true, agents: 0, at: now - HOLD_MS * 10 };
    const fresh = holdEntry("r2", now - 1_000);
    const dead = holdEntry("r3", now - HOLD_MS - 1);
    expect(reserveSlot([real, fresh], "r4", 2, now)).toEqual({ ok: false, stale: [] });
    expect(reserveSlot([real, dead], "r4", 2, now)).toEqual({ ok: true, stale: ["r3"] });
    // A room that's already counted is let through (a retry of the same create).
    expect(reserveSlot([real, fresh], "r2", 2, now).ok).toBe(true);
  });
});

describe("expiry", () => {
  test("an expired channel is wiped like a close, and members learn it's gone", async () => {
    const { OPEN_POLICY } = await import("../src/relay/policy.ts");
    const dir = mkdtempSync(join(tmpdir(), "mc-expire-"));
    const clock = { now: Date.now() };
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, human, policy: { ...OPEN_POLICY, expireAfterDays: 90 }, now: () => clock.now });
    try {
      const owner = await generateIdentity("a");
      const { access, code } = await Channel.create(r.url.origin, owner, { name: "alice-owner", kind: "human" }, [], undefined, await token("alice"));
      const ch = new Channel(access, r.url.origin, owner);
      const seq = await ch.send("one");
      expect(seq).toBe(1);
      clock.now += 91 * 86_400_000;
      expect(r.sweep()).toBe(1);
      await expect(Channel.requestJoin(r.url.origin, code, await generateIdentity("late"), { name: "late" })).rejects.toThrow();
      await expect(ch.send("anyone?")).rejects.toMatchObject({ why: "closed" });
    } finally {
      r.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a channel stays while someone's connected, and its idle days count from when they leave", async () => {
    const { OPEN_POLICY } = await import("../src/relay/policy.ts");
    const dir = mkdtempSync(join(tmpdir(), "mc-expire-open-"));
    const clock = { now: Date.now() };
    const r = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir, human, policy: { ...OPEN_POLICY, expireAfterDays: 90 }, now: () => clock.now });
    try {
      const owner = await generateIdentity("stays");
      const { access } = await Channel.create(r.url.origin, owner, { name: "stays", kind: "human" }, [], undefined, await token("alice"));
      const u = new URL(`/v1/rooms/${access.roomId}/ws?since=0`, r.url.origin);
      u.protocol = "ws:";
      const ws = new WebSocket(u, [WS_PROTOCOL, await signRequest(owner, access.roomId, "GET", "/ws")]);
      await new Promise<void>((ok, fail) => ((ws.onopen = () => ok()), (ws.onerror = () => fail(new Error("the socket didn't open")))));
      clock.now += 120 * 86_400_000;
      expect(r.sweep()).toBe(0);
      const closed = new Promise<void>((ok) => (ws.onclose = () => ok()));
      ws.close();
      await closed;
      await Bun.sleep(100);
      expect(r.sweep()).toBe(0);
      clock.now += 89 * 86_400_000;
      expect(r.sweep()).toBe(0);
      clock.now += 2 * 86_400_000;
      expect(r.sweep()).toBe(1);
    } finally {
      r.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("a relay missing its GitHub App settings signs nobody in, rather than opening up", async () => {
  expect(githubHumanAuth({ clientId: undefined, clientSecret: undefined })).toBeNull();
  expect(await NO_ONE.verify("ghu_" + "a".repeat(36))).toBeNull();
  expect(await NO_ONE.verify("dev:alice")).toBeNull();
});
