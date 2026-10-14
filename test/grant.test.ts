// A linked computer's seat: the owner signs once that one of their computers may let its own agents in,
// and from then on agents started there join with no request, no code and no owner online. Everything a
// computer signs is checked against that seat by every client (admitRoster), and the relay holds the
// seat's grant, its link to the owner, and a daily limit.

import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "../src/auth.ts";
import { Channel, RelayError } from "../src/client.ts";
import { generateIdentity, sign, signText, type Identity } from "../src/identity.ts";
import { computerOffer, newMachine, registerMachine, vouchFor, type MachineFile } from "../src/machine.ts";
import { checked } from "./check.ts";
import { Database } from "bun:sqlite";
import { newChannelKey, sealTo } from "../src/crypto.ts";
import { admitRoster, describeMember, freeAgentName, makeAdmittedRecord, openRecord, readRecord, sealRecord, type Member, type ReadEntry } from "../src/membership.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { fold } from "../src/state.ts";

setDefaultTimeout(60_000);

const DAY = 86_400_000;
const dirs: string[] = [];
const servers: ReturnType<typeof startRelay>[] = [];
/** Each relay's data folder, by origin: a test that plays a dishonest relay edits its rows there. */
const dataOf = new Map<string, string>();
const relayAt = (human = false) => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-grant-"));
  dirs.push(dataDir);
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, ...(human ? { human: devHumanAuth() } : {}) });
  servers.push(server);
  dataOf.set(server.url.origin, dataDir);
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
    const { access } = await seat.admit(bot.ask);
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
    // The bot sees the owner's signature on itself: keys its computer signs count for nothing more.
    const botCh = new Channel(access, relay, bot.id);
    await botCh.members();
    expect(botCh.access.via).toBeUndefined();
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
    // Any name anyone ever held, however long ago.
    expect(freeAgentName("bot", [{ name: "bot" }])).toBe("bot-2");
    expect(freeAgentName("bot", [])).toBe("bot");
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

describe("the review's holes, closed", () => {
  let relay: string;
  beforeAll(() => {
    relay = relayAt();
  });

  const machineRow = async (ch: Channel, as: Identity, pk: string) => {
    const res = await fetch(`${relay}/v1/rooms/${ch.roomId}/members`, { headers: { authorization: `Bearer ${await signRequest(as, ch.roomId, "GET", "/members", "")}` } });
    return ((await res.json()) as { members: { pk: string; rec: string; e: number }[] }).members.find((m) => m.pk === pk)!;
  };

  test("once the owner signs anything for an agent, its computer can't let it in again over the top", async () => {
    const { ownerCh, seat, machine } = await seated(relay);
    const bot = await agent("bot");
    await seat.admit(bot.ask);
    // The owner makes it read-only; a re-admit would reset that.
    await ownerCh.setCanPost(bot.id.pk, false);
    await expect(seat.admit(bot.ask)).rejects.toThrow(/isn't this computer's/);
    // Same after the owner re-signs its record.
    const other = await agent("pal");
    await seat.admit(other.ask);
    await ownerCh.tendSeats();
    expect(await call(relay, ownerCh.roomId, machine, "POST", "/admit", { pk: other.id.pk, xpk: other.id.xpk, rec: "r", keys: { "0": "k" } })).toBe(409);
  });

  test("a relay can't swap the owner's record back for the computer's", async () => {
    const { ownerCh, seat, machine } = await seated(relay);
    const bot = await agent("bot");
    await seat.admit(bot.ask);
    const computers = await machineRow(ownerCh, machine, bot.id.pk);
    await ownerCh.tendSeats();
    expect((await ownerCh.members()).find((m) => m.pk === bot.id.pk)!.signedBy).toBeUndefined();
    // The relay serves the old, computer-signed record again.
    const db = new Database(join(dataOf.get(relay)!, `${ownerCh.roomId}.sqlite`));
    db.run("UPDATE members SET rec = ?, rec_e = ? WHERE pk = ?", [computers.rec, computers.e, bot.id.pk]);
    db.close();
    expect((await ownerCh.members()).find((m) => m.pk === bot.id.pk)!.signedBy).toBeUndefined();
  });

  test("a record that calls itself the owner's isn't, unless the owner signed it", async () => {
    const { seat } = await seated(relay);
    const eve = await generateIdentity("eve");
    const key = seat.access.keys["0"]!;
    const sealed = await sealRecord(key, await sign(eve, { room: seat.roomId, member: eve.pk, mxpk: eve.xpk!, name: "eve", owner: true, at: Date.now() }));
    const r = await readRecord(key, sealed, seat.roomId, eve.pk, seat.access.ownerPk);
    expect(r?.member.owner).toBe(false);
  });

  test("keys its computer signs count only up to the epoch it was let in at", async () => {
    const { ownerCh, seat, machine } = await seated(relay);
    const bot = await agent("bot");
    const { access } = await seat.admit(bot.ask);
    expect(access.viaUpTo).toBe(0);
    // A removal moves the channel to epoch 1; the owner wraps it for the bot.
    const gone = await agent("gone");
    await seat.admit(gone.ask);
    await ownerCh.remove(gone.id.pk);
    // The computer then re-admits the bot with a key of its own for epoch 1.
    await seat.refreshKeys();
    const bogus = newChannelKey();
    const wrap = async (e: number, k: string) => {
      const box = await sealTo(bot.id.xpk!, k, `mc/key\n${seat.roomId}\n${e}`);
      return JSON.stringify({ box, sig: await signText(machine, `kiwi-key\n${seat.roomId}\n${e}\n${bot.id.pk}\n${box}`) });
    };
    const rec = await sealRecord(seat.access.keys["1"]!, await makeAdmittedRecord(machine, seat.roomId, { pk: bot.id.pk, xpk: bot.id.xpk!, name: "bot" }));
    expect(await call(relay, seat.roomId, machine, "POST", "/admit", { pk: bot.id.pk, xpk: bot.id.xpk, rec, keys: { "0": await wrap(0, seat.access.keys["0"]!), "1": await wrap(1, bogus) } })).toBe(200);
    const botCh = new Channel(access, relay, bot.id);
    await botCh.refreshKeys();
    expect(botCh.access.keys["1"]).toBeUndefined();
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
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b" }, { fields: [...BASE_FIELDS, "about"] })])).toEqual(["human", "mac", "bot"]);
    for (const kind of ["human", "computer"] as const) expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b", kind })])).toEqual(["human", "mac", null]);
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "owner", pk: "b" })])).toEqual(["human", "mac", null]);
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b", via: "elsewhere" })])).toEqual(["human", "mac", null]);
  });

  test("whose agent it is comes from the owner's record, never the computer's", () => {
    const owned = { ...ownerRec, sponsor: { user: "u_owner", name: "Owner" } };
    const out = admitRoster([byOwner(owned), byOwner(seatRec), bySeat({ name: "bot", pk: "b" })], OWNER, now);
    expect(out[2]?.sponsor?.user).toBe("u_owner");
    // A record that names a sponsor at all is dropped, whoever it names.
    expect(names([byOwner(owned), byOwner(seatRec), bySeat({ name: "bot", pk: "b", sponsor: { user: "u_owner", name: "Owner" } }, { fields: [...BASE_FIELDS, "sponsor"] })])).toEqual(["human", "mac", null]);
  });

  test("a name the owner signed is never shadowed, even by a record listed before it", () => {
    expect(names([byOwner(ownerRec), byOwner(seatRec), bySeat({ name: "bot", pk: "b1" }), byOwner({ ...ownerRec, owner: false, name: "bot", pk: "b2" })])).toEqual(["human", "mac", null, "bot"]);
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

  test("without --as: agents in one checkout are let in as claude, then claude-2, and each acts as itself", async () => {
    const relay = relayAt();
    const home = mkdtempSync(join(tmpdir(), "kiwi-grant-auto-"));
    const claudeDir = mkdtempSync(join(tmpdir(), "kiwi-grant-claude-"));
    dirs.push(home, claudeDir);
    const machine = await generateIdentity("machine");
    writeFileSync(join(home, "machine.json"), JSON.stringify({ identity: machine, label: "Build box", relay }));
    const owner = await generateIdentity("human");
    const made = await Channel.create(relay, owner, { name: "human" });
    await new Channel(made.access, relay, owner).seatComputer({ pk: machine.pk, xpk: machine.xpk!, label: "Build box" });

    // Two live Claude Code sessions (each a running process) in the same folder.
    const procs = [Bun.spawn(["sleep", "120"]), Bun.spawn(["sleep", "120"])];
    const session = (i: number) => ({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: `s${i}`, CLAUDE_PID: String(procs[i]!.pid) });
    const kiwi = async (env: Record<string, string>, ...args: string[]) => {
      const p = Bun.spawn(["bun", join(import.meta.dir, "../src/cli/main.ts"), ...args], {
        cwd: home,
        env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1", CLAUDE_CONFIG_DIR: claudeDir, KIWI_MODEL: "test-model", ...env },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
      return out;
    };
    try {
      expect(await kiwi(session(0), "join", made.code)).toContain('You\'re "claude"');
      const second = await kiwi(session(1), "join", made.code);
      expect(second).toContain('You\'re "claude-2"');
      // A name it didn't pick going to the next free one isn't news worth a line.
      expect(second).not.toContain("is taken here");
      expect(await kiwi(session(1), "send", "hello from two")).toMatch(/^sent #\d+/);
      expect(await kiwi(session(0), "log")).toContain("claude-2 → all: hello from two");
      const room = readdirSync(join(home, "identities"))[0]!;
      expect(readdirSync(join(home, "identities", room)).sort()).toEqual(["claude-2.json", "claude.json"]);
    } finally {
      for (const p of procs) p.kill();
    }
  });
});

describe("seat on first approval (#1340)", () => {
  let relay: string;
  beforeAll(() => {
    relay = relayAt();
  });

  /** A channel, its owner, and a computer of theirs that has no seat in it yet. */
  async function unseated(at = relay) {
    const owner = await generateIdentity("human");
    const made = await Channel.create(at, owner, { name: "human" });
    const ownerCh = new Channel(made.access, at, owner);
    const computer: MachineFile = { identity: await generateIdentity("machine"), label: "Mac mini", relay: at };
    return { ownerCh, code: made.code, roomId: made.access.roomId, computer };
  }

  /** An agent on `computer` asks to join, offering it for a seat; the owner sees the request with its code. */
  async function ask(ownerCh: Channel, code: string, roomId: string, name: string, offer: (pk: string) => Promise<unknown>) {
    const id = await generateIdentity(name);
    const seatOffer = await offer(id.pk);
    const { requestId } = await Channel.requestJoin(relay, code, id, { name, ...(seatOffer ? { seatOffer } : {}) } as never);
    const req = (await checked(ownerCh, relay, code, [{ id, requestId }])).find((r) => r.id === requestId)!;
    expect(req.check).toBe("ready");
    return { id, req };
  }

  test("approving with seat seats the computer, and its next agent lets itself in", async () => {
    const { ownerCh, code, roomId, computer } = await unseated();
    const first = await ask(ownerCh, code, roomId, "claude", (pk) => computerOffer(computer, roomId, pk));
    // No sign-in here, so nothing says it's the owner's: offered, but not ticked to begin with (no `own`).
    expect(first.req.computer).toEqual({ pk: computer.identity.pk, xpk: computer.identity.xpk!, label: "Mac mini" });
    expect(first.req.vouchedBy).toBe(computer.identity.pk);

    await ownerCh.approve(first.req, undefined, { seat: true });
    const seatRow = (await ownerCh.members()).find((m) => m.pk === computer.identity.pk)!;
    expect(seatRow.kind).toBe("computer");
    expect(seatRow.admits!.until).toBeGreaterThan(Date.now() + 80 * DAY);

    const seat = new Channel(await Channel.resume(relay, code, computer.identity), relay, computer.identity);
    const next = await agent("codex");
    const { name } = await seat.admit(next.ask);
    expect(name).toBe("codex");
    // Seated now: a later request from it doesn't offer it again.
    const later = await ask(ownerCh, code, roomId, "late", (pk) => computerOffer(computer, roomId, pk));
    expect(later.req.computer).toBeUndefined();
  });

  test("approving without seat lets the agent in and seats nothing", async () => {
    const { ownerCh, code, roomId, computer } = await unseated();
    const { req } = await ask(ownerCh, code, roomId, "claude", (pk) => computerOffer(computer, roomId, pk));
    await ownerCh.approve(req);
    expect((await ownerCh.members()).some((m) => m.pk === computer.identity.pk)).toBe(false);
    const seat = await Channel.resume(relay, code, computer.identity).catch((e: unknown) => e);
    expect(seat).toBeInstanceOf(Error);
  });

  test("an offer whose signatures don't check out isn't offered", async () => {
    const { ownerCh, code, roomId, computer } = await unseated();
    // Its vouch is for another agent's key (copied from someone else's request).
    const other = await generateIdentity("other");
    const copied = await ask(ownerCh, code, roomId, "copycat", () => computerOffer(computer, roomId, other.pk));
    expect(copied.req.computer).toBeUndefined();
    // Its exchange key swapped for one the agent holds.
    const swapped = await ask(ownerCh, code, roomId, "swapper", async (pk) => ({ ...(await computerOffer(computer, roomId, pk))!, xpk: other.xpk }));
    expect(swapped.req.computer).toBeUndefined();
    // Asking to seat it anyway seats nothing.
    await ownerCh.approve(copied.req, undefined, { seat: true });
    expect((await ownerCh.members()).some((m) => m.pk === computer.identity.pk)).toBe(false);
  });

  test("a computer that was removed isn't offered again", async () => {
    const { ownerCh, code, roomId, computer } = await unseated();
    const first = await ask(ownerCh, code, roomId, "claude", (pk) => computerOffer(computer, roomId, pk));
    await ownerCh.approve(first.req, undefined, { seat: true });
    await ownerCh.revokeComputer(computer.identity.pk);
    const again = await ask(ownerCh, code, roomId, "again", (pk) => computerOffer(computer, roomId, pk));
    expect(again.req.computer).toBeUndefined();
  });

  test("opening a channel never seats a computer: tendSeats only renews and re-signs", async () => {
    const { ownerCh } = await unseated();
    const before = (await ownerCh.members()).length;
    expect(await ownerCh.tendSeats()).toEqual({ renewed: [], resigned: [] });
    expect((await ownerCh.members()).length).toBe(before);
  });

  test("on a sign-in relay, another person's computer isn't offered; the owner's own is", async () => {
    const at = relayAt(true);
    const owner = await generateIdentity("alice");
    const made = await Channel.create(at, owner, { name: "alice", kind: "human", sponsor: { user: "dev_alice", name: "Alice (dev)", handle: "alice" } }, [], undefined, "dev:alice");
    const ownerCh = new Channel(made.access, at, owner, undefined, async () => "dev:alice");
    const roomId = made.access.roomId;
    const linkedTo = async (user: string) => {
      const m = await newMachine(at);
      await registerMachine(m);
      expect((await fetch(`${at}/v1/machines/${m.identity.pk}/confirm`, { method: "POST", headers: { "x-human-token": user }, body: "{}" })).status).toBe(200);
      return m;
    };
    const askFrom = async (m: MachineFile, name: string) => {
      const id = await generateIdentity(name);
      const { requestId } = await Channel.requestJoin(at, made.code, id, { name, seatOffer: (await computerOffer(m, roomId, id.pk))! }, null, await vouchFor(m, roomId, id.pk));
      return (await checked(ownerCh, at, made.code, [{ id, requestId }])).find((r) => r.id === requestId)!;
    };

    const bobs = await askFrom(await linkedTo("dev:bob"), "bobbot");
    expect(bobs.computer).toBeUndefined();

    const mine = await linkedTo("dev:alice");
    const alices = await askFrom(mine, "alicebot");
    expect(alices.computer?.pk).toBe(mine.identity.pk);
    expect(alices.computer?.own).toBe(true);
    await ownerCh.approve(alices, undefined, { seat: true });
    const seat = new Channel(await Channel.resume(at, made.code, mine.identity), at, mine.identity);
    expect((await seat.admit((await agent("next")).ask)).name).toBe("next");
  });
});

describe("kiwi join on a computer with no seat yet", () => {
  test("its first agent asks; approved with seat, the next one lets itself in", async () => {
    const relay = relayAt();
    const home = mkdtempSync(join(tmpdir(), "kiwi-grant-first-"));
    const claudeDir = mkdtempSync(join(tmpdir(), "kiwi-grant-claude-"));
    dirs.push(home, claudeDir);
    const machine = await generateIdentity("machine");
    writeFileSync(join(home, "machine.json"), JSON.stringify({ identity: machine, label: "Build box", relay }));
    const owner = await generateIdentity("human");
    const made = await Channel.create(relay, owner, { name: "human" });
    const ownerCh = new Channel(made.access, relay, owner);

    const kiwi = (...args: string[]) => {
      const env: Record<string, string | undefined> = { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1", CLAUDE_CONFIG_DIR: claudeDir };
      delete env.CLAUDECODE;
      const p = Bun.spawn(["bun", join(import.meta.dir, "../src/cli/main.ts"), ...args], { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      return Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err, code]) => {
        if (code !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
        return out;
      });
    };
    const first = kiwi("join", made.code, "proj", "--as", "bot");
    // The owner's side: its request, offering Build box, once its code shows.
    let req;
    for (let i = 0; i < 100 && !req; i++) {
      const reqs = await ownerCh.requests();
      for (const r of reqs) if (r.check === "unchecked") await ownerCh.checkRequest(r);
      req = reqs.find((r) => r.check === "ready" && r.code);
      if (!req) await Bun.sleep(200);
    }
    expect(req?.computer?.label).toBe("Build box");
    await ownerCh.approve(req!, undefined, { seat: true });
    expect(await first).toContain('You\'re "bot"');
    expect(await kiwi("join", made.code, "proj2", "--as", "bot2")).toContain("let in by this computer");
  });
});
