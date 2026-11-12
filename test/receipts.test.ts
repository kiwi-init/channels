import { describe, expect, test } from "bun:test";

import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";

import { addMarks, onIt, readAt, receipt, recipients, waitsLines, waitsOf, type Busy, type Marks, type Reach, type Reached } from "@kiwi/core/receipts.ts";

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
const general = { rooms: new Map(), roomOf: new Map() };
const state = (over: Partial<Pick<ChannelState, "lead" | "tasks">> = {}) => ({ members, tasks: new Map(), lead: null, ...general, ...over }) as unknown as Reach;
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

describe("a message in a room goes to the agents the room reaches (T1000)", () => {
  const seats = new Map([...members].map(([name, who]) => [name, { ...who, name, pk: `pk-${name}` }]));
  const rooms = new Map([
    ["r-mobile", { id: "r-mobile", name: "mobile", createdBy: "jon", at: 0, posters: ["jon", "atlas"] }],
    [
      "r-ops",
      {
        id: "r-ops",
        name: "ops",
        createdBy: "jon",
        at: 0,
        posters: ["jon"],
        members: [
          { name: "jon", pk: "pk-jon" },
          { name: "dev", pk: "pk-dev" },
        ],
      },
    ],
  ]);
  const roomOf = new Map([
    [10, "r-mobile"],
    [11, "r-ops"],
  ]);
  const inRooms = (lead: string | null = null) => ({ members: seats, tasks: new Map(), lead, rooms, roomOf }) as unknown as Reach;

  test("the agent that posted there, not the ones that never did", () => {
    expect(recipients(msg(), inRooms())).toEqual(["atlas"]);
  });
  test("a mention reaches an agent that never posted there", () => {
    expect(recipients(msg({ body: "@win can you look?" }), inRooms()).sort()).toEqual(["atlas", "win"]);
  });
  test("the lead hears a person there, not another agent", () => {
    expect(recipients(msg(), inRooms("dev")).sort()).toEqual(["atlas", "dev"]);
    expect(recipients(msg({ from: "win" }), inRooms("dev"))).toEqual(["atlas"]);
  });
  test("named, it goes to who it names; to everyone, to every agent", () => {
    expect(recipients(msg({ to: ["win"] }), inRooms())).toEqual(["win"]);
    expect(recipients(msg({ to: ["*"] }), inRooms()).sort()).toEqual(["atlas", "dev", "win"]);
  });
  test("a private room reaches its members only: not the lead, not an outsider it mentions or names", () => {
    expect(recipients(msg({ seq: 11, body: "@win hello" }), inRooms("atlas"))).toEqual(["dev"]);
    expect(recipients(msg({ seq: 11, to: ["win", "dev"] }), inRooms())).toEqual(["dev"]);
    expect(recipients(msg({ seq: 11, to: ["*"] }), inRooms())).toEqual(["dev"]);
  });
  test("a message not placed yet is read by its own room; #general stays every agent", () => {
    expect(recipients(msg({ seq: 99, room: "r-mobile" }), inRooms())).toEqual(["atlas"]);
    expect(recipients(msg({ seq: 99 }), inRooms()).sort()).toEqual(["atlas", "dev", "win"]);
    expect(recipients(msg({ seq: 99, room: "general" }), inRooms()).sort()).toEqual(["atlas", "dev", "win"]);
  });
  test("both offline: only the one the room reaches is named, and a mention names the other", () => {
    const off = (): Reached => "asleep";
    const none = () => null;
    expect(waitsOf(msg(), [], inRooms(), new Map(), pks, off, none, () => false)?.asleep).toEqual(["atlas"]);
    expect(waitsOf(msg({ body: "@win too" }), [], inRooms(), new Map(), pks, off, none, () => false)?.asleep.sort()).toEqual(["atlas", "win"]);
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
    const st = { members: quiet, tasks: new Map(), coordinator: null, ...general } as unknown as Reach;
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
    ({ members, tasks: new Map(), lead: null, ...general, facts: new Map(facts.map(([k, f]) => [k, { key: k, by: f.value, ts: 0, seq: 1, ...f }])) }) as unknown as Reach & Pick<ChannelState, "facts">;
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
    ({ members: nicked, tasks: new Map(), lead: null, ...general, facts: new Map(facts.map(([k, f]) => [k, { key: k, by: f.value, ts: 0, seq: 1, ...f }])) }) as unknown as Reach &
      Pick<ChannelState, "facts">;
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

describe("what a person's message waits on: who can't be woken, who isn't listening, who is busy (T614)", () => {
  const tasks = new Map([
    [31, { id: 31, owner: "win", state: "doing" }],
    [40, { id: 40, owner: "win", state: "todo" }],
    [7, { id: 7, owner: "atlas", state: "doing" }],
  ]);
  const st = (lead: string | null = "atlas") => ({ members, tasks, lead, ...general }) as unknown as Reach;
  const how = (who: Record<string, Reached>) => (n: string) => who[n] ?? null;
  const doing = (who: Record<string, Busy>) => (n: string) => who[n] ?? null;
  const none = () => false;
  const here = how({ atlas: "here", win: "here", dev: "here" });
  const log = [
    msg({ seq: 4, to: ["win"] }),
    msg({ seq: 6, to: ["win"] }),
    msg({ seq: 7, from: "win", to: ["jon"] }),
    msg({ seq: 8, to: ["atlas"] }),
    msg({ seq: 9, kind: "event" as Message["kind"] }),
    msg({ seq: 10, from: "ana" }),
    msg({ seq: 12, to: ["win"] }),
  ];
  const mine = log.at(-1)!;
  const marks = addMarks(new Map(), [
    { pk: "pk-win", seq: 5, at: 100 },
    { pk: "pk-atlas", seq: 11, at: 100 },
    { pk: "pk-dev", seq: 11, at: 100 },
  ]);

  test("an agent that can't be woken, or that nothing answers for, is named", () => {
    expect(waitsOf(mine, log, st(), marks, pks, how({ win: "asleep" }), doing({}), none)).toEqual({ asleep: ["win"], silent: [], read: [], behind: null, ask: null });
    expect(waitsOf(mine, log, st(), marks, pks, how({ win: "silent" }), doing({}), none)).toEqual({ asleep: [], silent: ["win"], read: [], behind: null, ask: null });
  });

  test("an agent that never sent a mark is named too: it is gone whatever its kiwi", () => {
    expect(waitsOf(msg({ seq: 12, to: ["win"] }), log, st(), new Map(), pks, how({ win: "silent" }), doing({}), none)?.silent).toEqual(["win"]);
  });

  test("nothing once it has read the message, or once someone it went to has replied", () => {
    const read = addMarks(marks, [{ pk: "pk-win", seq: 12, at: 200 }]);
    expect(waitsOf(mine, log, st(), read, pks, how({ win: "asleep" }), doing({}), none)).toBeNull();
    expect(waitsOf(mine, log, st(), marks, pks, how({ win: "asleep" }), doing({}), (from) => from.includes("win"))).toBeNull();
  });

  test("nothing while reach is not known yet, and nothing for an agent that is free", () => {
    expect(waitsOf(mine, log, st(), marks, pks, how({}), doing({}), none)).toBeNull();
    expect(waitsOf(mine, log, st(), marks, pks, here, doing({}), none)).toBeNull();
  });

  test("a busy agent that has not read it: its task, the messages that reach it first, and the lead to ask", () => {
    const busy = doing({ win: { text: "running Bash", since: 1 } });
    expect(waitsOf(mine, log, st(), marks, pks, here, busy, none)).toEqual({
      asleep: [],
      silent: [],
      read: [],
      behind: { name: "win", busy: { text: "running Bash", since: 1 }, task: 31, ahead: 2 },
      ask: { to: "atlas", name: "atlas" },
    });
  });

  test("yours is next when nothing else went to it since it last read", () => {
    const caught = addMarks(marks, [{ pk: "pk-win", seq: 11, at: 200 }]);
    expect(waitsOf(mine, log, st(), caught, pks, here, doing({ win: { text: "thinking" } }), none)?.behind?.ahead).toBe(0);
  });

  test("no task to name when it is doing none", () => {
    const dev = msg({ seq: 12, to: ["dev"] });
    const behind = addMarks(new Map(), [{ pk: "pk-dev", seq: 11, at: 100 }]);
    expect(waitsOf(dev, log, st(), behind, pks, here, doing({ dev: { text: "thinking" } }), none)?.behind).toEqual({ name: "dev", busy: { text: "thinking" }, ahead: 0 });
  });

  test("an older kiwi sends no marks, so busy says nothing about it", () => {
    expect(waitsOf(mine, log, st(), new Map(), pks, here, doing({ win: { text: "thinking" } }), none)).toBeNull();
  });

  test("nobody to ask when there is no lead, the lead is the busy one, the lead is gone, or the lead wrote it", () => {
    const busy = doing({ win: { text: "thinking" }, atlas: { text: "thinking" } });
    expect(waitsOf(mine, log, st(null), marks, pks, here, busy, none)?.ask).toBeNull();
    expect(waitsOf(mine, log, st("win"), marks, pks, here, busy, none)?.ask).toBeNull();
    expect(waitsOf(mine, log, st(), marks, pks, how({ win: "here", atlas: "asleep" }), busy, none)?.ask).toBeNull();
    expect(waitsOf(msg({ seq: 12, from: "atlas", to: ["win"] }), log, st(), marks, pks, here, busy, none)?.ask).toBeNull();
  });

  test("a word to everyone: busy is said only when nobody has it and nobody is free, and it names the lead first", () => {
    const all = msg({ seq: 12 });
    const unread = addMarks(new Map(), [
      { pk: "pk-atlas", seq: 5, at: 1 },
      { pk: "pk-win", seq: 5, at: 1 },
      { pk: "pk-dev", seq: 5, at: 1 },
    ]);
    const everyone = doing({ atlas: { text: "thinking" }, win: { text: "thinking" }, dev: { text: "thinking" } });
    expect(waitsOf(all, log, st(), unread, pks, here, everyone, none)?.behind?.name).toBe("atlas");
    expect(waitsOf(all, log, st(), unread, pks, here, everyone, none)?.ask).toBeNull();
    expect(waitsOf(all, log, st(), unread, pks, here, doing({ win: { text: "thinking" }, dev: { text: "thinking" } }), none)).toBeNull();
    const leadHasIt = addMarks(unread, [{ pk: "pk-atlas", seq: 12, at: 2 }]);
    expect(waitsOf(all, log, st(), leadHasIt, pks, here, everyone, none)).toBeNull();
    expect(waitsOf(all, log, st(), leadHasIt, pks, how({ atlas: "here", win: "here", dev: "asleep" }), everyone, none)).toEqual({
      asleep: ["dev"],
      silent: [],
      read: ["atlas"],
      behind: null,
      ask: null,
    });
  });

  test("named to several: the one that gets to it first is shown", () => {
    const both = msg({ seq: 12, to: ["win", "dev"] });
    const unread = addMarks(new Map(), [
      { pk: "pk-win", seq: 5, at: 1 },
      { pk: "pk-dev", seq: 11, at: 1 },
    ]);
    expect(waitsOf(both, log, st(), unread, pks, here, doing({ win: { text: "thinking" }, dev: { text: "thinking" } }), none)?.behind?.name).toBe("dev");
  });

  test("the same states as lines for the command line, by handle", () => {
    const at = (n: string) => `@${n}`;
    const busy = waitsOf(mine, log, st(), marks, pks, here, doing({ win: { text: "running Bash" } }), none, at);
    expect(waitsLines(busy!)).toEqual(["@win is busy on T31 · 2 messages ahead of yours · @atlas, the lead, can take it sooner"]);
    const caught = addMarks(marks, [{ pk: "pk-dev", seq: 11, at: 200 }]);
    const next = waitsOf(msg({ seq: 12, to: ["dev"] }), log, st(null), caught, pks, here, doing({ dev: { text: "thinking" } }), none, at);
    expect(waitsLines(next!)).toEqual(["@dev is busy · thinking · yours is next"]);
    const gone = waitsOf(msg({ seq: 12, to: ["win", "dev", "atlas"] }), log, st(), marks, pks, how({ win: "asleep", dev: "silent", atlas: "silent" }), doing({}), none, at);
    expect(waitsLines(gone!)).toEqual(["@win can't be woken: nothing reaches it until a person opens its session", "@dev, @atlas aren't listening: no computer answers for them"]);
  });

  test("a long list of names is cut after three, with how many more", () => {
    const w = { asleep: ["@a", "@b", "@c", "@d", "@e"], silent: ["@f", "@g", "@h", "@i"], read: [], behind: null, ask: null };
    expect(waitsLines(w)).toEqual([
      "@a, @b, @c and 2 more can't be woken: nothing reaches them until a person opens their sessions",
      "@f, @g, @h and 1 more aren't listening: no computer answers for them",
    ]);
  });

  test("people see nicknames", () => {
    const nicked = new Map<string, Who & { display?: string }>([
      ...members,
      ["win", { kind: "agent", active: true, joined: 0, display: "coder" }],
      ["atlas", { kind: "agent", active: true, joined: 0, display: "lead" }],
    ]);
    const s = { members: nicked, tasks, lead: "atlas", ...general } as unknown as Reach;
    expect(waitsOf(mine, log, s, marks, pks, how({ win: "asleep" }), doing({}), none)?.asleep).toEqual(["coder"]);
    expect(waitsOf(mine, log, s, marks, pks, here, doing({ win: { text: "thinking" } }), none)?.ask).toEqual({ to: "atlas", name: "lead" });
  });
});
