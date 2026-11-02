import { describe, expect, test } from "bun:test";

import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import type { Keyring } from "../desktop/src/keyring.ts";
import { Room } from "../ios/engine/room.ts";
import type { RoomView } from "../ios/engine/wire.ts";

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function roomOn(head: number, offlineTries: number) {
  const seen = { heads: 0, follows: 0, views: [] as RoomView[] };
  let offline = offlineTries;
  const keyring = {
    call: async (_code: string, op: string): Promise<unknown> => {
      if (op === "head") {
        seen.heads += 1;
        if (offline > 0) {
          offline -= 1;
          throw new Error("the relay can't be reached");
        }
        return head;
      }
      if (op === "members") return [];
      return null;
    },
    follow: (): (() => void) => {
      seen.follows += 1;
      return () => {};
    },
  } as unknown as Keyring;
  const seat = { code: "code", label: "me", name: "general", pk: "pk", access: {} } as unknown as ChannelIdentityView;
  const room = new Room(keyring, seat, {
    emit: (view) => void seen.views.push(view),
    lost: () => {},
    launch: () => {},
    person: () => null,
    log: () => {},
    devices: () => {},
  });
  return { room, seen };
}

describe("a phone room connects whatever the network did first (T948)", () => {
  test("offline at start, it tries again and follows the channel", async () => {
    const { room, seen } = roomOn(10, 1);
    await room.start();
    expect(seen.follows).toBe(0);
    await wait(700);
    expect(seen.heads).toBe(2);
    expect(seen.follows).toBe(1);
    room.stop();
  });

  test("coming back to the app tries at once", async () => {
    const { room, seen } = roomOn(10, 1);
    await room.start();
    room.nudge();
    await wait(50);
    expect(seen.follows).toBe(1);
    room.stop();
  });

  test("a stopped room stops trying", async () => {
    const { room, seen } = roomOn(10, 1);
    await room.start();
    room.stop();
    await wait(700);
    expect(seen.heads).toBe(1);
    expect(seen.follows).toBe(0);
  });

  test("a room that loaded only the channel's tail doesn't claim its start", async () => {
    const short = roomOn(10, 0);
    await short.room.start();
    await wait(100);
    expect(short.seen.views.at(-1)?.whole).toBe(true);
    short.room.stop();
    const long = roomOn(5_000, 0);
    await long.room.start();
    await wait(100);
    expect(long.seen.views.at(-1)?.whole).toBe(false);
    long.room.stop();
  });
});
