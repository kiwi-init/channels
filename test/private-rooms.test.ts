import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { newRoomId } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { Member } from "@kiwi/core/membership.ts";
import { newRoomKey, openRoomKey, openRoomMeta, sealRoom, type RoomMeta } from "@kiwi/core/private-room.ts";
import { fold, rosterOf } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { briefText } from "../src/brief.ts";
import { formatRooms } from "@kiwi/core/format.ts";
import { runAgent } from "../src/agent.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-private-rooms-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let ana: { id: Identity; ch: Channel; member: Member };
let bo: { id: Identity; ch: Channel; member: Member };
let tia: { id: Identity; ch: Channel; member: Member };
let tib: { id: Identity; ch: Channel; member: Member };
const ALL = { addsAgents: true, answersDecisions: true, managesAgents: true };

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  const computer = await pairComputer(s.person);
  ana = await joinAgent(s, "ana", computer);
  bo = await joinAgent(s, "bo", computer);
  tia = await joinPerson(s, "tia", await generateIdentity("tia-person"), ALL);
  tib = await joinPerson(s, "tib", await generateIdentity("tib-person"), ALL);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function sealFor(id: string, n: number, key: string, name: string, who: { name: string; pk: string; xpk: string }[], replaces?: string) {
  const meta: RoomMeta = { name, members: who.map((w) => ({ name: w.name, pk: w.pk })) };
  return sealRoom(
    s.roomId,
    id,
    n,
    key,
    meta,
    who.map((w) => w.xpk),
    replaces,
  );
}

const state = async (ch: Channel) => fold((await ch.history(0)).messages, rosterOf(await s.ownerCh.members()));

describe("a private room's key and what it hides (T681)", () => {
  test("only a member opens the key, and with it the name and who's in", async () => {
    const owner = { name: s.owner.name, pk: s.owner.pk, xpk: s.owner.xpk! };
    const key = newRoomKey();
    const sealed = await sealFor("r-keys", 1, key, "launch", [owner, { name: "ana", pk: ana.id.pk, xpk: ana.id.xpk! }]);
    expect(await openRoomKey(s.roomId, sealed, ana.id.xsk!)).toBe(key);
    expect(await openRoomKey(s.roomId, sealed, bo.id.xsk!)).toBeNull();
    expect(await openRoomMeta(s.roomId, sealed, key)).toEqual({
      name: "launch",
      members: [
        { name: s.owner.name, pk: s.owner.pk },
        { name: "ana", pk: ana.id.pk },
      ],
    });
    expect(await openRoomMeta(s.roomId, { ...sealed, n: 2 }, key)).toBeNull();
  });

  test("its messages reach who's in it and nobody else; the rest see no room, no name and no message", async () => {
    const id = newRoomId();
    const key = newRoomKey();
    const who = [
      { name: s.owner.name, pk: s.owner.pk, xpk: s.owner.xpk! },
      { name: "ana", pk: ana.id.pk, xpk: ana.id.xpk! },
    ];
    await s.ownerCh.send("made a private room", { kind: "event", ev: { op: "room.seal", ...(await sealFor(id, 1, key, "launch-plan", who)) } });
    await ana.ch.history(0);
    const said = await ana.ch.send("the launch date is the 9th", { room: id });
    const anaSees = await state(ana.ch);
    expect(anaSees.rooms.get(id)?.name).toBe("launch-plan");
    expect(anaSees.rejected.get(said)).toBeUndefined();
    const ownerSees = (await s.ownerCh.history(0)).messages.find((m) => m.seq === said);
    expect([ownerSees?.body, ownerSees?.room, ownerSees?.sealed]).toEqual(["the launch date is the 9th", id, { room: id, n: 1 }]);
    const boHistory = (await bo.ch.history(0)).messages;
    expect(boHistory.some((m) => m.seq === said)).toBe(false);
    expect(JSON.stringify(boHistory)).not.toContain("launch");
    expect((await state(bo.ch)).rooms.has(id)).toBe(false);
    await expect(bo.ch.send("let me in", { room: id })).rejects.toThrow("not in that private room");
  });

  test("an edit and a delete inside a private room are sealed like its messages, and reach only who's in it (T971)", async () => {
    const id = newRoomId();
    const key = newRoomKey();
    const who = [
      { name: s.owner.name, pk: s.owner.pk, xpk: s.owner.xpk! },
      { name: "ana", pk: ana.id.pk, xpk: ana.id.xpk! },
    ];
    await s.ownerCh.send("made a private room", { kind: "event", ev: { op: "room.seal", ...(await sealFor(id, 1, key, "hiring", who)) } });
    await ana.ch.history(0);
    const said = await ana.ch.send("the offer is 120", { room: id });
    const edited = await ana.ch.send(`edited #${said}`, { room: id, kind: "event", ev: { op: "msg.edit", seq: said, body: "the offer is 125" } });
    const gone = await ana.ch.send("the start date is secret", { room: id });
    const deleted = await ana.ch.send(`deleted #${gone}`, { room: id, kind: "event", ev: { op: "msg.delete", seq: gone } });
    const anaSees = await state(ana.ch);
    expect(anaSees.rejected.get(edited)).toBeUndefined();
    expect(anaSees.edits.get(said)?.body).toBe("the offer is 125");
    expect(anaSees.deleted.has(gone)).toBe(true);
    expect(anaSees.rejected.get(deleted)).toBeUndefined();
    const boHistory = JSON.stringify((await bo.ch.history(0)).messages);
    expect(boHistory).not.toContain("offer is 125");
    expect(boHistory).not.toContain("edited #");
  });

  test("taking someone out moves the room to a new key: they can't post with the old one, and what they wrote before stays", async () => {
    const id = newRoomId();
    const one = newRoomKey();
    const owner = { name: s.owner.name, pk: s.owner.pk, xpk: s.owner.xpk! };
    const anaIn = { name: "ana", pk: ana.id.pk, xpk: ana.id.xpk! };
    const boIn = { name: "bo", pk: bo.id.pk, xpk: bo.id.xpk! };
    await s.ownerCh.send("made a private room", { kind: "event", ev: { op: "room.seal", ...(await sealFor(id, 1, one, "ops", [owner, anaIn, boIn])) } });
    await bo.ch.history(0);
    const before = await bo.ch.send("before", { room: id });
    await s.ownerCh.send("changed a private room", { kind: "event", ev: { op: "room.seal", ...(await sealFor(id, 2, newRoomKey(), "ops", [owner, anaIn], one)) } });
    await bo.ch.history(0);
    await expect(bo.ch.send("after", { room: id })).rejects.toThrow("not in that private room");
    await ana.ch.history(0);
    const later = await ana.ch.send("still here", { room: id });
    const seen = await state(s.ownerCh);
    expect([seen.rejected.get(before), seen.rejected.get(later)]).toEqual([undefined, undefined]);
    expect(seen.rooms.get(id)?.members?.map((m) => m.name)).toEqual([s.owner.name, "ana"]);
    expect((await state(bo.ch)).rooms.has(id)).toBe(false);
  });

  test("a private room keeps to messages, reactions, edits and deletes: a task from inside it is refused before it's sent", async () => {
    const id = newRoomId();
    const key = newRoomKey();
    await s.ownerCh.send("made a private room", {
      kind: "event",
      ev: { op: "room.seal", ...(await sealFor(id, 1, key, "quiet", [{ name: s.owner.name, pk: s.owner.pk, xpk: s.owner.xpk! }])) },
    });
    await s.ownerCh.history(0);
    await expect(s.ownerCh.send("Ship it", { room: id, kind: "event", ev: { op: "task.add", title: "Ship it" } })).rejects.toThrow("messages, reactions, edits and deletes");
  });

  test("the owner's snapshot holds no private room's name, members or messages", async () => {
    expect(await runAgent(s.ownerCh.fx.snapshotIfDue(1))).toBeGreaterThan(0);
    const base = await bo.ch.snapshot();
    const text = JSON.stringify(base);
    for (const secret of ["launch-plan", "the launch date", "still here", "before"]) expect(text).not.toContain(secret);
    expect(base?.rooms.map((r) => r.id)).toEqual(["general"]);
    expect(base?.secret?.every(([, r]) => r.meta === undefined)).toBe(true);

    const fresh = new Channel(ana.ch.access, s.relay, ana.id);
    const opened = await fresh.openRooms(base!);
    const room = opened.rooms.find((r) => r.name === "launch-plan");
    expect(room?.members?.map((m) => m.name)).toEqual([s.owner.name, "ana"]);
    const seq = await fresh.send("after the snapshot", { room: room!.id });
    const after = fold((await fresh.history(base!.n)).messages, rosterOf(await s.ownerCh.members()), Date.now(), null, null, opened);
    expect([after.rejected.get(seq), after.rooms.get(room!.id)?.name]).toEqual([undefined, "launch-plan"]);
    const outsider = await new Channel(bo.ch.access, s.relay, bo.id).openRooms(base!);
    expect(outsider.rooms.map((r) => r.id)).toEqual(["general"]);
  });

  test("someone who isn't the owner or fully trusted can't make one", async () => {
    const stranger = await generateIdentity("stranger");
    const sealed = await sealFor(newRoomId(), 1, newRoomKey(), "theirs", [
      { name: "bo", pk: bo.id.pk, xpk: bo.id.xpk! },
      { name: "x", pk: stranger.pk, xpk: stranger.xpk! },
    ]);
    const seq = await bo.ch.send("made a private room", { kind: "event", ev: { op: "room.seal", ...sealed } });
    expect((await state(s.ownerCh)).rejected.get(seq)).toBe("only the owner, or a person they fully trust, makes private rooms");
  });

  test("a fully trusted person outside the room can't move it to a key of their own: its members keep reading and writing, live or from the owner's snapshot", async () => {
    const id = newRoomId();
    const key = newRoomKey();
    const tiaIn = { name: "tia", pk: tia.id.pk, xpk: tia.id.xpk! };
    const anaIn = { name: "ana", pk: ana.id.pk, xpk: ana.id.xpk! };
    await tia.ch.send("made a private room", { kind: "event", ev: { op: "room.seal", ...(await sealFor(id, 1, key, "tia-and-ana", [tiaIn, anaIn])) } });
    const forged = await sealFor(id, 2, newRoomKey(), "mine now", [{ name: "tib", pk: tib.id.pk, xpk: tib.id.xpk! }], newRoomKey());
    const takeover = await tib.ch.send("changed a private room", { kind: "event", ev: { op: "room.seal", ...forged } });
    await ana.ch.history(0);
    const still = await ana.ch.send("still ours", { room: id });
    const live = await state(ana.ch);
    expect(live.rejected.get(takeover)).toBe("that change to a private room doesn't hold the room's key");
    expect([live.rejected.get(still), live.rooms.get(id)?.name]).toEqual([undefined, "tia-and-ana"]);

    expect(await runAgent(s.ownerCh.fx.snapshotIfDue(1))).toBeGreaterThan(0);
    const fresh = new Channel(ana.ch.access, s.relay, ana.id);
    const base = (await fresh.snapshot())!;
    expect(base.rooms.find((r) => r.id === id)?.name).toBe("tia-and-ana");
    const again = await fresh.send("from the snapshot", { room: id });
    const after = fold((await fresh.history(base.n)).messages, rosterOf(await s.ownerCh.members()), Date.now(), null, null, base);
    expect([after.rejected.get(again), after.rooms.get(id)?.name]).toEqual([undefined, "tia-and-ana"]);
  });

  test("a member who leaves the channel is taken out of its private rooms, and the room moves to a new key (T681)", async () => {
    const id = await s.ownerCh.makeRoom("leaving", [
      { name: "ana", pk: ana.id.pk, xpk: ana.id.xpk! },
      { name: "bo", pk: bo.id.pk, xpk: bo.id.xpk! },
    ]);
    await s.ownerCh.history(0);
    expect(await s.ownerCh.pruneRooms()).toEqual([]);
    await s.ownerCh.remove(bo.id.pk);
    await s.ownerCh.history(0);
    expect(await s.ownerCh.pruneRooms()).toEqual([id]);
    const seen = await state(s.ownerCh);
    expect(seen.rooms.get(id)?.members?.map((m) => m.name)).toEqual([s.owner.name, "ana"]);
    expect(seen.secret.get(id)?.n).toBe(2);
    await ana.ch.history(0);
    const said = await ana.ch.send("bo is gone", { room: id });
    expect((await state(ana.ch)).rejected.get(said)).toBeUndefined();
    expect(await s.ownerCh.pruneRooms()).toEqual([]);
  });

  test("an agent in a private room is told so in its brief, and kiwi rooms says who's in it (T681)", async () => {
    const brief = briefText({ alias: "ch", agent: "ana", mc: "kiwi", listen: "", privateRooms: ["launch-plan"] });
    expect(brief).toContain("You're in the private room #launch-plan: only its members read what's posted there. Anything you post elsewhere, tasks and notes included, the whole channel reads.");
    expect(briefText({ alias: "ch", agent: "ana", mc: "kiwi", listen: "" })).not.toContain("private room");
    const rooms = formatRooms(await state(ana.ch));
    expect(rooms).toContain(`#launch-plan (id `);
    expect(rooms).toMatch(new RegExp(`#launch-plan \\(id [0-9a-f]+\\) · private: ${s.owner.name}, ana · `));
  });

  test("two trusted members rotating on the same departure at once end everyone on one key (T681)", async () => {
    const cy = await joinAgent(s, "cy", await pairComputer(s.person));
    const pick = (x: { id: Identity }, name: string) => ({ name, pk: x.id.pk, xpk: x.id.xpk! });
    const id = await tia.ch.makeRoom("race", [pick(tib, "tib"), pick(ana, "ana"), pick(cy, "cy")]);
    for (const ch of [tia.ch, tib.ch, ana.ch]) await ch.history(0);
    await s.ownerCh.remove(cy.id.pk);
    await Promise.all([tia.ch.history(0), tib.ch.history(0)]);
    await Promise.all([tia.ch.pruneRooms(), tib.ch.pruneRooms()]);
    const said: number[] = [];
    for (const [ch, text] of [
      [tia.ch, "from tia"],
      [tib.ch, "from tib"],
      [ana.ch, "from ana"],
    ] as const) {
      await ch.history(0);
      said.push(await ch.send(text, { room: id }));
    }
    expect(await runAgent(s.ownerCh.fx.snapshotIfDue(1))).toBeGreaterThan(0);
    const fresh = new Channel(ana.ch.access, s.relay, ana.id);
    const base = (await fresh.snapshot())!;
    const views = [await state(tia.ch), await state(tib.ch), await state(ana.ch), fold((await fresh.history(base.n)).messages, rosterOf(await s.ownerCh.members()), Date.now(), null, null, base)];
    for (const v of views) {
      expect(v.secret.get(id)?.n).toBe(2);
      expect(v.rooms.get(id)?.members?.map((m) => m.name)).toEqual(["tia", "tib", "ana"]);
    }
    for (const v of views.slice(0, 3)) for (const seq of said) expect([seq, v.rejected.get(seq)]).toEqual([seq, undefined]);
    const opened = (await tib.ch.history(0)).messages.filter((m) => said.includes(m.seq)).map((m) => m.body);
    expect(opened).toEqual(["from tia", "from tib", "from ana"]);
  });
});
