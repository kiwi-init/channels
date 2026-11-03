import { describe, expect, test } from "bun:test";
import type { SendOptions } from "@kiwi/core/client.ts";
import type { Member as Joined } from "@kiwi/core/membership.ts";
import { wakeList } from "@kiwi/core/phone-wake.ts";
import { MAX_WAKE } from "@kiwi/core/push.ts";
import type { ChannelState, Member } from "@kiwi/core/state.ts";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import type { Keyring } from "../desktop/src/keyring.ts";
import { Room } from "../ios/engine/room.ts";

const seat = (name: string, over: Partial<Member> = {}): Member => ({
  name,
  pk: `${name}-pk`.padEnd(43, "x"),
  scopes: [],
  owner: false,
  joined: 0,
  active: true,
  lastSeen: 0,
  messages: 0,
  kind: "human",
  ...over,
});

const jowUser = { user: "user_jow", name: "Jow", handle: "jow" };
const mayaUser = { user: "user_maya", name: "Maya", handle: "maya" };

function channel(extra: Member[] = []): Pick<ChannelState, "members"> {
  const members = [
    seat("jow", { owner: true }),
    seat("jow-2", { sponsor: jowUser }),
    seat("jow-phone", { sponsor: jowUser }),
    seat("maya", { sponsor: mayaUser, answersDecisions: true }),
    seat("maya-phone", { sponsor: mayaUser }),
    seat("atlas", { kind: "agent", sponsor: jowUser }),
    seat("win", { kind: "agent", sponsor: jowUser }),
    ...extra,
  ];
  return { members: new Map(members.map((m) => [m.name, m])) };
}

const pks = (...names: string[]) => names.map((n) => `${n}-pk`.padEnd(43, "x"));
const sorted = (xs: string[]) => [...xs].sort();

describe("whose phones a message wakes", () => {
  const state = channel();

  test("an ask wakes whom it's to and who answers decisions, on every seat they have", () => {
    expect(sorted(wakeList(state, "win", { kind: "ask", esc: true, to: ["jow"] }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone", "maya", "maya-phone")));
  });

  test("a permission, a step and a handoff wake only whom they're to", () => {
    expect(sorted(wakeList(state, "win", { kind: "ask", esc: true, to: ["jow"], permission: { tool: "Bash" } }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone")));
    expect(sorted(wakeList(state, "win", { kind: "ask", esc: true, to: ["jow"], step: { holds: ["T7"] } }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone")));
    expect(sorted(wakeList(state, "win", { kind: "ask", esc: true, to: ["jow"], handoff: { url: "https://x" } }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone")));
  });

  test("nothing that isn't Needs you: a message to someone, a mention, a plain question or an event", () => {
    expect(wakeList(state, "atlas", { to: ["jow"] })).toEqual([]);
    expect(wakeList(state, "atlas", { to: ["maya"], kind: "msg" })).toEqual([]);
    expect(wakeList(state, "win", { kind: "ask", to: ["jow"] })).toEqual([]);
    expect(wakeList(state, "atlas", { kind: "event", esc: true, to: ["jow"] })).toEqual([]);
  });

  test("never agents, and never the sender's own seats", () => {
    expect(wakeList(state, "atlas", { kind: "ask", esc: true, to: ["win"], step: { holds: ["T7"] } })).toEqual([]);
    expect(sorted(wakeList(state, "jow-2", { kind: "ask", esc: true, to: ["jow", "maya"], step: { holds: ["T7"] } }))).toEqual(sorted(pks("maya", "maya-phone")));
  });

  test("someone who left isn't woken, and the list stops at MAX_WAKE", () => {
    expect(wakeList(channel([seat("gone", { active: false })]), "atlas", { kind: "ask", esc: true, to: ["gone"], step: {} })).toEqual([]);
    const crowd = Array.from({ length: MAX_WAKE + 5 }, (_, i) => seat(`p${i}`));
    expect(wakeList(channel(crowd), "atlas", { kind: "ask", esc: true, to: crowd.map((m) => m.name), step: {} })).toHaveLength(MAX_WAKE);
  });
});

describe("a phone's own sends", () => {
  test("a message from the phone in #general wakes nobody, even the person it mentions", async () => {
    const joined = (name: string, over: Partial<Joined> = {}): Joined => ({ name, pk: pks(name)[0]!, xpk: "x", owner: false, at: 0, active: true, kind: "human", ...over });
    const roster = [joined("jow", { owner: true, sponsor: jowUser }), joined("jow-phone", { sponsor: jowUser }), joined("maya", { sponsor: mayaUser }), joined("maya-phone", { sponsor: mayaUser })];
    const sent: SendOptions[] = [];
    const keyring = {
      call: async (_code: string, op: string, _body?: string, opts?: SendOptions): Promise<unknown> => {
        if (op === "head") return 0;
        if (op === "members") return roster;
        if (op === "send" && opts) {
          sent.push(opts);
          return 1;
        }
        return null;
      },
      follow: (): (() => void) => () => {},
    } as unknown as Keyring;
    const seat = { code: "code", label: "jow-phone", idName: "jow-phone", name: "general", pk: pks("jow-phone")[0], access: {} } as unknown as ChannelIdentityView;
    const room = new Room(keyring, seat, { emit: () => {}, lost: () => {}, person: () => null, log: () => {}, devices: () => {} });
    await room.start();
    await new Promise((done) => setTimeout(done, 200));
    await room.send("@maya can you look?", null, [], null);
    room.stop();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.wake ?? []).toEqual([]);
  });
});
