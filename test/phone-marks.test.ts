import { describe, expect, test } from "bun:test";
import type { Member } from "@kiwi/core/membership.ts";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import type { Keyring } from "../desktop/src/keyring.ts";
import { Room } from "../ios/engine/room.ts";

const sponsor = { user: "p-jow", name: "Jow", handle: "jow" };
const member = (name: string, over: Partial<Member> = {}): Member => ({ name, pk: `${name}-pk`, xpk: "x", owner: false, at: 0, active: true, kind: "human", ...over });
const roster = [member("jow", { owner: true, sponsor }), member("jow-2", { sponsor }), member("lead", { kind: "agent", role: "lead" })];

interface Synced {
  local: Record<string, number>;
  write: boolean;
}

async function phone(note: Record<string, number> | null) {
  const synced: Synced[] = [];
  const keyring = {
    call: async (_code: string, op: string, local?: Record<string, number>, opts?: { write?: boolean }): Promise<unknown> => {
      if (op === "head") return 0;
      if (op === "members") return roster;
      if (op === "syncMarks" && local) {
        synced.push({ local, write: opts?.write ?? true });
        return note;
      }
      return null;
    },
    follow: (): (() => void) => () => {},
  } as unknown as Keyring;
  const seat = { code: "code", label: "jow-2", idName: "jow-2", name: "general", pk: "jow-2-pk", access: {} } as unknown as ChannelIdentityView;
  const room = new Room(keyring, seat, { emit: () => {}, lost: () => {}, person: () => null, log: () => {}, devices: () => {} });
  await room.start();
  await new Promise((done) => setTimeout(done, 200));
  return { room, synced };
}

describe("a phone's read marks go through its person's note (T1372)", () => {
  test("it shares only #general and the lead chat, keyed as the desktop keys them, and takes back only those", async () => {
    const { room, synced } = await phone({ main: 40, "dm:jow~lead": 12, "task:7": 30, "room:design": 9 });
    const got = await room.marks({ main: 31, "dm:jow~lead": 12, "task:7": 5, junk: -1 }, true);
    room.stop();
    expect(synced).toEqual([{ local: { main: 31, "dm:jow~lead": 12 }, write: true }]);
    expect(got).toEqual({ main: 40, "dm:jow~lead": 12 });
  });

  test("a note that carries a desktop's read floor is read without trouble: the phone takes its own places and leaves the rest (T3487)", async () => {
    const { room, synced } = await phone({ main: 40, "dm:jow~lead": 12, floor: 57 });
    const got = await room.marks({ main: 31 }, true);
    room.stop();
    expect(synced).toEqual([{ local: { main: 31 }, write: true }]);
    expect(got).toEqual({ main: 40, "dm:jow~lead": 12 });
  });

  test("coming to the front only reads the note", async () => {
    const { room, synced } = await phone({ main: 40 });
    expect(await room.marks({ main: 3 }, false)).toEqual({ main: 40 });
    room.stop();
    expect(synced.map((s) => s.write)).toEqual([false]);
  });

  test("a phone that has read nothing writes nothing, and a channel without a note changes nothing", async () => {
    const empty = await phone({ main: 40 });
    expect(await empty.room.marks({}, true)).toEqual({});
    empty.room.stop();
    expect(empty.synced).toEqual([]);
    const none = await phone(null);
    expect(await none.room.marks({ main: 3 }, false)).toEqual({});
    none.room.stop();
  });
});
