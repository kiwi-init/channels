import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Channel } from "@kiwi/core/client.ts";
import { newRoomKey, sealRoom, type RoomMeta } from "@kiwi/core/private-room.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { Member } from "@kiwi/core/membership.ts";
import { fold, rosterOf } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinPerson, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

type Seat = { id: Identity; ch: Channel; member: Member };

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-room-leave-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let lia: Seat;
let mo: Seat;
let nia: Seat;
let out: Seat;

const seatOf = (x: Seat) => ({ name: x.member.name, pk: x.id.pk, xpk: x.id.xpk! });
const ownerSeat = () => ({ name: s.owner.name, pk: s.owner.pk, xpk: s.owner.xpk! });

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  lia = await joinPerson(s, "lia", await generateIdentity("lia-person"), {});
  mo = await joinPerson(s, "mo", await generateIdentity("mo-person"), {});
  nia = await joinPerson(s, "nia", await generateIdentity("nia-person"), {});
  out = await joinPerson(s, "out", await generateIdentity("out-person"), {});
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const state = async (ch: Channel) => {
  await ch.learnRooms((await ch.history(0)).messages);
  return fold((await ch.history(0)).messages, rosterOf(await s.ownerCh.members()));
};

async function room(name: string): Promise<{ id: string }> {
  const id = await s.ownerCh.makeRoom(name, [seatOf(lia), seatOf(mo), seatOf(nia)]);
  for (const x of [lia, mo, nia]) await state(x.ch);
  return { id };
}

async function reseal(by: Seat, id: string, n: number, name: string, who: { name: string; pk: string; xpk: string }[], replaces: string): Promise<number> {
  const meta: RoomMeta = { name, members: who.map((w) => ({ name: w.name, pk: w.pk })) };
  const sealed = await sealRoom(
    s.roomId,
    id,
    n,
    newRoomKey(),
    meta,
    who.map((w) => w.xpk),
    replaces,
  );
  return by.ch.send("changed a private room", { kind: "event", ev: { op: "room.seal", ...sealed } });
}

const keyOf = (x: Seat, id: string): { n: number; key: string } => {
  const now = (x.ch as unknown as { core: { roomNow: Map<string, { n: number; key?: string }> } }).core.roomNow.get(id);
  if (!now?.key) throw new Error("no key");
  return { n: now.n, key: now.key };
};

describe("leaving a private room (T1768)", () => {
  test("someone who asked to go is sealed out by a member with no special trust, and loses the new key", async () => {
    const { id } = await room("leave-ok");
    const left = await lia.ch.leaveRoom(id);
    const seen = await state(mo.ch);
    expect(seen.rejected.get(left)).toBeUndefined();
    expect(seen.secret.get(id)?.leaving).toEqual(["lia"]);
    expect(await mo.ch.sealOutLeavers(id, ["lia"])).toBe(true);
    const after = await state(nia.ch);
    expect(
      after.rooms
        .get(id)
        ?.members?.map((m) => m.name)
        .sort(),
    ).toEqual([s.owner.name, "mo", "nia"].sort());
    expect(after.secret.get(id)?.leaving).toBeUndefined();
    await state(lia.ch);
    expect((lia.ch as unknown as { core: { roomNow: Map<string, { key?: string }> } }).core.roomNow.get(id)?.key).toBeUndefined();
    expect(keyOf(nia, id).n).toBe(keyOf(mo, id).n);
  });

  test("without a standing leave, a plain member still can't take anyone out", async () => {
    const { id } = await room("no-leave");
    const { n, key } = keyOf(mo, id);
    const seq = await reseal(mo, id, n + 1, "no-leave", [ownerSeat(), seatOf(mo), seatOf(nia)], key);
    expect((await state(nia.ch)).rejected.get(seq)).toBe("only the owner, or a person they fully trust, makes private rooms");
  });

  describe("refused, with lia's leave standing", () => {
    const standing = async (name: string) => {
      const { id } = await room(name);
      await lia.ch.leaveRoom(id);
      await state(mo.ch);
      return { id, ...keyOf(mo, id) };
    };

    test("adding someone", async () => {
      const { id, n, key } = await standing("adds");
      const seq = await reseal(mo, id, n + 1, "adds", [ownerSeat(), seatOf(mo), seatOf(nia), seatOf(out)], key);
      expect((await state(nia.ch)).rejected.has(seq)).toBe(true);
    });

    test("dropping someone who didn't ask to go", async () => {
      const { id, n, key } = await standing("drops");
      const seq = await reseal(mo, id, n + 1, "drops", [ownerSeat(), seatOf(mo)], key);
      expect((await state(nia.ch)).rejected.has(seq)).toBe(true);
    });

    test("the leaver sealing it themselves", async () => {
      const { id, n, key } = await standing("leaver");
      const seq = await reseal(lia, id, n + 1, "leaver", [ownerSeat(), seatOf(mo), seatOf(nia)], key);
      expect((await state(nia.ch)).rejected.has(seq)).toBe(true);
    });

    test("reusing n", async () => {
      const { id, n, key } = await standing("reuse");
      const seq = await reseal(mo, id, n, "reuse", [ownerSeat(), seatOf(mo), seatOf(nia)], key);
      expect((await state(nia.ch)).rejected.has(seq)).toBe(true);
    });

    test("an outsider sealing", async () => {
      const { id, n } = await standing("outsider");
      const seq = await reseal(out, id, n + 1, "outsider", [ownerSeat(), seatOf(mo), seatOf(nia)], newRoomKey());
      expect((await state(nia.ch)).rejected.has(seq)).toBe(true);
    });

    test("renaming it on the way", async () => {
      const { id, n, key } = await standing("rename");
      const seq = await reseal(mo, id, n + 1, "renamed", [ownerSeat(), seatOf(mo), seatOf(nia)], key);
      expect((await state(nia.ch)).rejected.has(seq)).toBe(true);
    });
  });

  test("a leave from outside the room is refused", async () => {
    const { id } = await room("outside");
    const seq = await out.ch.send("left the room", { kind: "event", ev: { op: "room.leave", id } });
    expect((await state(mo.ch)).rejected.has(seq)).toBe(true);
  });
});
