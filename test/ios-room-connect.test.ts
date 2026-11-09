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

describe("a phone room sends into a named room (#437)", () => {
  test("a send from room:<id> carries the room, and one for a room it can't see is refused", async () => {
    const sent: { body: string; opts: Record<string, unknown> }[] = [];
    let hear: (ev: unknown) => void = () => {};
    const me = { name: "me", pk: "pk", owner: true, at: 0, active: true, kind: "human" };
    const keyring = {
      call: async (_code: string, op: string, ...args: unknown[]): Promise<unknown> => {
        if (op === "head") return 1;
        if (op === "members") return [me];
        if (op === "send") {
          sent.push({ body: args[0] as string, opts: args[1] as Record<string, unknown> });
          return 2;
        }
        return null;
      },
      follow: (_code: string, _since: number, on: (ev: unknown) => void): (() => void) => {
        hear = on;
        return () => {};
      },
      presence: async () => null,
    } as unknown as Keyring;
    const seat = { code: "code", label: "me", idName: "me", name: "general", pk: "pk", access: { ownerPk: "pk" } } as unknown as ChannelIdentityView;
    const room = new Room(keyring, seat, { emit: () => {}, lost: () => {}, person: () => null, log: () => {}, devices: () => {} });
    await room.start();
    hear({
      _tag: "Message",
      message: { v: 1, id: "c", seq: 1, ts: 1, rts: 1, from: "me", pk: "pk", sig: "", sigOk: true, kind: "event", body: "", ev: { op: "room.create", id: "design01", name: "design" } },
    });
    await wait(100);
    expect(await room.send("mockups?", null, [], "room:design01")).toBe(2);
    expect(sent[0]?.opts).toMatchObject({ kind: "msg", room: "design01" });
    await expect(room.send("hi", null, [], "room:nope0001")).rejects.toThrow("that room isn't open to you");
    room.stop();
  });
});
