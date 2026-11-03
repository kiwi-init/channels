import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Channel } from "@kiwi/core/client.ts";
import { newRoomId } from "@kiwi/core/crypto.ts";
import { formatRooms } from "@kiwi/core/format.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { ImageAttachment, Message } from "@kiwi/core/protocol.ts";
import { sentHere } from "@kiwi/core/room-rules.ts";
import { fold, rosterOf, type ChannelState } from "@kiwi/core/state.ts";
import { wants } from "../src/agent/wants.ts";
import { briefText } from "../src/brief.ts";
import { outsideRoomNote } from "../src/cli/handles.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-members-only-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let ana: { id: Identity; ch: Channel; member: Member };
let bo: { id: Identity; ch: Channel; member: Member };
let tia: { id: Identity; ch: Channel; member: Member };
let tib: { id: Identity; ch: Channel; member: Member };

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  const computer = await pairComputer(s.person);
  ana = await joinAgent(s, "ana", computer);
  bo = await joinAgent(s, "bo", computer);
  tia = await joinPerson(s, "tia", await generateIdentity("tia-person"));
  tib = await joinPerson(s, "tib", await generateIdentity("tib-person"));
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const pick = (who: { id: Identity }) => ({ name: who.id.name, pk: who.id.pk, xpk: who.id.xpk! });
const seen = async (ch: Channel): Promise<{ state: ChannelState; messages: Message[] }> => {
  const { messages } = await ch.history(0);
  return { state: fold(messages, rosterOf(await s.ownerCh.members())), messages };
};
const at = (messages: readonly Message[], seq: number): Message => messages.find((m) => m.seq === seq)!;

describe("a members-only room is sent to its members only (T703)", () => {
  test("its messages reach its members' hooks and inbox, and nobody else's, though anyone in the channel can open them", async () => {
    const id = await s.ownerCh.makeRoom("launch-plan", [pick(ana)]);
    await ana.ch.history(0);
    const said = await ana.ch.send("the launch date is the 9th", { room: id });
    const mention = await s.ownerCh.send("@bo this one isn't for you", { room: id });

    const inside = await seen(ana.ch);
    expect(
      inside.state.rooms
        .get(id)
        ?.members?.map((m) => m.name)
        .sort(),
    ).toEqual([s.owner.name, "ana"].sort());
    expect(inside.state.rejected.get(said)).toBeUndefined();
    expect(wants("ana", at(inside.messages, mention), inside.state)).toBe(true);

    const outside = await seen(bo.ch);
    expect(at(outside.messages, said).body).toBe("the launch date is the 9th");
    const create = outside.messages.find((m) => m.ev?.op === "room.create" && m.ev.id === id)!;
    for (const m of [create, at(outside.messages, said), at(outside.messages, mention)]) {
      expect(wants("bo", m, outside.state)).toBe(false);
      expect(wants("bo", m, outside.state, { chat: true })).toBe(false);
      expect(wants("bo", m, outside.state, { all: true })).toBe(false);
    }
    expect(sentHere(outside.state, id, "bo")).toBe(false);
    expect(sentHere(outside.state, id, "ana")).toBe(true);
    expect(formatRooms(outside.state, "bo")).not.toContain("launch-plan");
    expect(formatRooms(inside.state, "ana")).toMatch(new RegExp(`#launch-plan \\(id [0-9a-z]+\\) · members only: ${s.owner.name}, ana · `));
  });

  test("a post from outside it is refused, and the CLI notes a mention of someone outside", async () => {
    const id = await s.ownerCh.makeRoom("quiet-corner", [pick(ana)]);
    await bo.ch.history(0);
    const seq = await bo.ch.send("let me in", { room: id });
    expect((await seen(s.ownerCh)).state.rejected.get(seq)).toBe("only its members post in a members-only room");
    const { state } = await seen(s.ownerCh);
    expect(outsideRoomNote(state, id, "@ana and @bo, have a look")).toBe(
      "@bo isn't in #quiet-corner, so they aren't sent this message: someone in the room adds them from the app, or say it where they are.",
    );
    expect(outsideRoomNote(state, id, `@ana and @${s.owner.name}`)).toBeNull();
  });

  test("an agent's brief names the members-only rooms it's in, and only those", () => {
    const brief = briefText({ alias: "ch", agent: "ana", mc: "kiwi", listen: "", memberRooms: ["launch-plan"] });
    expect(brief).toContain("You're in the members-only room #launch-plan: only its members are sent what's posted there, though anyone in the channel can open it.");
    expect(briefText({ alias: "ch", agent: "ana", mc: "kiwi", listen: "" })).not.toContain("members-only");
  });

  test("images and files go in like in any room (#580)", async () => {
    const id = await s.ownerCh.makeRoom("screens", [pick(ana)]);
    const png: ImageAttachment = { name: "a.png", mime: "image/png", data: Buffer.from("png").toString("base64") };
    const seq = await s.ownerCh.send("the dialog", { room: id, imgs: [png] });
    const inside = await seen(ana.ch);
    expect([at(inside.messages, seq).room, at(inside.messages, seq).imgs]).toEqual([id, [png]]);
    expect(inside.state.rejected.get(seq)).toBeUndefined();
  });

  test("taking someone in sends them what comes next; whoever leaves stops being sent it", async () => {
    const id = await s.ownerCh.makeRoom("ops", [pick(ana)]);
    await s.ownerCh.history(0);
    expect(await s.ownerCh.changeRoom(id, { members: [pick(ana), pick(bo)] })).toBe(true);
    const after = await s.ownerCh.send("welcome bo", { room: id });
    const bos = await seen(bo.ch);
    expect(wants("bo", at(bos.messages, after), bos.state)).toBe(true);

    await ana.ch.history(0);
    await ana.ch.leaveRoom(id);
    const later = await s.ownerCh.send("ana is gone", { room: id });
    const anas = await seen(ana.ch);
    expect(anas.state.rooms.get(id)?.members?.map((m) => m.name)).not.toContain("ana");
    expect(wants("ana", at(anas.messages, later), anas.state)).toBe(false);
  });

  test("only the owner, or someone they fully trust, makes one; and whoever changes it stays in it", async () => {
    const seq = await tia.ch.send("made a room", { kind: "event", ev: { op: "room.create", id: newRoomId(), name: "theirs", members: [{ name: "tia", pk: tia.id.pk }] } });
    expect((await seen(s.ownerCh)).state.rejected.get(seq)).toBe("only the owner, or a person they fully trust, makes members-only rooms");
    const id = await s.ownerCh.makeRoom("mine", [pick(ana)]);
    const out = await s.ownerCh.send("changed it", { kind: "event", ev: { op: "room.members", id, name: "mine", members: [{ name: "ana", pk: ana.id.pk }] } });
    expect((await seen(s.ownerCh)).state.rejected.get(out)).toBe("whoever changes a members-only room stays in it");
  });
});

describe("a DM is a members-only room of two people (T703)", () => {
  test("two people who aren't trusted start one, it's sent to both and to nobody else, and nobody can leave it", async () => {
    await tia.ch.history(0);
    const id = await tia.ch.makeDm(pick(tib));
    await tib.ch.history(0);
    const said = await tib.ch.send("just us", { room: id });
    const tibs = await seen(tib.ch);
    expect([tibs.state.rooms.get(id)?.dm, tibs.state.rejected.get(said)]).toEqual([true, undefined]);
    const bos = await seen(bo.ch);
    expect(wants("bo", at(bos.messages, said), bos.state, { chat: true })).toBe(false);
    const left = await tia.ch.send("left the room", { kind: "event", ev: { op: "room.leave", id } });
    expect((await seen(tia.ch)).state.rejected.get(left)).toBe("a direct message or a person's own room has nobody to leave to");
  });

  test("a 'DM' that lists a third person or an agent is refused, and a room can't become one", async () => {
    const three = await tia.ch.send("started a direct conversation", {
      kind: "event",
      ev: {
        op: "room.create",
        id: newRoomId(),
        name: "",
        members: [
          { name: "tia", pk: tia.id.pk },
          { name: "tib", pk: tib.id.pk },
          { name: s.owner.name, pk: s.owner.pk },
        ],
        dm: true,
      },
    });
    const agent = await tia.ch.send("started a direct conversation", {
      kind: "event",
      ev: {
        op: "room.create",
        id: newRoomId(),
        name: "",
        members: [
          { name: "tia", pk: tia.id.pk },
          { name: "ana", pk: ana.id.pk },
        ],
        dm: true,
      },
    });
    const room = await s.ownerCh.makeRoom("not-a-dm", [pick(tia)]);
    const become = await s.ownerCh.send("changed who a room is for", {
      kind: "event",
      ev: {
        op: "room.members",
        id: room,
        name: "",
        members: [
          { name: s.owner.name, pk: s.owner.pk },
          { name: "tia", pk: tia.id.pk },
        ],
        dm: true,
      },
    });
    const { state } = await seen(s.ownerCh);
    expect([state.rejected.get(three), state.rejected.get(agent), state.rejected.get(become)]).toEqual([
      "a direct message's room is between exactly two people",
      "a direct message's room is between exactly two people",
      "a room can't become a direct message",
    ]);
  });
});
