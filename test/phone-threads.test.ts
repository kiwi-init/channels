import { describe, expect, test } from "bun:test";
import type { SendOptions } from "@kiwi/core/client.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import type { Keyring } from "../desktop/src/keyring.ts";
import { Room } from "../ios/engine/room.ts";

const member = (name: string, over: Partial<Member> = {}): Member => ({ name, pk: `${name}-pk`, xpk: "x", owner: false, at: 0, active: true, kind: "human", ...over });
const roster = [member("jow", { owner: true }), member("lead", { kind: "agent", role: "lead" })];

async function phone() {
  const sent: SendOptions[] = [];
  const keyring = {
    call: async (_code: string, op: string, _body?: string, opts?: SendOptions): Promise<unknown> => {
      if (op === "head") return 0;
      if (op === "members") return roster;
      if (op === "send" && opts) {
        sent.push(opts);
        return sent.length;
      }
      return null;
    },
    follow: (): (() => void) => () => {},
  } as unknown as Keyring;
  const seat = { code: "code", label: "jow", idName: "jow", name: "general", pk: "jow-pk", access: {} } as unknown as ChannelIdentityView;
  const room = new Room(keyring, seat, { emit: () => {}, lost: () => {}, launch: () => {}, person: () => null, log: () => {}, devices: () => {} });
  await room.start();
  await new Promise((done) => setTimeout(done, 200));
  return { room, sent };
}

describe("a phone's replies in a thread stay there (T3118)", () => {
  test("a reply sent from the thread is a side reply, in #general and in the lead chat", async () => {
    const { room, sent } = await phone();
    await room.send("the green one", 4, [], "main", true);
    await room.send("thanks", 6, [], "dm:jow~lead", true);
    room.stop();
    expect(sent[0]).toMatchObject({ re: [4], side: true });
    expect(sent[1]).toMatchObject({ re: [6], side: true, dm: true, to: ["lead"] });
  });

  test("a message with no reply, or one not sent from a thread, goes to the room", async () => {
    const { room, sent } = await phone();
    await room.send("hello", null, [], "main", true);
    await room.send("also here", 4, [], "main");
    room.stop();
    expect(sent.map((o) => o.side)).toEqual([undefined, undefined]);
  });
});
