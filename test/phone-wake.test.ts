import { describe, expect, test } from "bun:test";
import { wakeList } from "@kiwi/core/phone-wake.ts";
import { MAX_WAKE } from "@kiwi/core/push.ts";
import { dmPlace, MAIN, type ChannelState, type Member } from "@kiwi/core/state.ts";

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

function channel(extra: Member[] = []): Pick<ChannelState, "members" | "lead" | "roomOf" | "placeOf"> {
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
  return {
    members: new Map(members.map((m) => [m.name, m])),
    lead: "atlas",
    roomOf: new Map([
      [10, "general"],
      [11, "general"],
      [12, "design"],
    ]),
    placeOf: new Map([
      [10, MAIN],
      [11, { kind: "task" as const, task: 7 }],
      [12, MAIN],
      [13, dmPlace("atlas", "jow")],
    ]),
  };
}

const pks = (...names: string[]) => names.map((n) => `${n}-pk`.padEnd(43, "x"));
const sorted = (xs: string[]) => [...xs].sort();

describe("whose phones a message wakes", () => {
  const state = channel();

  test("in #general, everyone it's to and everyone it mentions, on every seat they have", () => {
    expect(sorted(wakeList(state, "atlas", "done, @maya can check", { to: ["jow"] }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone", "maya", "maya-phone")));
  });

  test("never agents, and never the sender's own seats", () => {
    expect(wakeList(state, "atlas", "@win look", {})).toEqual([]);
    expect(sorted(wakeList(state, "jow-2", "@jow note to self, @maya see this", {}))).toEqual(sorted(pks("maya", "maya-phone")));
  });

  test("not in a task thread, another room, a DM that isn't the lead's, or for events", () => {
    expect(wakeList(state, "win", "hi", { to: ["jow"], task: 7 })).toEqual([]);
    expect(wakeList(state, "win", "hi", { to: ["jow"], room: "design" })).toEqual([]);
    expect(wakeList(state, "win", "hi", { to: ["jow"], dm: true })).toEqual([]);
    expect(wakeList(state, "atlas", "@jow", { kind: "event", to: ["jow"] })).toEqual([]);
  });

  test("the lead chat wakes the person in it, never the lead", () => {
    expect(sorted(wakeList(state, "atlas", "a word", { to: ["jow"], dm: true }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone")));
    expect(sorted(wakeList(state, "maya", "a word", { to: ["atlas"], dm: true }))).toEqual([]);
  });

  test("a reply goes where its parent is", () => {
    expect(sorted(wakeList(state, "win", "yes", { to: ["jow"], re: [10] }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone")));
    expect(wakeList(state, "win", "yes", { to: ["jow"], re: [11] })).toEqual([]);
    expect(wakeList(state, "win", "yes", { to: ["jow"], re: [12] })).toEqual([]);
    expect(sorted(wakeList(state, "atlas", "yes", { to: ["jow"], re: [13] }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone")));
  });

  test("an escalated ask wakes whom it's to and who answers decisions, from anywhere; a step only whom it's to", () => {
    expect(sorted(wakeList(state, "win", "which one?", { kind: "ask", esc: true, to: ["jow"], task: 7 }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone", "maya", "maya-phone")));
    expect(sorted(wakeList(state, "win", "do this", { kind: "ask", esc: true, to: ["jow"], task: 7, step: { holds: ["T7"] } }))).toEqual(sorted(pks("jow", "jow-2", "jow-phone")));
    expect(wakeList(state, "win", "which one?", { kind: "ask", to: ["jow"], task: 7 })).toEqual([]);
  });

  test("someone who left isn't woken, and the list stops at MAX_WAKE", () => {
    expect(wakeList(channel([seat("gone", { active: false })]), "atlas", "@gone", {})).toEqual([]);
    const crowd = Array.from({ length: MAX_WAKE + 5 }, (_, i) => seat(`p${i}`));
    expect(wakeList(channel(crowd), "atlas", crowd.map((m) => `@${m.name}`).join(" "), {})).toHaveLength(MAX_WAKE);
  });
});
