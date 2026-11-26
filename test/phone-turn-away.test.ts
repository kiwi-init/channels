import { expect, test } from "bun:test";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import type { Keyring } from "../desktop/src/keyring.ts";
import { Room } from "../ios/engine/room.ts";

test("the owner's phone turns a joining agent away with the channel's own deny (T520)", async () => {
  const calls: { op: string; args: unknown[] }[] = [];
  let waiting = [{ id: "join-1", name: "calm-heron" }];
  let on: ((ev: unknown) => void) | null = null;
  const keyring = {
    call: async (_code: string, op: string, ...args: unknown[]): Promise<unknown> => {
      calls.push({ op, args });
      if (op === "head") return 0;
      if (op === "members") return [];
      if (op === "requests") return waiting;
      if (op === "deny") waiting = [];
      return null;
    },
    follow: (_code: string, _last: unknown, handler: (ev: unknown) => void): (() => void) => {
      on = handler;
      return () => {};
    },
    presence: async () => null,
  } as unknown as Keyring;
  const seat = { code: "code", label: "jow", idName: "jow", name: "general", pk: "jow-pk", access: { ownerPk: "jow-pk" } } as unknown as ChannelIdentityView;
  const room = new Room(keyring, seat, { emit: () => {}, lost: () => {}, person: () => null, log: () => {}, devices: () => {} });
  await room.start();
  await new Promise((done) => setTimeout(done, 100));
  on!({ _tag: "Open", kind: "live" });
  await new Promise((done) => setTimeout(done, 100));
  await room.turnAway("join-1");
  expect(calls.filter((c) => c.op === "deny").map((c) => c.args[0])).toEqual(["join-1"]);
  await expect(room.turnAway("join-1")).rejects.toThrow("isn't waiting any more");
});
