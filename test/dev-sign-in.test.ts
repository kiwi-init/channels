// Dev sign-in: a local relay where "dev:<name>" is <name>, so the create gate can be
// tested end to end without WorkOS. Sign-in gates only creation: every owner act takes
// the owner key's signature alone.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, relayConfig } from "../src/client.ts";
import { decodeJoinCode } from "../src/crypto.ts";
import { generateIdentity } from "../src/identity.ts";
import { claimComputer } from "../src/person.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHostOk, devHumanAuth } from "../src/relay/human.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel } from "./owner.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-dev-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

test("only on this machine", () => {
  expect(["127.0.0.1", "localhost", "::1"].every(devHostOk)).toBe(true);
  expect([undefined, "0.0.0.0", "192.168.1.5", "relay.example.com"].some(devHostOk)).toBe(false);
});

test("the relay says it's dev, and dev tokens are the only ones it takes", async () => {
  expect(await relayConfig(relay)).toMatchObject({ workosClientId: "dev", dev: true });
  const auth = devHumanAuth();
  // Namespaced, so a dev relay on a copy of real data can never sign in as a real WorkOS user.
  expect(await auth.verify("dev:alice")).toBe("dev_alice");
  expect(await auth.verify("dev:user_01HREALID")).toBe("dev_user_01HREALID");
  expect((await auth.profile!("dev_alice"))?.name).toBe("Alice (dev)");
  for (const bad of ["alice", "dev:", "dev:../x", "dev:a b", "Bearer dev:alice"]) expect(await auth.verify(bad)).toBeNull();
});

test("creating needs a session; everything after takes the owner key alone", async () => {
  const owner = await generateIdentity("alice");
  await expect(Channel.create(relay, owner, { name: "alice", kind: "human" })).rejects.toMatchObject({ status: 401 });
  const { code, access } = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
  const ownerCh = new Channel(access, relay, owner);
  // No session anywhere: the owner still rotates and closes.
  await ownerCh.rotate();
  expect(ownerCh.access.epoch).toBe(1);
  await ownerCh.close();
  await expect(Channel.requestJoin(relay, code, await generateIdentity("late"), { name: "late" })).rejects.toThrow();
});

test("agents join with a computer claim and people with a person claim; nobody needs a session", async () => {
  const s = await setupChannel(relay, { human: "dev:alice" });
  const computer = await pairComputer(s.person, "dev box");
  const { member } = await joinAgent(s, "win", computer);
  expect(member).toMatchObject({ name: "win", kind: "agent", sponsor: { user: s.person.pk }, from: { pk: computer.machine.pk, label: "dev box" } });
  const bob = await generateIdentity("bob-person");
  const joined = await joinPerson(s, "bob", bob);
  expect(joined.member).toMatchObject({ name: "bob", kind: "human", person: bob.pk });
  // The requests carry no relay vouch: what the owner saw came from the sealed claims.
  const agent = await generateIdentity("unclaimed");
  const roomId = decodeJoinCode(s.code).roomId;
  const badClaim = await claimComputer(computer.machine, computer.cert, roomId, (await generateIdentity("other")).pk);
  const { requestId } = await Channel.requestJoin(relay, s.code, agent, { name: "unclaimed" }, { computer: badClaim });
  const [req] = (await s.ownerCh.requests({ person: s.person.pk })).filter((r) => r.id === requestId);
  expect(req?.computer).toBeUndefined();
  await s.ownerCh.deny(requestId);
});
