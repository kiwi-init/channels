// Join claims: agents carry their computer's cert and vouch, people carry their person key's
// proof, all sealed to the owner. The owner verifies both; the relay never sees them. Sponsors
// are worked out by the owner's client and signed into member records.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { claimComputer, provePerson } from "@kiwi/core/person.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-claims-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("computer claims", () => {
  test("an agent's request names its computer; approval signs in the sponsor and where it's from", async () => {
    const s = await setupChannel(relay);
    const computer = await pairComputer(s.person, "mac-mini");
    const { member, req, ch } = await joinAgent(s, "helper", computer);
    expect(req.computer).toMatchObject({ pk: computer.machine.pk, label: "mac-mini", person: s.person.pk, own: true });
    expect(req.person).toBeUndefined();
    expect(req.sponsoredBy).toBeNull();
    expect(member).toMatchObject({
      name: "helper",
      kind: "agent",
      sponsor: { user: s.person.pk, handle: "owner" },
      from: { pk: computer.machine.pk, label: "mac-mini" },
    });
    // And it talks.
    const seq = await ch.send("hello from helper");
    expect(seq).toBeGreaterThan(0);
    await s.ownerCh.close();
  });

  test("a forged claim reads as no claim: admitted with no sponsor, from nowhere", async () => {
    const s = await setupChannel(relay);
    const computer = await pairComputer(s.person);
    const id = await generateIdentity("sneaky");
    // The vouch is for another key: the computer never vouched for this agent.
    const forged = await claimComputer(computer.machine, computer.cert, s.roomId, (await generateIdentity("other")).pk);
    const { requestId } = await Channel.requestJoin(relay, s.code, id, { name: "sneaky" }, { computer: forged });
    const req = (await s.ownerCh.requests()).find((r) => r.id === requestId)!;
    expect(req.computer).toBeUndefined();
    expect(req.check).toBe("unchecked");
    await s.ownerCh.close();
  });
});

describe("person claims", () => {
  test("a person joins as a human member carrying their person key, sponsoring themself", async () => {
    const s = await setupChannel(relay);
    const bob = await generateIdentity("bob-person");
    const { member } = await joinPerson(s, "bob", bob);
    expect(member).toMatchObject({ name: "bob", kind: "human", person: bob.pk, sponsor: { user: bob.pk, handle: "bob" } });
    await s.ownerCh.close();
  });

  test("a proof for another key, or another channel, is no claim", async () => {
    const s = await setupChannel(relay);
    const person = await generateIdentity("mallory");
    const id = await generateIdentity("mallory-agent");
    const wrongKey = await provePerson(person, s.roomId, (await generateIdentity("other")).pk);
    const { requestId } = await Channel.requestJoin(relay, s.code, id, { name: "mallory-agent" }, { person: wrongKey });
    const req = (await s.ownerCh.requests()).find((r) => r.id === requestId)!;
    expect(req.person).toBeUndefined();
    expect(req.kind).toBe("agent");
    await s.ownerCh.close();
  });
});

describe("sponsor attribution", () => {
  test("a cert by a human member's person key sponsors to them, with their handle", async () => {
    const s = await setupChannel(relay);
    const bobsPerson = await generateIdentity("bobs-person");
    await joinPerson(s, "bob", bobsPerson);
    const bobsComputer = await pairComputer(bobsPerson, "bob-box");
    const { member } = await joinAgent(s, "scout", bobsComputer);
    expect(member.sponsor).toEqual({ user: bobsPerson.pk, name: "bobs-person", handle: "bob" });
    await s.ownerCh.close();
  });

  test("no claim: no sponsor, and nothing about a computer", async () => {
    const s: OwnerSetup = await setupChannel(relay);
    const id = await generateIdentity("plain");
    const { requestId } = await Channel.requestJoin(relay, s.code, id, { name: "plain" });
    const req = (await s.ownerCh.requests()).find((r) => r.id === requestId)!;
    expect(req.computer).toBeUndefined();
    expect(req.person).toBeUndefined();
    await s.ownerCh.close();
  });
});

describe("auto-approval", () => {
  test("own computers are approved without spending the daily budget; others wait for an explicit tap", async () => {
    const s = await setupChannel(relay);
    const own = await pairComputer(s.person, "own-box");
    const otherPerson = await generateIdentity("stranger-person");
    const other = await pairComputer(otherPerson, "stranger-box");

    const ownId = await generateIdentity("own-agent");
    const ownReq = await Channel.requestJoin(relay, s.code, ownId, { name: "own-agent" }, {
      computer: await claimComputer(own.machine, own.cert, s.roomId, ownId.pk),
    });
    const otherId = await generateIdentity("other-agent");
    const otherReq = await Channel.requestJoin(relay, s.code, otherId, { name: "other-agent" }, {
      computer: await claimComputer(other.machine, other.cert, s.roomId, otherId.pk),
    });

    // The app's loop runs before either joiner reveals: only the own half is signed, for free.
    const budget = memoryBudget();
    expect(await s.ownerCh.requests({ budget, person: s.person.pk })).toHaveLength(2);
    const signed = (await s.ownerCh.requests({ budget, person: s.person.pk })).filter((r) => r.check !== "unchecked");
    expect(signed.map((r) => r.name)).toEqual(["own-agent"]);
    expect(budget.load(s.roomId)).toEqual([]);

    // Both reveal; the next loop approves only the own one.
    await Channel.joinStatus(relay, s.code, ownId, ownReq.requestId);
    await Channel.joinStatus(relay, s.code, otherId, otherReq.requestId);
    const approved = await s.ownerCh.autoApprove(s.person.pk);
    expect(approved.map((m) => m.name)).toEqual(["own-agent"]);
    expect(approved[0]).toMatchObject({ sponsor: { user: s.person.pk, handle: "owner" }, from: { pk: own.machine.pk } });
    // The stranger needs a deliberate tap: nothing auto-signed it, so the budget is still empty.
    expect(budget.load(s.roomId)).toEqual([]);
    const tapped = (await s.ownerCh.requests({ budget, person: s.person.pk })).find((r) => r.id === otherReq.requestId)!;
    expect(tapped.check).toBe("unchecked");
    await s.ownerCh.checkRequest(tapped);
    await Channel.joinStatus(relay, s.code, otherId, otherReq.requestId);
    const ready = (await s.ownerCh.requests({ budget, person: s.person.pk })).find((r) => r.id === otherReq.requestId)!;
    expect(ready.check).toBe("ready");
    await s.ownerCh.close();
  });
});
