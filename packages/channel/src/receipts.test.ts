import { describe, expect, test } from "bun:test";

import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";

import { addMarks, onIt, readAt, receipt, recipients, type Busy, type Marks } from "./receipts.ts";

type Who = { kind?: string; owner?: boolean; active: boolean; joined: number };
const members = new Map<string, Who>([
  ["jon", { kind: "human", owner: true, active: true, joined: 0 }],
  ["ana", { kind: "human", active: true, joined: 0 }],
  ["atlas", { kind: "agent", active: true, joined: 0 }],
  ["win", { kind: "agent", active: true, joined: 0 }],
  ["dev", { kind: "agent", active: true, joined: 0 }],
  ["late", { kind: "agent", active: true, joined: 5_000 }],
  ["gone", { kind: "agent", active: false, joined: 0 }],
  ["mac", { kind: "computer", active: true, joined: 0 }],
]);
const state = (over: Partial<Pick<ChannelState, "lead" | "tasks">> = {}) => ({ members, tasks: new Map(), lead: null, ...over }) as unknown as Pick<ChannelState, "members" | "tasks" | "lead">;
const msg = (over: Partial<Message> = {}): Message => ({ v: 1, id: "x", from: "jon", kind: "msg", body: "hi", ts: 1_000, rts: 1_000, seq: 10, sigOk: true, ...over }) as Message;
const pks = (n: string) => `pk-${n}`;
const time = (ts: number) => `t${ts}`;

describe("who a message went to", () => {
  test("the agents it names, never people, the sender, or someone gone", () => {
    expect(recipients(msg({ to: ["atlas", "ana", "gone"] }), state())).toEqual(["atlas"]);
  });
  test("a person's word to everyone goes to every agent there when it was sent, lead or not", () => {
    expect(recipients(msg(), state({ lead: "atlas" })).sort()).toEqual(["atlas", "dev", "win"]);
    expect(recipients(msg(), state()).sort()).toEqual(["atlas", "dev", "win"]);
  });
});

describe("read marks", () => {
  test("only marks that move a key forward are kept; the first one past a message dates it", () => {
    let marks: Marks = new Map();
    marks = addMarks(marks, [{ pk: "pk-atlas", seq: 8, at: 100 }]);
    marks = addMarks(marks, [{ pk: "pk-atlas", seq: 12, at: 200 }]);
    const same = addMarks(marks, [{ pk: "pk-atlas", seq: 12, at: 300 }]);
    expect(same).toBe(marks);
    expect(readAt(marks, "pk-atlas", 10)).toEqual({ at: 200 });
    expect(readAt(marks, "pk-atlas", 13)).toBeNull();
    expect(readAt(marks, undefined, 1)).toBeNull();
  });
});

describe("the line under your message", () => {
  const marks = addMarks(new Map(), [
    { pk: "pk-atlas", seq: 10, at: 500 },
    { pk: "pk-win", seq: 11, at: 700 },
    // dev marks too, just not this far yet.
    { pk: "pk-dev", seq: 5, at: 100 },
  ]);
  test("one recipient: Read with its time, or Delivered", () => {
    expect(receipt(msg({ to: ["atlas"] }), state(), marks, pks, time)).toBe("Read t500");
    expect(receipt(msg({ to: ["dev"] }), state(), marks, pks, time)).toBe("Delivered");
  });
  test("several: who has read it, or everyone with the latest time", () => {
    expect(receipt(msg({ to: ["atlas", "win", "dev"] }), state(), marks, pks, time)).toBe("Read by atlas, win");
    expect(receipt(msg({ to: ["atlas", "win"] }), state(), marks, pks, time)).toBe("Read by everyone t700");
  });
  test("nothing for a message to people only", () => {
    expect(receipt(msg({ to: ["ana"] }), state(), marks, pks, time)).toBeNull();
  });
  test("an agent that has never sent a mark (an older kiwi) isn't counted: no false Delivered", () => {
    const quiet = new Map<string, Who>([...members, ["old", { kind: "agent", active: true, joined: 0 }]]);
    const st = { members: quiet, tasks: new Map(), coordinator: null } as unknown as ReturnType<typeof state>;
    expect(receipt(msg({ to: ["old"] }), st, marks, pks, time)).toBeNull();
    expect(receipt(msg({ to: ["atlas", "old"] }), st, marks, pks, time)).toBe("Read t500");
  });
  test("from the snapshot on connect: Read, with no time (it only says how far, as of then)", () => {
    const snap = addMarks(new Map(), [{ pk: "pk-atlas", seq: 40, at: 9_000 }], true);
    expect(receipt(msg({ to: ["atlas"] }), state(), snap, pks, time)).toBe("Read");
    // A live mark after it dates newer messages as usual.
    const later = addMarks(snap, [{ pk: "pk-atlas", seq: 50, at: 9_500 }]);
    expect(receipt(msg({ to: ["atlas"], seq: 45 }), state(), later, pks, time)).toBe("Read t9500");
  });
});

describe("a reply in a thread, with a lead", () => {
  const marks = addMarks(new Map(), [
    { pk: "pk-atlas", seq: 30, at: 900 },
    { pk: "pk-win", seq: 12, at: 300 },
  ]);
  const coord = state({ lead: "atlas" });
  test("a reply named to the lead goes to it, and reads like any message", () => {
    const reply = msg({ seq: 20, re: [15], to: ["atlas"] });
    expect(recipients(reply, coord)).toEqual(["atlas"]);
    expect(receipt(reply, coord, marks, pks, time)).toBe("Read t900");
  });
  test("a reply named to an agent goes to that agent: Delivered until it reads that far", () => {
    const reply = msg({ seq: 20, re: [15], to: ["win"] });
    expect(recipients(reply, coord)).toEqual(["win"]);
    expect(receipt(reply, coord, marks, pks, time)).toBe("Delivered");
  });
  test("a reply to a person has no agent to read it: nothing", () => {
    expect(receipt(msg({ seq: 20, re: [15], to: ["ana"] }), coord, marks, pks, time)).toBeNull();
  });
});

describe("an automatic ack under a message: who is on it (T2035)", () => {
  const NOW = 1_000_000;
  const withFacts = (facts: [string, { value: string; expires?: number }][]) =>
    ({ members, tasks: new Map(), lead: null, facts: new Map(facts.map(([k, f]) => [k, { key: k, by: f.value, ts: 0, seq: 1, ...f }])) }) as unknown as Pick<
      ChannelState,
      "members" | "tasks" | "lead" | "facts"
    >;
  const doing = (who: Record<string, Busy>) => (n: string) => who[n] ?? null;
  const none = () => false;
  const m = msg({ to: ["atlas", "win"] });

  test("the agent holding its answering claim is on it, with what it's doing and for how long", () => {
    const s = withFacts([["answering #10", { value: "atlas", expires: NOW + 60_000 }]]);
    expect(onIt(m, s, new Map(), pks, doing({ atlas: { text: "thinking", since: NOW - 120_000 } }), none, NOW)).toBe("atlas is on it · thinking 2m");
    expect(onIt(m, s, new Map(), pks, doing({}), none, NOW)).toBe("atlas is on it");
  });

  test("without a claim, a recipient that was handed it and is busy now is on it", () => {
    const marks = addMarks(new Map(), [{ pk: "pk-win", seq: 10, at: 5 }]);
    expect(onIt(m, withFacts([]), marks, pks, doing({ win: { text: "running Bash" } }), none, NOW)).toBe("win is on it · running Bash");
  });

  test("nobody is on it: read but idle, busy but not handed it, an expired claim, or a claim by someone it didn't go to", () => {
    const marks = addMarks(new Map(), [{ pk: "pk-win", seq: 10, at: 5 }]);
    expect(onIt(m, withFacts([]), marks, pks, doing({}), none, NOW)).toBeNull();
    expect(onIt(m, withFacts([]), new Map(), pks, doing({ atlas: { text: "thinking" } }), none, NOW)).toBeNull();
    expect(onIt(m, withFacts([["answering #10", { value: "atlas", expires: NOW - 1 }]]), new Map(), pks, doing({}), none, NOW)).toBeNull();
    expect(onIt(m, withFacts([["answering #10", { value: "dev" }]]), new Map(), pks, doing({ dev: { text: "thinking" } }), none, NOW)).toBeNull();
  });

  test("gone once a recipient has replied", () => {
    const s = withFacts([["answering #10", { value: "atlas" }]]);
    expect(onIt(m, s, new Map(), pks, doing({ atlas: { text: "thinking" } }), (from) => from.includes("atlas"), NOW)).toBeNull();
  });
});

describe("people see agents by nickname in the ack and the receipt (#1681)", () => {
  const NOW = 1_000_000;
  const nicked = new Map<string, Who & { display?: string }>([
    ...members,
    ["atlas", { kind: "agent", active: true, joined: 0, display: "lead" }],
    ["win", { kind: "agent", active: true, joined: 0, display: "coder" }],
  ]);
  const s = (facts: [string, { value: string }][] = []) =>
    ({ members: nicked, tasks: new Map(), lead: null, facts: new Map(facts.map(([k, f]) => [k, { key: k, by: f.value, ts: 0, seq: 1, ...f }])) }) as unknown as Pick<
      ChannelState,
      "members" | "tasks" | "lead" | "facts"
    >;
  const marks = addMarks(new Map(), [
    { pk: "pk-atlas", seq: 10, at: 500 },
    { pk: "pk-win", seq: 11, at: 700 },
    { pk: "pk-dev", seq: 5, at: 100 },
  ]);

  test("the receipt names its readers by nickname, and by handle only when they have none", () => {
    expect(receipt(msg({ to: ["atlas", "win", "dev"] }), s(), marks, pks, time)).toBe("Read by lead, coder");
    expect(receipt(msg({ to: ["atlas", "dev", "late"], ts: 6_000, rts: 6_000 }), s(), addMarks(marks, [{ pk: "pk-late", seq: 10, at: 800 }]), pks, time)).toBe("Read by lead, late");
  });

  test("the ack names the agent on it by nickname", () => {
    expect(
      onIt(
        msg({ to: ["atlas", "win"] }),
        s([["answering #10", { value: "atlas" }]]),
        new Map(),
        pks,
        () => ({ text: "thinking" }),
        () => false,
        NOW,
      ),
    ).toBe("lead is on it · thinking");
    expect(
      onIt(
        msg({ to: ["win"] }),
        s(),
        marks,
        pks,
        () => null,
        () => false,
        NOW,
      ),
    ).toBeNull();
    expect(
      onIt(
        msg({ to: ["win"] }),
        s(),
        marks,
        pks,
        (n) => (n === "win" ? { text: "running Bash" } : null),
        () => false,
        NOW,
      ),
    ).toBe("coder is on it · running Bash");
  });
});
