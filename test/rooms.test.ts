// Rooms: a channel's chat split into rooms (plan A, T1068). The room is a field in the sealed
// payload; the owner makes and renames rooms with signed events, and signs the room list into the
// channel's settings as a floor for clients holding only the log's tail.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wants } from "../src/agent.ts";
import { Channel } from "@kiwi/core/client.ts";
import { formatMessage } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { MAX_ROOMS, wellFormed, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { findRoom, fold, newRoomId, type Roster } from "@kiwi/core/state.ts";

let seq = 0;
async function msg(id: Identity, init: { kind?: Kind; ev?: Event; room?: string; re?: number[]; to?: string[]; body?: string } = {}): Promise<Message> {
  seq++;
  const base = {
    v: 1 as const,
    id: crypto.randomUUID(),
    from: id.name,
    kind: init.kind ?? (init.ev ? "event" : "msg"),
    body: init.body ?? "",
    ts: 1_700_000_000_000 + seq,
    ...(init.to ? { to: init.to } : {}),
    ...(init.re ? { re: init.re } : {}),
    ...(init.ev ? { ev: init.ev } : {}),
    ...(init.room ? { room: init.room } : {}),
  };
  const p = await sign(id, base);
  return { ...p, seq, rts: base.ts, sigOk: await verify(p) };
}

let owner: Identity, ann: Identity, bob: Identity;
let roster: Roster;
beforeAll(async () => {
  [owner, ann, bob] = await Promise.all([generateIdentity("human"), generateIdentity("ann"), generateIdentity("bob")]);
  roster = [
    { name: "human", pk: owner.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ann.pk, owner: false, at: 0, active: true },
    { name: "bob", pk: bob.pk, owner: false, at: 0, active: true },
  ];
});

describe("fold", () => {
  test("a channel without rooms: everything is in general, and lines carry no room tag", async () => {
    const m = await msg(ann, { body: "hi" });
    const s = fold([m], roster);
    expect([...s.rooms.keys()]).toEqual(["general"]);
    expect(s.roomOf.get(m.seq)).toBe("general");
    expect(formatMessage(m, s.trust.get(m.seq), s)).not.toContain("[#");
  });

  test("the owner makes a room; messages land in it; every line names its room once there are two", async () => {
    const create = await msg(owner, { ev: { op: "room.create", id: "design01", name: "design" } });
    const inRoom = await msg(ann, { room: "design01", body: "mockups" });
    const inGeneral = await msg(bob, { body: "lunch?" });
    const s = fold([create, inRoom, inGeneral], roster);
    expect(s.rooms.get("design01")).toMatchObject({ name: "design", createdBy: "human" });
    expect(s.roomOf.get(inRoom.seq)).toBe("design01");
    expect(formatMessage(inRoom, s.trust.get(inRoom.seq), s)).toContain("[#design]");
    expect(formatMessage(inGeneral, s.trust.get(inGeneral.seq), s)).toContain("[#general]");
    expect(findRoom(s, "#Design")?.id).toBe("design01");
    expect(findRoom(s, "design01")?.name).toBe("design");
  });

  test("only the owner makes or renames rooms; ids and names don't repeat; general can't be made again", async () => {
    const byMember = await msg(ann, { ev: { op: "room.create", id: "mine0001", name: "mine" } });
    const ok = await msg(owner, { ev: { op: "room.create", id: "ops00001", name: "ops" } });
    const sameId = await msg(owner, { ev: { op: "room.create", id: "ops00001", name: "ops2" } });
    const sameName = await msg(owner, { ev: { op: "room.create", id: "ops00002", name: "OPS" } });
    const general = await msg(owner, { ev: { op: "room.create", id: "general", name: "general two" } });
    const renameByMember = await msg(ann, { ev: { op: "room.rename", id: "ops00001", name: "hijacked" } });
    const renameUnknown = await msg(owner, { ev: { op: "room.rename", id: "nope0001", name: "x" } });
    const rename = await msg(owner, { ev: { op: "room.rename", id: "general", name: "lobby" } });
    const s = fold([byMember, ok, sameId, sameName, general, renameByMember, renameUnknown, rename], roster);
    expect(s.rejected.get(byMember.seq)).toMatch(/only the owner/);
    expect(s.rejected.get(sameId.seq)).toMatch(/already a room/);
    expect(s.rejected.get(sameName.seq)).toMatch(/already called/);
    expect(s.rejected.get(general.seq)).toMatch(/already a room/);
    expect(s.rejected.get(renameByMember.seq)).toMatch(/only the owner/);
    expect(s.rejected.get(renameUnknown.seq)).toMatch(/no room/);
    expect([...s.rooms.values()].map((r) => r.name)).toEqual(["lobby", "ops"]);
    expect(s.rooms.has("mine0001")).toBe(false);
  });

  test("a message in a room that doesn't exist is refused, and no agent gets it", async () => {
    const m = await msg(ann, { room: "ghost001", body: "anyone?" });
    const s = fold([m], roster);
    expect(s.trust.get(m.seq)).toBe("refused");
    expect(s.rejected.get(m.seq)).toBe("no room ghost001");
    expect(wants("bob", m, s, { chat: true })).toBe(false);
  });

  test("a thread lives in one room: a reply is in its parent's room whatever it says", async () => {
    const create = await msg(owner, { ev: { op: "room.create", id: "infra001", name: "infra" } });
    const root = await msg(ann, { room: "infra001", body: "deploy?" });
    const reply = await msg(bob, { re: [root.seq], body: "go" });
    const s = fold([create, root, reply], roster);
    expect(s.roomOf.get(reply.seq)).toBe("infra001");
  });

  test("the floor: a room made before the folded window still holds its messages, and later renames apply", async () => {
    const create = await msg(owner, { ev: { op: "room.create", id: "old00001", name: "old" } });
    const early = await msg(ann, { room: "old00001", body: "before the window" });
    const inWindow = await msg(bob, { room: "old00001", body: "inside the window" });
    const rename = await msg(owner, { ev: { op: "room.rename", id: "old00001", name: "older" } });
    const after = await msg(ann, { room: "old00001", body: "after the rename" });
    // Without the floor, a client holding only the tail refuses the room's messages.
    const tail = [inWindow, rename, after];
    expect(fold(tail, roster).trust.get(inWindow.seq)).toBe("refused");
    // With the owner's signed list as it stood after the create, they're in the room, and the rename applies.
    const s = fold(tail, roster, Date.now(), { list: [{ id: "old00001", name: "old" }], since: create.seq });
    expect(s.trust.get(inWindow.seq)).toBe("verified");
    expect(s.roomOf.get(after.seq)).toBe("old00001");
    expect(s.rooms.get("old00001")?.name).toBe("older");
    // The full log with the same floor agrees: events up to `since` are already in the list.
    const full = fold([create, early, inWindow, rename, after], roster, Date.now(), { list: [{ id: "old00001", name: "old" }], since: create.seq });
    expect(full.rooms.get("old00001")).toMatchObject({ name: "older", createdBy: "human" });
    expect(full.rejected.has(create.seq)).toBe(false);
  });

  test(`at most ${MAX_ROOMS} rooms, general included`, async () => {
    const creates = await Promise.all(Array.from({ length: MAX_ROOMS }, (_, i) => msg(owner, { ev: { op: "room.create", id: `r${String(i).padStart(7, "0")}`, name: `room ${i}` } })));
    const s = fold(creates, roster);
    expect(s.rooms.size).toBe(MAX_ROOMS);
    expect(s.rejected.get(creates.at(-1)!.seq)).toMatch(/at most/);
  });

  test("wellFormed checks the room id; ids are made in the right shape", async () => {
    const base = { v: 1, id: "x", from: "ann", kind: "msg", body: "", ts: 1 };
    expect(wellFormed({ ...base, room: "design01" })).toBe(true);
    expect(wellFormed({ ...base, room: "Design" })).toBe(false);
    expect(wellFormed({ ...base, room: "a".repeat(33) })).toBe(false);
    expect(newRoomId()).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("delivery", () => {
  test("every room by default; --room narrows chat, and room events still reach everyone", async () => {
    const create = await msg(owner, { ev: { op: "room.create", id: "web00001", name: "web" } });
    const inWeb = await msg(ann, { room: "web00001", body: "css" });
    const inGeneral = await msg(ann, { body: "news" });
    const s = fold([create, inWeb, inGeneral], roster);
    expect(wants("bob", inWeb, s, { chat: true })).toBe(true);
    expect(wants("bob", inGeneral, s, { chat: true, room: "web00001" })).toBe(false);
    expect(wants("bob", inWeb, s, { chat: true, room: "web00001" })).toBe(true);
    expect(wants("bob", create, s, {})).toBe(true);
  });
});

describe("over a relay", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mc-rooms-"));
  let server: ReturnType<typeof startRelay>;
  beforeAll(() => void (server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir })));
  afterAll(() => {
    server.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("the room list and the charter share the signed settings; setting one keeps the other", async () => {
    const human = await generateIdentity("human");
    const { access } = await Channel.create(server.url.origin, human, { name: "human" });
    const ch = new Channel(access, server.url.origin, human);
    await ch.setCharter({ text: "Docs only.", since: 3 });
    await ch.setRooms({ list: [{ id: "design01", name: "design" }], since: 5 });
    expect((await ch.guard())?.charter).toEqual({ text: "Docs only.", since: 3 });
    expect(await ch.rooms()).toEqual({ list: [{ id: "design01", name: "design" }], since: 5 });
    await ch.setCharter({ text: null, since: 7 });
    expect(await ch.rooms()).toEqual({ list: [{ id: "design01", name: "design" }], since: 5 });
  });

  test("a message sent to a room carries it, sealed, and folds into that room", async () => {
    const human = await generateIdentity("human");
    const { access } = await Channel.create(server.url.origin, human, { name: "human" });
    const ch = new Channel(access, server.url.origin, human);
    const create = await ch.send("made #design", { kind: "event", ev: { op: "room.create", id: "design01", name: "design" } });
    const posted = await ch.send("in the room", { room: "design01" });
    const general = await ch.send("in general", { room: "general" });
    const { messages } = await ch.history(0);
    const s = fold(messages, [{ name: "human", pk: human.pk, owner: true, at: 0, active: true }]);
    expect(s.rejected.has(create)).toBe(false);
    expect(s.roomOf.get(posted)).toBe("design01");
    expect(s.roomOf.get(general)).toBe("general");
    // General is the absence of a room: it isn't written down.
    expect(messages.find((m) => m.seq === general)?.room).toBeUndefined();
  });
});
