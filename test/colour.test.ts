// One colour per person, unique in the channel; an agent wears its person's unless it's given its own.

import { beforeAll, describe, expect, test } from "bun:test";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormedEvent, type Event, type Message } from "@kiwi/core/protocol.ts";
import { colorOf, fold, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
const roster: Roster = [];
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

beforeAll(async () => {
  const people = [
    ["jonatas", { kind: "human" as const, owner: true, sponsor: { user: "u_jon", name: "Jonatas" } }],
    ["ana", { kind: "human" as const, sponsor: { user: "u_ana", name: "Ana" } }],
    ["bob", { kind: "human" as const, sponsor: { user: "u_bob", name: "Bob" } }],
    ["claude", { kind: "agent" as const, sponsor: { user: "u_jon", name: "Jonatas" } }],
    ["stray", { kind: "agent" as const, sponsor: { user: "u_nobody", name: "Nobody" } }],
  ] as const;
  for (const [name, extra] of people) {
    ids[name] = await generateIdentity(name);
    roster.push({ name, pk: ids[name]!.pk, owner: false, at: roster.length, active: true, ...extra });
  }
});

describe("colours", () => {
  test("a person picks their own; the first to pick a colour keeps it", async () => {
    const ms = [await ev("ana", { op: "color.set", member: "ana", color: "teal" }), await ev("bob", { op: "color.set", member: "bob", color: "teal" })];
    const s = fold(ms, roster);
    expect(colorOf(s, "ana")).toBe("teal");
    expect(colorOf(s, "bob")).toBeNull();
    expect(s.rejected.get(2)).toBe("teal is ana's colour");
  });

  test("only that person or the owner sets a person's colour", async () => {
    const ms = [await ev("bob", { op: "color.set", member: "ana", color: "red" }), await ev("jonatas", { op: "color.set", member: "ana", color: "blue" })];
    const s = fold(ms, roster);
    expect(colorOf(s, "ana")).toBe("blue");
    expect(s.rejected.get(ms[0]!.seq)).toContain("only that person or the owner");
  });

  test("the owner picks an agent's colour, the agent can't, and it can match someone else's (T1528)", async () => {
    const ms = [
      await ev("claude", { op: "color.set", member: "claude", color: "pink" }),
      await ev("bob", { op: "color.set", member: "claude", color: "green" }),
      await ev("jonatas", { op: "color.set", member: "ana", color: "pink" }),
      await ev("jonatas", { op: "color.set", member: "claude", color: "pink" }),
    ];
    const s = fold(ms, roster);
    expect(s.rejected.get(ms[0]!.seq)).toContain("sets an agent's colour");
    expect(s.rejected.get(ms[1]!.seq)).toContain("sets an agent's colour");
    expect(s.rejected.has(ms[3]!.seq)).toBe(false);
    expect(colorOf(s, "claude")).toBe("pink");
  });

  test("an agent's own colour wins over its person's, and clearing it goes back (T1528)", async () => {
    const set = await ev("jonatas", { op: "color.set", member: "jonatas", color: "violet" });
    const own = await ev("jonatas", { op: "color.set", member: "claude", color: "teal" });
    expect(colorOf(fold([set, own], roster), "claude")).toBe("teal");
    const clear = await ev("jonatas", { op: "color.set", member: "claude", color: null });
    expect(colorOf(fold([set, own, clear], roster), "claude")).toBe("violet");
  });

  test("agents wear their person's colour, when that person is in the channel", async () => {
    const s = fold([await ev("jonatas", { op: "color.set", member: "jonatas", color: "violet" })], roster);
    expect(colorOf(s, "claude")).toBe("violet");
    expect(colorOf(s, "stray")).toBeNull();
  });

  test("clearing frees a colour for someone else", async () => {
    const ms = [
      await ev("ana", { op: "color.set", member: "ana", color: "green" }),
      await ev("ana", { op: "color.set", member: "ana", color: null }),
      await ev("bob", { op: "color.set", member: "bob", color: "green" }),
    ];
    const s = fold(ms, roster);
    expect(colorOf(s, "ana")).toBeNull();
    expect(colorOf(s, "bob")).toBe("green");
    expect(describeEvent(ms[1]!, s)).toBe("cleared their colour");
    expect(describeEvent(ms[2]!, s)).toBe("picked the colour green");
  });

  test("colours from admission records stay unique: who joined first keeps it", () => {
    const r: Roster = roster.map((m) => (m.name === "ana" || m.name === "bob" ? { ...m, color: "red" as const } : m));
    const s = fold([], r);
    expect(colorOf(s, "ana")).toBe("red");
    expect(colorOf(s, "bob")).toBeNull();
  });

  test("only the palette's colours are well formed", () => {
    expect(wellFormedEvent({ op: "color.set", member: "ana", color: "teal" })).toBe(true);
    expect(wellFormedEvent({ op: "color.set", member: "ana", color: null })).toBe(true);
    expect(wellFormedEvent({ op: "color.set", member: "ana", color: "#ff0000" })).toBe(false);
    expect(wellFormedEvent({ op: "color.set", member: "ana" })).toBe(false);
  });
});
