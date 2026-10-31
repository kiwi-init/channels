import { describe, expect, test } from "bun:test";
import type { ChannelState } from "@kiwi/core/state.ts";
import { prunePlan } from "./prune-plan.ts";

const ALL = { addsAgents: true, answersDecisions: true, managesAgents: true };
const person = (name: string, pk: string, more: object = {}) =>
  [name, { name, pk, kind: "human" as const, owner: false, active: true, scopes: ["post" as const], joined: 0, lastSeen: 0, messages: 0, ...more }] as const;

function state(roomMembers: string[], people: ReturnType<typeof person>[]): Pick<ChannelState, "rooms" | "members"> {
  return {
    members: new Map(people) as unknown as ChannelState["members"],
    rooms: new Map([["r", { id: "r", name: "secret", createdBy: "x", at: 0, members: roomMembers.map((pk) => ({ name: pk, pk })) }]]),
  };
}

describe("one app rotates a private room when one of its members leaves the channel (T681)", () => {
  const people = [person("jow", "pk-jow", { owner: true }), person("tia", "pk-tia", ALL), person("tib", "pk-tib", ALL), person("gone", "pk-gone", { active: false })];

  test("the owner, when they're in the room; the trusted members wait a minute in case the owner's app isn't open", () => {
    const s = state(["pk-jow", "pk-tia", "pk-tib", "pk-gone"], people);
    expect(prunePlan(s, "pk-jow")).toEqual({ now: ["r"], later: [] });
    expect(prunePlan(s, "pk-tia")).toEqual({ now: [], later: ["r"] });
    expect(prunePlan(s, "pk-tib")).toEqual({ now: [], later: ["r"] });
  });

  test("without the owner in it, the fully trusted member with the lowest key", () => {
    const s = state(["pk-tib", "pk-tia", "pk-gone"], people);
    expect([prunePlan(s, "pk-tia").now, prunePlan(s, "pk-tib").now]).toEqual([["r"], []]);
  });

  test("nothing while everyone in it is still here, or for someone who isn't in it", () => {
    expect(prunePlan(state(["pk-jow", "pk-tia"], people), "pk-jow")).toEqual({ now: [], later: [] });
    expect(prunePlan(state(["pk-tia", "pk-gone"], people), "pk-jow")).toEqual({ now: [], later: [] });
  });
});

describe("one app seals a person's new device into the private rooms they're in (T1046)", () => {
  const people = [
    person("jow", "pk-jow", { owner: true }),
    person("tia", "pk-tia", { ...ALL, sponsor: { user: "p-tia", name: "tia", handle: "tia" } }),
    person("tia-2", "pk-tia-2", { sponsor: { user: "p-tia", name: "tia", handle: "tia" } }),
    person("ana", "pk-ana", { kind: "agent", sponsor: { user: "p-tia", name: "tia", handle: "tia" } }),
  ];

  test("the person's phone isn't in a room made for them yet: the owner seals it in", () => {
    expect(prunePlan(state(["pk-jow", "pk-tia"], people), "pk-jow")).toEqual({ now: ["r"], later: [] });
  });

  test("nothing once the phone is in, and an agent of theirs is never brought in as a device", () => {
    expect(prunePlan(state(["pk-jow", "pk-tia", "pk-tia-2"], people), "pk-jow")).toEqual({ now: [], later: [] });
  });
});
