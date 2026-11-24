import { describe, expect, test } from "bun:test";
import type { SendOptions } from "@kiwi/core/client.ts";
import type { Member as Joined } from "@kiwi/core/membership.ts";
import { wakeList } from "@kiwi/core/phone-wake.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { MAX_WAKE } from "@kiwi/core/push.ts";
import { handedOver, type ChannelState, type Member } from "@kiwi/core/state.ts";
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

describe("a phone's answer to a question (#2514)", () => {
  async function phoneAnswering(...messages: Message[]): Promise<{ room: Room; sent: { body?: string; opts: SendOptions }[] }> {
    const joined = (name: string, over: Partial<Joined> = {}): Joined => ({ name, pk: pks(name)[0]!, xpk: "x", owner: false, at: 0, active: true, kind: "human", ...over });
    const roster = [joined("jow", { owner: true, sponsor: jowUser }), joined("jow-phone", { sponsor: jowUser }), joined("lead", { kind: "agent" }), joined("wren", { kind: "agent" })];
    const sent: { body?: string; opts: SendOptions }[] = [];
    let deliver: (ev: unknown) => void = () => {};
    const keyring = {
      call: async (_code: string, op: string, body?: string, opts?: SendOptions): Promise<unknown> => {
        if (op === "head") return 0;
        if (op === "members") return roster;
        if (op === "send" && opts) {
          sent.push({ body, opts });
          return 9;
        }
        return null;
      },
      follow: (_code: string, _from: number, on: (ev: unknown) => void): (() => void) => {
        deliver = on;
        return () => {};
      },
    } as unknown as Keyring;
    const seat = { code: "code", label: "jow-phone", idName: "jow-phone", name: "general", pk: pks("jow-phone")[0], access: {} } as unknown as ChannelIdentityView;
    const room = new Room(keyring, seat, { emit: () => {}, lost: () => {}, person: () => null, log: () => {}, devices: () => {} });
    await room.start();
    await new Promise((done) => setTimeout(done, 200));
    for (const message of messages) deliver({ _tag: "Message", message, row: null });
    return { room, sent };
  }

  test("a tapped option goes out as a pick, so it answers even when the channel takes answers by tap", async () => {
    const ask = { seq: 1, from: "lead", ts: 1, kind: "ask", body: "Take it now?", to: ["jow-phone"], choices: ["A", "B"], esc: true, sigOk: true } as unknown as Message;
    const { room, sent } = await phoneAnswering(ask);
    await room.answer(1, "A");
    room.stop();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toBe("A");
    expect(sent[0]?.opts).toMatchObject({ to: ["lead"], re: [1], kind: "msg", pick: true });
  });

  test("an answer to a question the lead relayed reaches the agent who asked it, as the desktop's does (#2520)", async () => {
    const handed = { seq: 1, from: "wren", ts: 1, kind: "msg", body: handedOver("wren", "Count where?", { choices: ["A: after", "B: right"] }), to: ["lead"], sigOk: true } as unknown as Message;
    const relayed = { seq: 2, from: "lead", ts: 2, kind: "ask", body: "Count where?", to: ["jow-phone"], re: [1], choices: ["A: after", "B: right"], esc: true, sigOk: true } as unknown as Message;
    const { room, sent } = await phoneAnswering(handed, relayed);
    await room.answer(2, "A");
    room.stop();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.opts).toMatchObject({ to: ["lead", "wren"], re: [2, 1], kind: "msg", pick: true });
  });
});

describe("a phone's reply to a step (#2515)", () => {
  test("goes out as the desktop's step reply: its words, to the asker, on the step, aside, with the structured reply", async () => {
    const joined = (name: string, over: Partial<Joined> = {}): Joined => ({ name, pk: pks(name)[0]!, xpk: "x", owner: false, at: 0, active: true, kind: "human", ...over });
    const roster = [joined("jow", { owner: true, sponsor: jowUser }), joined("jow-phone", { sponsor: jowUser }), joined("lead", { kind: "agent" })];
    const sent: { body?: string; opts: SendOptions }[] = [];
    let deliver: (ev: unknown) => void = () => {};
    const keyring = {
      call: async (_code: string, op: string, body?: string, opts?: SendOptions): Promise<unknown> => {
        if (op === "head") return 0;
        if (op === "members") return roster;
        if (op === "send" && opts) {
          sent.push({ body, opts });
          return 3;
        }
        return null;
      },
      follow: (_code: string, _from: number, on: (ev: unknown) => void): (() => void) => {
        deliver = on;
        return () => {};
      },
    } as unknown as Keyring;
    const seat = { code: "code", label: "jow-phone", idName: "jow-phone", name: "general", pk: pks("jow-phone")[0], access: {} } as unknown as ChannelIdentityView;
    const room = new Room(keyring, seat, { emit: () => {}, lost: () => {}, person: () => null, log: () => {}, devices: () => {} });
    await room.start();
    await new Promise((done) => setTimeout(done, 200));
    const step = {
      seq: 1,
      from: "lead",
      ts: 1,
      kind: "ask",
      body: "Sign the build",
      to: ["jow-phone"],
      esc: true,
      step: { why: "the release waits on it", needsPerson: "the key is on your Mac" },
      sigOk: true,
    } as unknown as Message;
    const question = { seq: 2, from: "lead", ts: 2, kind: "ask", body: "Which?", to: ["jow-phone"], choices: ["A", "B"], esc: true, sigOk: true } as unknown as Message;
    deliver({ _tag: "Message", message: step, row: null });
    deliver({ _tag: "Message", message: question, row: null });
    await room.answerStep(1, { outcome: "cant", reason: "the Mac is away" });
    await room.answerStep(1, { outcome: "done", output: "signed 1.2.3" });
    const notAStep = await room.answerStep(2, { outcome: "done" }).then(
      () => null,
      (e: Error) => e.message,
    );
    room.stop();
    expect(sent.map((s) => s.body)).toEqual(["Can't do it: the Mac is away", "Done\n\nsigned 1.2.3"]);
    expect(sent[0]?.opts).toMatchObject({ to: ["lead"], re: [1], kind: "msg", side: true, stepReply: { outcome: "cant", reason: "the Mac is away" } });
    expect(sent[1]?.opts).toMatchObject({ to: ["lead"], re: [1], kind: "msg", side: true, stepReply: { outcome: "done", output: "signed 1.2.3" } });
    expect(notAStep).toBe("that step isn't here any more");
  });
});
