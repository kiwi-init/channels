// Sign-in at the relay: verifying WorkOS tokens, and the one gate they guard (creating
// channels). Everything after creation takes member keys alone: owners approve by their owner
// key's signature, agents join with computer claims and people with person claims.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, relayConfig } from "@kiwi/core/client.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { authkitDomains, workosHumanAuth } from "../src/relay/human.ts";
import { HOLD_MS, holdEntry, reserveSlot } from "../src/relay/room.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { claimComputer, provePerson } from "@kiwi/core/person.ts";
import { checked, checkedByHand } from "./check.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel } from "./owner.ts";

setDefaultTimeout(30_000);

// A stand-in for WorkOS: an RSA key, its JWKS endpoint, and tokens signed like AuthKit's.
const rsa = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const jwk = (await crypto.subtle.exportKey("jwk", rsa.publicKey)) as { n: string; e: string };
const jwks = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ keys: [{ kty: "RSA", kid: "k1", alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }] }) });

async function token(sub: string, opts: { exp?: number; key?: CryptoKey; kid?: string; iss?: string } = {}): Promise<string> {
  const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "RS256", kid: opts.kid ?? "k1", typ: "JWT" });
  const body = enc({ sub, iss: opts.iss ?? "https://api.workos.com/user_management/client_test", exp: opts.exp ?? Math.floor(Date.now() / 1000) + 300 });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", opts.key ?? rsa.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const human = {
  ...workosHumanAuth("client_test", `${jwks.url.origin}/jwks`),
  profile: async (u: string) => (u === "user_alice" ? { name: "Alice Owner", email: "alice@example.com" } : u === "user_carol" ? { name: "Carol Coder", email: "carol@example.com" } : null),
};
const dataDir = mkdtempSync(join(tmpdir(), "mc-relay-"));
let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  jwks.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("WorkOS token verification", () => {
  test("accepts a valid token, rejects expired, forged and tampered ones", async () => {
    expect(await human.verify(await token("user_a"))).toBe("user_a");
    expect(await human.verify(await token("user_a", { exp: Math.floor(Date.now() / 1000) - 120 }))).toBeNull();
    const other = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    expect(await human.verify(await token("user_a", { key: other.privateKey }))).toBeNull();
    const [h, , s] = (await token("user_a")).split(".");
    const forgedBody = b64url(new TextEncoder().encode(JSON.stringify({ sub: "admin", exp: 9999999999 })));
    expect(await human.verify(`${h}.${forgedBody}.${s}`)).toBeNull();
    expect(await human.verify("not.a.jwt")).toBeNull();
  });
});

// Moving to a custom AuthKit domain (auth.example.com in place of ….authkit.app): for a while the relay
// names both, and takes tokens from either, issued bare or with WorkOS's /user_management/<client> path.
describe("AuthKit domains", () => {
  test("a setting names one or several, comma-separated, without trailing slashes", () => {
    expect(authkitDomains(undefined)).toEqual([]);
    expect(authkitDomains("https://x.authkit.app/")).toEqual(["https://x.authkit.app"]);
    expect(authkitDomains(" https://auth.example.com , https://x.authkit.app/,")).toEqual(["https://auth.example.com", "https://x.authkit.app"]);
  });

  test("while moving domains, tokens from either are taken, and only for this client", async () => {
    const custom = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ keys: [] }) });
    try {
      const old = jwks.url.origin;
      const now = custom.url.origin;
      // What workosFromSettings builds for `${now},${old}`, minus api.workos.com's JWKS (no network in tests).
      const auth = workosHumanAuth(
        "client_test",
        authkitDomains(`${now},${old}/`).map((d) => `${d}/oauth2/jwks`),
      );
      expect(await auth.verify(await token("user_a", { iss: old }))).toBe("user_a");
      expect(await auth.verify(await token("user_a", { iss: `${now}/` }))).toBe("user_a");
      expect(await auth.verify(await token("user_a", { iss: `${now}/user_management/client_test` }))).toBe("user_a");
      expect(await auth.verify(await token("user_a"))).toBe("user_a");
      expect(await auth.verify(await token("user_a", { iss: `${now}/user_management/client_other` }))).toBeNull();
      expect(await auth.verify(await token("user_a", { iss: "https://evil.example" }))).toBeNull();
      expect(await auth.verify(await token("user_a", { iss: "https://api.workos.com/user_management/client_other" }))).toBeNull();
    } finally {
      custom.stop(true);
    }
  });
});

describe("a relay that requires sign-in", () => {
  test("advertises its WorkOS client", async () => {
    expect(await relayConfig(relay)).toEqual({ workosClientId: "client_test" });
  });

  test("only a signed-in human can create a channel; anyone with the code can ask to join", async () => {
    const [owner, agent] = await Promise.all([generateIdentity("human"), generateIdentity("mac")]);
    // No session: refused.
    await expect(Channel.create(relay, owner, { name: "human" })).rejects.toMatchObject({ status: 401 });

    const alice = await token("user_alice");
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
    const s = await setupChannel(relay, { human: await token("user_alice") });
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
    const s = await setupChannel(relay, { human: await token("user_alice") });
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

    const s = await setupChannel(relay, { human: await token("user_alice") });
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
      policy: { ...OPEN_POLICY, betaUsers: ["user_alice", "@example.com"], waitlistUrl: "https://kiwiinit.com/waitlist" },
    });
    const at = beta.url.origin;
    try {
      const [a, b, c, guest] = await Promise.all([generateIdentity("a"), generateIdentity("b"), generateIdentity("c"), generateIdentity("g")]);
      // Listed by id: yes. Listed by email domain: yes. Not listed: a clear 403 with the waitlist.
      const { code } = await Channel.create(at, a, { name: "alice-owner", kind: "human" }, [], undefined, await token("user_alice"));
      await Channel.create(at, c, { name: "carol", kind: "human" }, [], undefined, await token("user_carol"));
      await expect(Channel.create(at, b, { name: "bob", kind: "human" }, [], undefined, await token("user_bob"))).rejects.toMatchObject({
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
    const { access } = await Channel.create(relay, owner, { name: "bob", kind: "human" }, [], undefined, await token("user_bob"));
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
      const alice = () => token("user_alice");
      const { access } = await Channel.create(at, first, { name: "alice-owner", kind: "human" }, [], undefined, await alice());
      await expect(Channel.create(at, second, { name: "alice-owner", kind: "human" }, [], undefined, await alice())).rejects.toMatchObject({
        status: 429,
        message: expect.stringContaining("close one to create another"),
      });
      // Others aren't affected.
      const bobs = await Channel.create(at, await generateIdentity("c"), { name: "bob", kind: "human" }, [], undefined, await token("user_bob"));
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
      const tokens = await Promise.all(ids.map(() => token("user_dana")));
      const tries = await Promise.allSettled(ids.map((id, i) => Channel.create(at, id, { name: "dana", kind: "human" }, [], undefined, tokens[i])));
      expect(tries.filter((t) => t.status === "fulfilled").length).toBe(1);
      expect(tries.filter((t) => t.status === "rejected").every((t) => (t as PromiseRejectedResult).reason.status === 429)).toBe(true);
      // Erin's broken create (no members) is refused, and doesn't use up her one slot.
      const erin = await generateIdentity("erin");
      const room = "ab".repeat(16);
      const body = JSON.stringify({ owner: { pk: erin.pk, xpk: erin.xpk, sig: "x" }, members: [] });
      const auth = await signRequest(erin, room, "POST", "/create", body);
      const bad = await fetch(`${at}/v1/rooms/${room}/create`, { method: "POST", headers: { authorization: `Bearer ${auth}`, "x-human-token": await token("user_erin") }, body });
      expect(bad.status).toBe(400);
      expect((await Channel.create(at, erin, { name: "erin", kind: "human" }, [], undefined, await token("user_erin"))).code).toBeTruthy();
    } finally {
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
      const { access, code } = await Channel.create(r.url.origin, owner, { name: "alice-owner", kind: "human" }, [], undefined, await token("user_alice"));
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
});
