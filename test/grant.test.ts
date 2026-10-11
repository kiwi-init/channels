// A linked computer's seat: the owner signs once that one of their computers may let its own agents in,
// and from then on agents started there join with no request, no code and no owner online. Everything a
// computer signs is checked against that seat by every client (admitRoster), and the relay holds the
// seat's grant, its link to the owner, and a daily limit.

import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "../src/auth.ts";
import { Channel, RelayError } from "../src/client.ts";
import { generateIdentity, sign, type Identity } from "../src/identity.ts";
import { newMachine, registerMachine } from "../src/machine.ts";
import { admitRoster, describeMember, freeAgentName, openRecord, sealRecord, type Member, type ReadEntry } from "../src/membership.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { fold } from "../src/state.ts";

setDefaultTimeout(60_000);

const DAY = 86_400_000;
const dirs: string[] = [];
const servers: ReturnType<typeof startRelay>[] = [];
const relayAt = (human = false) => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-grant-"));
  dirs.push(dataDir);
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, ...(human ? { human: devHumanAuth() } : {}) });
  servers.push(server);
  return server.url.origin;
};
afterEach(() => setSystemTime());
afterAll(() => {
  for (const s of servers) s.stop(true);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A channel on a plain relay, its owner, and one of the owner's computers seated in it. */
async function seated(relay: string) {
  const owner = await generateIdentity("human");
  const made = await Channel.create(relay, owner, { name: "human" });
  const ownerCh = new Channel(made.access, relay, owner);
  const machine = await generateIdentity("machine");
  await ownerCh.seatComputer({ pk: machine.pk, xpk: machine.xpk!, label: "Mac mini" });
  const seat = new Channel(await Channel.resume(relay, made.code, machine), relay, machine);
  return { owner, ownerCh, code: made.code, machine, seat };
}

const agent = async (name: string) => {
  const id = await generateIdentity(name);
  return { id, ask: { pk: id.pk, xpk: id.xpk!, name } };
};

/** A room route signed by `as`, its status. */
async function call(relay: string, roomId: string, as: Identity, method: string, path: string, body: unknown = {}): Promise<number> {
  const text = JSON.stringify(body);
  const res = await fetch(`${relay}/v1/rooms/${roomId}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${await signRequest(as, roomId, method, path, text)}` },
    body: text,
  });
  return res.status;
}

describe("a seated computer lets its agents in", () => {
  let relay: string;
  beforeAll(() => {
    relay = relayAt();
  });

  test("no request, no code, no owner online; the agent talks at once, and reads as joined via the computer", async () => {
    const { ownerCh, seat, machine } = await seated(relay);
    const bot = await agent("bot");
    const { name, access } = await seat.admit(bot.ask);
    expect(name).toBe("bot");
    expect(access.via).toBe(machine.pk);

    const botCh = new Channel(access, relay, bot.id);
    const seq = await botCh.send("hello from a computer-admitted agent");
    expect(seq).toBeGreaterThan(0);

    // Everyone checks the computer's signature against the seat the owner signed.
    const seen = (await botCh.members()).find((m) => m.pk === bot.id.pk)!;
    expect(seen.signedBy).toBe(machine.pk);
    expect(seen.via).toBe(machine.pk);
    expect(seen.viaName).toBe("Mac mini");
    expect(describeMember(seen)).toContain("via Mac mini");
    // The seat itself is no one in the conversation.
    const members = await ownerCh.members();
    const state = fold((await botCh.history(0)).messages, members);
    expect([...state.members.keys()]).toEqual(["human", "bot"]);
    expect(state.trust.get(seq)).toBe("verified");
    expect(state.members.get("bot")!.viaName).toBe("Mac mini");
  });

  test("the owner's client re-signs it, keeping via, so an older client reads it too", async () => {
    const { ownerCh, seat, machine } = await seated(relay);
    const bot = await agent("bot");
    await seat.admit(bot.ask);
    const row = async () => {
      const res = await fetch(`${relay}/v1/rooms/${ownerCh.roomId}/members`, {
        headers: { authorization: `Bearer ${await signRequest(machine, ownerCh.roomId, "GET", "/members", "")}` },
      });
      return ((await res.json()) as { members: { pk: string; rec: string; e: number }[] }).members.find((m) => m.pk === bot.id.pk)!;
    };
    // What a 0.9.0 client does: owner signatures only.
    const older = async () => openRecord(ownerCh.access.keys[String((await row()).e)]!, (await row()).rec, ownerCh.roomId, ownerCh.access.ownerPk, bot.id.pk);
    expect(await older()).toBeNull();

    const done = await ownerCh.tendSeats();
    expect(done.resigned).toEqual(["bot"]);
    const after = await older();
    expect(after?.name).toBe("bot");
    expect(after?.via).toBe(machine.pk);
    const now = (await ownerCh.members()).find((m) => m.pk === bot.id.pk)!;
    expect(now.signedBy).toBeUndefined();
    expect(now.via).toBe(machine.pk);
  });

  test("a clash takes the next name; a name that just left stays taken", async () => {
    const { ownerCh, seat } = await seated(relay);
    const a = await agent("bot");
    const b = await agent("bot");
    expect((await seat.admit(a.ask)).name).toBe("bot");
    expect((await seat.admit(b.ask)).name).toBe("bot-2");
    await ownerCh.remove(a.id.pk);
    const c = await agent("bot");
    expect((await seat.admit(c.ask)).name).toBe("bot-3");
    expect(freeAgentName("bot", [{ name: "bot", active: false, at: Date.now() - 31 * DAY }])).toBe("bot");
  });

  test("nobody comes in while the channel is on hold", async () => {
    const { ownerCh, seat } = await seated(relay);
    await ownerCh.setHold({ on: true, note: "checking something", since: 1 });
    await expect(seat.admit((await agent("bot")).ask)).rejects.toThrow(/ON HOLD/);
    await ownerCh.setHold({ on: false, since: 2 });
    expect((await seat.admit((await agent("bot")).ask)).name).toBe("bot");
  });

  test("revoking the computer removes its seat and every agent it let in", async () => {
    const { ownerCh, seat, machine, code } = await seated(relay);
    const bot = await agent("bot");
    const { access } = await seat.admit(bot.ask);
    const removed = await ownerCh.revokeComputer(machine.pk);
    expect(removed.sort()).toEqual(["bot", "mac-mini"]);
    const members = await ownerCh.members();
    expect(members.filter((m) => m.active).map((m) => m.name)).toEqual(["human"]);
    await expect(new Channel(access, relay, bot.id).send("still here?")).rejects.toThrow();
    // The machine key is out: it can't admit anyone else.
    await expect(Channel.resume(relay, code, machine)).rejects.toThrow();
  });

  test("a computer can't use its seat to mint a role, scopes, a person or a seat", async () => {
    const { ownerCh, seat, machine } = await seated(relay);
    const forged = await generateIdentity("boss");
    const key = seat.access.keys[String(seat.access.epoch)]!;
    // Signed by the seated computer, but with a role: the relay can't read it, so it takes it; clients drop it.
    const rec = await sealRecord(
      key,
      await sign(machine, { room: seat.roomId, member: forged.pk, mxpk: forged.xpk!, name: "boss", kind: "agent", role: "coordinator", via: machine.pk, at: Date.now() }),
    );
    expect(await call(relay, seat.roomId, machine, "POST", "/admit", { pk: forged.pk, xpk: forged.xpk, rec, keys: { "0": "x" } })).toBe(200);
    const row = (await ownerCh.members()).find((m) => m.pk === forged.pk)!;
    expect(row.unverified).toBe(true);
    expect(row.name).not.toBe("boss");
  });

  test("the relay: only a live seat admits, never another member's key, at most 20 a day", async () => {
    const { ownerCh, seat, machine } = await seated(relay);
    // A plain agent member has no seat.
    const bot = await agent("bot");
    const { access } = await seat.admit(bot.ask);
    const other = await generateIdentity("x");
    expect(await call(relay, ownerCh.roomId, bot.id, "POST", "/admit", { pk: other.pk, xpk: other.xpk, rec: "r", keys: { "0": "k" } })).toBe(403);
    // The owner's key, or the computer itself, can't be admitted.
    expect(await call(relay, ownerCh.roomId, machine, "POST", "/admit", { pk: ownerCh.access.ownerPk, xpk: "x", rec: "r", keys: { "0": "k" } })).toBe(400);
    expect(await call(relay, ownerCh.roomId, machine, "POST", "/admit", { pk: machine.pk, xpk: "x", rec: "r", keys: { "0": "k" } })).toBe(400);
    // Another computer's agent isn't this one's to rename.
    const other2 = await generateIdentity("machine-2");
    await ownerCh.seatComputer({ pk: other2.pk, xpk: other2.xpk!, label: "PC" });
    expect(await call(relay, ownerCh.roomId, other2, "POST", "/admit", { pk: bot.id.pk, xpk: bot.id.xpk, rec: "r", keys: { "0": "k" } })).toBe(409);
    expect(access.via).toBe(machine.pk);
    // 20 a day: bot was the first.
    for (let i = 0; i < 19; i++) await seat.admit((await agent(`a${i}`)).ask);
    await expect(seat.admit((await agent("one-too-many")).ask)).rejects.toThrow(/20 agents/);
  });

  test("an expired seat lets nobody in, and what it let in that the owner never re-signed drops out", async () => {
    const { seat } = await seated(relay);
    const bot = await agent("bot");
    const { access } = await seat.admit(bot.ask);
    setSystemTime(Date.now() + 91 * DAY);
    await expect(seat.admit((await agent("late")).ask)).rejects.toThrow(/no seat/);
    const botCh = new Channel(access, relay, bot.id);
    expect((await botCh.members()).find((m) => m.pk === bot.id.pk)?.unverified).toBe(true);
  });

  test("renewing keeps what the seat let in", async () => {
    const { ownerCh, seat, machine } = await seated(relay);
    await seat.admit((await agent("bot")).ask);
    const seatRow = (await ownerCh.members()).find((m) => m.pk === machine.pk)!;
    setSystemTime(Date.now() + 40 * DAY);
    const done = await ownerCh.tendSeats();
    expect(done.renewed).toEqual(["mac-mini"]);
    const renewed = (await ownerCh.members()).find((m) => m.pk === machine.pk)!;
    expect(renewed.admits!.since).toBe(seatRow.admits!.since);
    expect(renewed.admits!.until).toBeGreaterThan(seatRow.admits!.until);
  });
});

describe("admitRoster: what a computer's signature counts for", () => {
  const OWNER = "owner-pk";
  const SEAT = "seat-pk";
  const now = Date.now();
  const ownerRec: Member = { name: "human", pk: OWNER, xpk: "x", owner: true, at: now - 10 * DAY, active: true };
  const seatRec: Member = { name: "mac", display: "Mac", kind: "computer", pk: SEAT, xpk: "x", owner: false, at: now - 5 * DAY, active: true, scopes: [], admits: { since: now - 5 * DAY, until: now + 85 * DAY } };
  const BASE_FIELDS = ["room", "member", "mxpk", "name", "kind", "via", "at", "pk", "sig"];
  const byOwner = (m: Member, active = true): ReadEntry => ({ read: { member: m, signer: OWNER, fields: [] }, active });
  const bySeat = (m: Partial<Member> & { name: string; pk: string }, opts: { signer?: string; fields?: string[]; active?: boolean } = {}): ReadEntry => ({
    read: { member: { xpk: "x", owner: false, at: now - DAY, active: true, kind: "agent", via: SEAT, ...m } as Member, signer: opts.signer ?? SEAT, fields: opts.fields ?? BASE_FIELDS },
    active: opts.active ?? true,
  });
  const names = (entries: ReadEntry[], at = now) => admitRoster(entries, OWNER, at).map((m) => m?.name ?? null);

  test("a good one counts, marked with its computer", () => {
    const out = admitRoster([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b" })], OWNER, now);
    expect(out[2]?.signedBy).toBe(SEAT);
    expect(out[2]?.viaName).toBe("Mac");
  });

  test("forged: a key with no seat, or a seat that isn't a computer's", () => {
    expect(names([byOwner(ownerRec), bySeat({ name: "bot", pk: "b" })])).toEqual(["human", null]);
    const agentSeat = { ...seatRec, kind: "agent" as const };
    expect(names([byOwner(ownerRec), byOwner(agentSeat), bySeat({ name: "bot", pk: "b" })])).toEqual(["human", "mac", null]);
  });

  test("a seat that's removed or past its grant lets nothing through", () => {
    expect(names([byOwner(ownerRec), byOwner(seatRec, false), bySeat({ name: "bot", pk: "b" })])).toEqual(["human", "mac", null]);
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b" })], now + 90 * DAY)).toEqual(["human", "mac", null]);
  });

  test("backdated before the seat, or dated after its grant", () => {
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b", at: now - 6 * DAY })])).toEqual(["human", "mac", null]);
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b", at: now + 86 * DAY })])).toEqual(["human", "mac", null]);
  });

  test("only a name, rules and the owner's person: nothing the owner alone grants", () => {
    for (const extra of ["role", "scopes", "later", "laterRole", "admits", "color", "display", "owner"]) {
      expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b" }, { fields: [...BASE_FIELDS, extra] })])).toEqual(["human", "mac", null]);
    }
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b" }, { fields: [...BASE_FIELDS, "about", "sponsor"] })])).toEqual(["human", "mac", "bot"]);
    for (const kind of ["human", "computer"] as const) expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b", kind })])).toEqual(["human", "mac", null]);
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "owner", pk: "b" })])).toEqual(["human", "mac", null]);
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b", via: "elsewhere" })])).toEqual(["human", "mac", null]);
  });

  test("an agent of someone other than the owner's person", () => {
    const owned = { ...ownerRec, sponsor: { user: "u_owner", name: "Owner" } };
    expect(names([byOwner(owned), byOwner(seatRec), bySeat({ name: "bot", pk: "b", sponsor: { user: "u_owner", name: "Owner" } })])).toEqual(["human", "mac", "bot"]);
    expect(names([byOwner(owned), byOwner(seatRec), bySeat({ name: "bot", pk: "b", sponsor: { user: "u_eve", name: "Eve" } })])).toEqual(["human", "mac", null]);
    expect(names([byOwner(owned), byOwner(seatRec), bySeat({ name: "bot", pk: "b" })])).toEqual(["human", "mac", null]);
  });

  test("the first in the relay's order keeps a name", () => {
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b1" }), bySeat({ name: "BOT", pk: "b2" })])).toEqual(["human", "mac", "bot", null]);
    // A name someone left is free to take again (freeAgentName is what keeps it for 30 days).
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b1" }, { active: false }), bySeat({ name: "bot", pk: "b2" })])).toEqual(["human", "mac", "bot", "bot"]);
  });
});

describe("on a relay that requires sign-in", () => {
  let relay: string;
  beforeAll(() => {
    relay = relayAt(true);
  });

  const linkedTo = async (user: string) => {
    const m = await newMachine(relay);
    await registerMachine(m);
    expect((await fetch(`${relay}/v1/machines/${m.identity.pk}/confirm`, { method: "POST", headers: { "x-human-token": user }, body: "{}" })).status).toBe(200);
    return m;
  };

  test("only the owner's own linked computer is seated, and unlinking it stops it at once", async () => {
    const owner = await generateIdentity("alice");
    const made = await Channel.create(relay, owner, { name: "alice", kind: "human", sponsor: { user: "dev_alice", name: "Alice (dev)", handle: "alice" } }, [], undefined, "dev:alice");
    const ownerCh = new Channel(made.access, relay, owner, undefined, async () => "dev:alice");

    const theirs = await linkedTo("dev:bob");
    await expect(ownerCh.seatComputer({ pk: theirs.identity.pk, xpk: theirs.identity.xpk!, label: "bob's" })).rejects.toThrow(/isn't linked to your account/);

    const mine = await linkedTo("dev:alice");
    await ownerCh.seatComputer({ pk: mine.identity.pk, xpk: mine.identity.xpk!, label: "alice's mac" });
    const seat = new Channel(await Channel.resume(relay, made.code, mine.identity), relay, mine.identity);
    const bot = await agent("bot");
    const { access } = await seat.admit(bot.ask);
    const seen = (await new Channel(access, relay, bot.id).members()).find((m) => m.pk === bot.id.pk)!;
    // Whose agent it is: the owner's own person, as the owner signed themself in.
    expect(seen.sponsor?.user).toBe("dev_alice");
    expect(seen.signedBy).toBe(mine.identity.pk);

    // Unlinked (Your computers → Remove): the relay refuses its seat before any channel is told.
    const del = await fetch(`${relay}/v1/me/machines/${mine.identity.pk}`, { method: "DELETE", headers: { "x-human-token": "dev:alice" } });
    expect(del.status).toBe(200);
    const err = await seat.admit((await agent("late")).ask).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect((err as RelayError).status).toBe(403);
  });
});

describe("kiwi join on a seated computer", () => {
  test("lets itself in and can talk at once", async () => {
    const relay = relayAt();
    const home = mkdtempSync(join(tmpdir(), "kiwi-grant-home-"));
    const claudeDir = mkdtempSync(join(tmpdir(), "kiwi-grant-claude-"));
    dirs.push(home, claudeDir);
    const machine = await generateIdentity("machine");
    writeFileSync(join(home, "machine.json"), JSON.stringify({ identity: machine, label: "Build box", relay }));
    const owner = await generateIdentity("human");
    const made = await Channel.create(relay, owner, { name: "human" });
    await new Channel(made.access, relay, owner).seatComputer({ pk: machine.pk, xpk: machine.xpk!, label: "Build box" });

    const kiwi = async (...args: string[]) => {
      const env: Record<string, string | undefined> = { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1", CLAUDE_CONFIG_DIR: claudeDir };
      delete env.CLAUDECODE;
      const p = Bun.spawn(["bun", join(import.meta.dir, "../src/cli/main.ts"), ...args], { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
      return out;
    };
    expect(await kiwi("join", made.code, "proj", "--as", "bot")).toContain("let in by this computer");
    expect(await kiwi("-c", "proj", "--as", "bot", "send", "hello")).toMatch(/^sent #\d+/);
    const status = await kiwi("-c", "proj", "--as", "bot", "members");
    expect(status).toContain("bot · key");
    expect(status).toContain("via Build box");
    expect(status).not.toContain("linked computer");
  });
});
