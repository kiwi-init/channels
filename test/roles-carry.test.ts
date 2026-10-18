import { beforeAll, describe, expect, test } from "bun:test";
import { formatStatus } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { briefText } from "../src/brief.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event, to?: string[]): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e, ...(to ? { to } : {}) });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

const ALL = ["post", "ask", "tasks", "claims", "facts"] as const;
let roster: Roster;
let log: Message[];

beforeAll(async () => {
  for (const n of ["jow", "puma", "wren", "otter"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "puma", pk: ids.puma!.pk, owner: false, at: 1, active: true, kind: "agent", scopes: [...ALL] },
    { name: "wren", pk: ids.wren!.pk, owner: false, at: 2, active: true, kind: "agent", scopes: ["post", "ask"], role: "frontend", about: "only web/" },
    { name: "otter", pk: ids.otter!.pk, owner: false, at: 3, active: true, kind: "agent", scopes: [] },
  ];
  log = [
    await ev("puma", { op: "hello" }),
    await ev("jow", { op: "role.set", member: "puma", role: "coordinator", about: "keeps the board" }, ["puma"]),
    await ev("jow", { op: "role.set", member: "wren", role: "frontend", about: "only web/" }, ["wren"]),
    await ev("jow", { op: "role.set", member: "otter", role: "tester" }, ["otter"]),
    await ev("jow", { op: "role.refuse", member: "otter" }),
  ];
});

describe("an old channel's roles read the same as personalities", () => {
  test("the lead stays the lead; a free-text role becomes a Builder named after it, its rules its instructions, its capabilities its scopes", () => {
    const s = fold(log, roster);
    expect(s.lead).toBe("puma");
    expect(s.members.get("puma")?.persona).toEqual({ name: "Lead", role: "lead", capabilities: ["write", "tasks", "assign", "notes"], areas: [], instructions: "keeps the board" });
    expect(s.members.get("wren")?.persona).toEqual({ name: "frontend", role: "builder", capabilities: ["write"], areas: [], instructions: "only web/" });
    expect(s.members.get("otter")?.persona).toEqual({ name: "tester", role: "builder", capabilities: [], areas: [], instructions: "" });
    expect(s.members.get("jow")?.persona).toBeUndefined();
    expect("role" in s.members.get("wren")!).toBe(false);
  });

  test("what each agent is told and what status shows say the same roles", () => {
    const s = fold(log, roster);
    const brief = (name: string) => briefText({ alias: "c", agent: name, mc: "kiwi", listen: "", persona: s.members.get(name)!.persona! });
    expect(brief("puma")).toContain("You join as Lead. You may write and ask, work tasks, assign work, set notes.");
    expect(brief("puma")).toContain("Your instructions: keeps the board");
    expect(brief("wren")).toContain("You join as frontend (Builder). You may write and ask.");
    expect(brief("otter")).toContain("You join as tester (Builder). You may only read.");
    const status = formatStatus({ alias: "c", me: "puma", state: s, online: new Map(), unread: 0, now: 0 });
    expect(status).toContain("you are puma (Lead)");
    expect(status).toContain("wren — frontend (Builder)");
  });

  test("from a snapshot the roles come out the same as from the whole log", () => {
    let base: FoldBase | undefined;
    fold(log.slice(0, 3), roster, Date.now(), undefined, undefined, undefined, (b) => (base = b));
    const s = fold(log, roster, Date.now(), undefined, undefined, base);
    expect(s.lead).toBe("puma");
    expect(s.members.get("wren")?.persona?.name).toBe("frontend");
    expect(s.members.get("otter")?.persona?.name).toBe("tester");
  });

  test("a personality the owner signs wins: a signed Lead takes over, and the old lead re-signed as a Builder isn't the lead", () => {
    const signedLead = roster.map((r) => (r.name === "otter" ? { ...r, persona: { name: "Lead", role: "lead" as const, capabilities: [], areas: [], instructions: "" } } : r));
    const s = fold(log, signedLead);
    expect(s.lead).toBe("otter");
    expect(s.members.get("puma")?.persona).toBeUndefined();
    const rebuilt = roster.map((r) => (r.name === "puma" ? { ...r, persona: { name: "Builder", role: "builder" as const, capabilities: ["write" as const], areas: [], instructions: "" } } : r));
    const t = fold(log, rebuilt);
    expect(t.lead).toBeNull();
    expect(t.members.get("puma")?.persona?.name).toBe("Builder");
  });
});
