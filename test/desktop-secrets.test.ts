import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChannelIdentityView, ChannelOps, KeysAsk, KeysPort, KeysReply } from "../desktop/src/bridge.ts";
import { Keyring, type KeyHost } from "../desktop/src/keyring.ts";
import { serveKeys } from "../desktop/src/keys-server.ts";
import { acceptSeat, withAccess } from "../desktop/src/seats.ts";
import { remoteOps } from "../web/src/lib/channel-remote.ts";
import { Channel } from "@kiwi/core/client.ts";
import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { provePerson } from "@kiwi/core/person.ts";
import { startRelay } from "../src/relay/bun.ts";
import { memoryBudget } from "./check.ts";

setDefaultTimeout(30_000);

const STRIPE = "sk_test_51HxQ2bLkdIu7Gf9aZ0pQ";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-desktop-secrets-"));
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

function memHost(person: Identity): { host: KeyHost; seats: () => ChannelIdentityView[] } {
  let seats: ChannelIdentityView[] = [];
  const budget = memoryBudget();
  const host: KeyHost = {
    relay: () => relay,
    seats: () => seats,
    save: async (entry) => void (seats = acceptSeat(seats, entry)),
    access: async (code, pk, access) => void (seats = withAccess(seats, code, pk, access)),
    forget: async (code) => void (seats = seats.filter((c) => c.code !== code)),
    prove: async (code, memberPk) => provePerson(person, decodeJoinCode(code).roomId, memberPk),
    githubToken: async () => null,
    person: () => person.pk,
    budget,
  };
  return { host, seats: () => seats };
}

function window(k: Keyring): ChannelOps {
  const session = serveKeys(k, () => {});
  let id = 1;
  const port: KeysPort = {
    request: async (ask: KeysAsk) => structuredClone((await session.handle(structuredClone({ ...ask, id: id++ }))) as KeysReply),
    onPush: () => () => {},
    onRestart: () => () => {},
  };
  return remoteOps(port);
}

test("the owner's app keeps secrets through the window without ever handing it a value unasked, and refuses to send one after a restart", async () => {
  const ada = await generateIdentity("Ada");
  const app = memHost(ada);
  const ops = window(new Keyring(app.host));
  const code = (await ops.create("Secrets", null, { name: "Ada" })).code!;

  const agent = await generateIdentity("billing");
  const { requestId } = await Channel.requestJoin(relay, code, agent, { name: "billing" });
  await ops.call(code, "requests");
  await Channel.joinStatus(relay, code, agent, requestId);
  const req = (await ops.call(code, "requests")).find((r) => r.pk === agent.pk);
  await ops.call(code, "approve", req!, undefined);

  const made = await ops.call(code, "setSecret", { name: "STRIPE_KEY", value: STRIPE, note: "test mode", grants: [agent.pk] });
  expect(made).toMatchObject({ name: "STRIPE_KEY", note: "test mode", grants: [agent.pk] });
  const listed = await ops.call(code, "secrets");
  expect(JSON.stringify([made, listed])).not.toContain(STRIPE);
  expect(await ops.call(code, "secretValue", made.id)).toBe(STRIPE);
  const seat = app.seats().find((s) => s.code === code)!;
  expect((seat.access as { seenSecrets?: Record<string, number> }).seenSecrets?.[made.id]).toBe(1);

  const restarted = window(new Keyring(app.host));
  await expect(restarted.call(code, "send", `the key: ${STRIPE}`, {})).rejects.toThrow(/STRIPE_KEY/);
  expect(await restarted.call(code, "send", "STRIPE_KEY is set for billing", {})).toBeGreaterThan(0);

  const st = (await Channel.joinStatus(relay, code, agent, requestId)) as { access: import("@kiwi/core/crypto.ts").ChannelAccess };
  const mine = await new Channel(st.access, relay, agent).mySecrets();
  expect(mine.map((s) => s.value)).toEqual([STRIPE]);

  await restarted.call(code, "deleteSecret", made.id);
  expect(await restarted.call(code, "secrets")).toEqual([]);
  expect(await new Channel(st.access, relay, agent).mySecrets()).toEqual([]);
});
