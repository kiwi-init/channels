// Per-person and per-channel limits (the future free tier), and the safety caps every relay keeps.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { newRoomId } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY, policyFrom, SAFETY_BYTES_PER_CHANNEL, type RelayPolicy } from "../src/relay/policy.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);
const dirs: string[] = [];
const servers: ReturnType<typeof startRelay>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A Bun relay with this policy and a clock the test controls. */
function relayWith(policy: Partial<RelayPolicy>, clock = { now: Date.now() }) {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-quota-"));
  dirs.push(dataDir);
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, policy: { ...OPEN_POLICY, ...policy }, now: () => clock.now });
  servers.push(server);
  return { relay: server.url.origin, dataDir, clock, server };
}

async function channelOn(relay: string, members = 1) {
  const owner = await generateIdentity("boss");
  const { code, access } = await Channel.create(relay, owner, { name: "boss" });
  const ownerCh = new Channel(access, relay, owner);
  const agents: Channel[] = [];
  for (let i = 0; i < members; i++) {
    const a = await generateIdentity(`a${i}`);
    const req = await Channel.requestJoin(relay, code, a, { name: `a${i}` });
    await ownerCh.approve((await checked(ownerCh, relay, code, [{ id: a, requestId: req.requestId }])).find((r) => r.id === req.requestId)!);
    const st = await Channel.joinStatus(relay, code, a, req.requestId);
    if (st.status !== "approved") throw new Error("not approved");
    agents.push(new Channel(st.access, relay, a));
  }
  return { code, access, ownerCh, agents };
}

describe("settings", () => {
  test("nothing configured: no limits but the byte safety cap", () => {
    expect(policyFrom({})).toEqual(OPEN_POLICY);
    expect(OPEN_POLICY.bytesPerChannel).toBe(SAFETY_BYTES_PER_CHANNEL);
    expect(policyFrom({ KIWI_QUOTA_MESSAGES_PER_DAY: "2000", KIWI_QUOTA_BYTES_PER_CHANNEL: "52428800", KIWI_QUOTA_MEMBERS_PER_CHANNEL: "8" })).toMatchObject({
      messagesPerDay: 2000,
      bytesPerChannel: 52_428_800,
      membersPerChannel: 8,
    });
  });

  test("the hosted relay sets no limit: no cap on channels, members or messages, no expiry, and the 1 GB safety floor for bytes (T604)", async () => {
    const config = Bun.JSONC.parse(await Bun.file(join(import.meta.dir, "../wrangler.jsonc")).text()) as { vars: Record<string, string> };
    expect(Object.keys(config.vars).filter((k) => k.startsWith("KIWI_QUOTA_"))).toEqual([]);
    expect(policyFrom(config.vars)).toEqual(OPEN_POLICY);
  });
});

describe("members per channel", () => {
  test("at the limit the owner can't admit another; removing someone frees the seat", async () => {
    const { relay } = relayWith({ membersPerChannel: 2 });
    const { code, ownerCh } = await channelOn(relay, 1);
    const extra = await generateIdentity("extra");
    const ask = await Channel.requestJoin(relay, code, extra, { name: "extra" });
    const [r] = await checked(ownerCh, relay, code, [{ id: extra, requestId: ask.requestId }]);
    await expect(ownerCh.approve(r!)).rejects.toMatchObject({ status: 429, message: expect.stringContaining("2 members") });
    const a0 = (await ownerCh.members()).find((m) => m.name === "a0")!;
    await ownerCh.remove(a0.pk);
    await ownerCh.approve(r!);
    expect(
      (await ownerCh.members())
        .filter((m) => m.active)
        .map((m) => m.name)
        .sort(),
    ).toEqual(["boss", "extra"]);
  });
});

describe("members at create (T112)", () => {
  test("a channel can't be created with more members than the quota", async () => {
    const { relay } = relayWith({ membersPerChannel: 2 });
    const owner = await generateIdentity("boss");
    const agents = await Promise.all(["a", "b"].map(async (n) => ({ ...(await generateIdentity(n)), info: { name: n } })));
    await expect(Channel.create(relay, owner, { name: "boss" }, agents)).rejects.toMatchObject({ status: 429, message: expect.stringContaining("at most 2 members") });
    await Channel.create(relay, owner, { name: "boss" }, agents.slice(0, 1));
  });

  // The owner's own create, sent by hand, with one member changed.
  async function createWith(relay: string, change: (m: Record<string, unknown>) => Record<string, unknown>) {
    const owner = await generateIdentity("boss");
    const room = newRoomId();
    const ownerSig = await sign(owner, { room, xpk: owner.xpk!, v: 2 });
    const me = { pk: owner.pk, xpk: owner.xpk!, rec: "sealed-record", keys: { "0": "wrapped-key" } };
    const body = JSON.stringify({ owner: { pk: owner.pk, xpk: owner.xpk!, sig: ownerSig.sig }, members: [change(me)] });
    const auth = await signRequest(owner, room, "POST", "/create", body);
    return (await fetch(`${relay}/v1/rooms/${room}/create`, { method: "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, body })).status;
  }

  test("member records and wrapped keys are capped, and keys only for epochs the channel has", async () => {
    const { relay } = relayWith({});
    expect(await createWith(relay, (m) => m)).toBe(200);
    expect(await createWith(relay, (m) => ({ ...m, rec: "x".repeat(8_193) }))).toBe(400);
    expect(await createWith(relay, (m) => ({ ...m, keys: { "0": "x".repeat(1_025) } }))).toBe(400);
    expect(await createWith(relay, (m) => ({ ...m, keys: { "0": "k", "1": "k" } }))).toBe(400);
    expect(await createWith(relay, (m) => ({ ...m, keys: { zero: "k" } }))).toBe(400);
  });
});

describe("messages per day", () => {
  test("at the limit sends are refused with when it resets; the next UTC day starts over", async () => {
    const clock = { now: Date.UTC(2026, 9, 8, 23, 50) };
    const { relay } = relayWith({ messagesPerDay: 3 }, clock);
    const { agents } = await channelOn(relay, 1);
    const a = agents[0]!;
    for (let i = 0; i < 3; i++) await a.send(`m${i}`);
    await expect(a.send("one too many")).rejects.toMatchObject({ status: 429, message: expect.stringContaining("00:00 UTC (in 10m)") });
    clock.now = Date.UTC(2026, 9, 9, 0, 1);
    await a.send("a new day");
  });
});

describe("stored bytes per channel", () => {
  test("the oldest messages make room; the counter matches what's stored; oversize is refused", async () => {
    const { relay, dataDir } = relayWith({ bytesPerChannel: 4000 });
    const { access, agents } = await channelOn(relay, 1);
    const a = agents[0]!;
    for (let i = 0; i < 12; i++) await a.send(`message ${i} ${"x".repeat(300)}`);
    const db = new Database(join(dataDir, `${access.roomId}.sqlite`));
    const stored = (db.query("SELECT COALESCE(SUM(CASE WHEN typeof(ct) = 'blob' THEN (LENGTH(ct) * 4 + 2) / 3 ELSE LENGTH(ct) END), 0) AS n FROM msgs").get() as { n: number }).n;
    const counted = (JSON.parse((db.query("SELECT v FROM meta WHERE k = 'usage'").get() as { v: string }).v) as { bytes: number }).bytes;
    const oldest = (db.query("SELECT MIN(seq) AS s FROM msgs").get() as { s: number }).s;
    db.close();
    expect(counted).toBe(stored);
    expect(stored).toBeLessThanOrEqual(4000);
    expect(oldest).toBeGreaterThan(1);
    // The newest messages are all still there.
    const { messages } = await a.history(0);
    expect(messages.at(-1)!.body).toStartWith("message 11");
    await expect(a.send("y".repeat(5000))).rejects.toMatchObject({ status: 413 });
  });

  test("images make room too, so a message never pushes the channel past its allowance", async () => {
    const cap = 6000;
    const { relay, dataDir } = relayWith({ bytesPerChannel: cap });
    const { access, ownerCh, agents } = await channelOn(relay, 1);
    const a = agents[0]!;
    await ownerCh.setImageRefs(true);
    const raw = crypto.getRandomValues(new Uint8Array(4000));
    await a.send("pic", { imgs: [{ name: "p.png", mime: "image/png", data: Buffer.from(raw).toString("base64") }] });
    await a.send("z".repeat(2000));
    const db = new Database(join(dataDir, `${access.roomId}.sqlite`));
    const msgs = (db.query("SELECT COALESCE(SUM(CASE WHEN typeof(ct) = 'blob' THEN (LENGTH(ct) * 4 + 2) / 3 ELSE LENGTH(ct) END), 0) AS n FROM msgs").get() as { n: number }).n;
    const blobs = (db.query("SELECT COALESCE(SUM(size), 0) AS n FROM blobs").get() as { n: number }).n;
    const counted = (JSON.parse((db.query("SELECT v FROM meta WHERE k = 'usage'").get() as { v: string }).v) as { bytes: number }).bytes;
    db.close();
    expect(counted).toBe(msgs + blobs);
    expect(msgs + blobs).toBeLessThanOrEqual(cap);
    expect((await a.history(0)).messages.at(-1)!.body).toBe("z".repeat(2000));
  });
});

describe("idle rooms expire", () => {
  test("activity keeps a room; a quiet one is wiped like a close, and members learn it's gone", async () => {
    const clock = { now: Date.UTC(2026, 9, 8, 12) };
    const { relay, dataDir, server } = relayWith({ expireAfterDays: 1 }, clock);
    const { access, agents } = await channelOn(relay, 1);
    const a = agents[0]!;
    await a.send("still here");
    clock.now += 20 * 3_600_000;
    expect(server.sweep()).toBe(0);
    await a.send("still here, later"); // activity: the clock restarts
    clock.now += 20 * 3_600_000;
    expect(server.sweep()).toBe(0);
    clock.now += 5 * 3_600_000;
    expect(server.sweep()).toBe(1);
    expect(existsSync(join(dataDir, `${access.roomId}.sqlite`))).toBe(false);
    await expect(a.send("anyone?")).rejects.toMatchObject({ why: "closed" });
  });

  test("off unless configured: nothing expires", async () => {
    const clock = { now: Date.UTC(2026, 9, 8, 12) };
    const { relay, server } = relayWith({}, clock);
    await channelOn(relay, 0);
    clock.now += 400 * 86_400_000;
    expect(server.sweep()).toBe(0);
  });
});
