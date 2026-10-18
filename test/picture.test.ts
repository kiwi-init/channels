// A person's face: a small picture they publish themselves; agents keep their character.

import { beforeAll, describe, expect, test } from "bun:test";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { MAX_PICTURE_BYTES, isQuiet, wellFormedEvent, type Event, type MemberPicture, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
const roster: Roster = [];
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const face: MemberPicture = { mime: "image/png", data: btoa("a tiny png, for the test") };

beforeAll(async () => {
  const people = [
    ["jonatas", { kind: "human" as const, owner: true, sponsor: { user: "u_jon", name: "Jonatas" } }],
    ["ana", { kind: "human" as const, sponsor: { user: "u_ana", name: "Ana" } }],
    ["claude", { kind: "agent" as const, sponsor: { user: "u_jon", name: "Jonatas" } }],
  ] as const;
  for (const [name, extra] of people) {
    ids[name] = await generateIdentity(name);
    roster.push({ name, pk: ids[name]!.pk, owner: false, at: roster.length, active: true, ...extra });
  }
});

describe("pictures", () => {
  test("a person sets their own, and null clears it", async () => {
    const set = await ev("ana", { op: "picture.set", member: "ana", picture: face });
    expect(fold([set], roster).members.get("ana")?.picture).toEqual(face);
    const cleared = await ev("ana", { op: "picture.set", member: "ana", picture: null });
    expect(fold([set, cleared], roster).members.get("ana")?.picture).toBeUndefined();
  });

  test("only that person sets it, not even the owner, and agents have none", async () => {
    const ms = [await ev("jonatas", { op: "picture.set", member: "ana", picture: face }), await ev("claude", { op: "picture.set", member: "claude", picture: face })];
    const s = fold(ms, roster);
    expect(s.members.get("ana")?.picture).toBeUndefined();
    expect(s.rejected.get(ms[0]!.seq)).toContain("only that person sets their picture");
    expect(s.rejected.get(ms[1]!.seq)).toContain("agents wear their character");
  });

  test("a well-formed picture is a raster image of at most 24 KB in base64; anything else is refused", () => {
    const ok = (picture: unknown) => wellFormedEvent({ op: "picture.set", member: "ana", picture });
    expect(ok(face)).toBe(true);
    expect(ok(null)).toBe(true);
    expect(ok({ mime: "image/svg+xml", data: face.data })).toBe(false);
    expect(ok({ mime: "image/png", data: "not base64!" })).toBe(false);
    expect(ok({ mime: "image/png", data: "" })).toBe(false);
    expect(ok({ mime: "image/png", data: "A".repeat(Math.ceil((MAX_PICTURE_BYTES * 4) / 3) + 8) })).toBe(false);
  });

  test("it's quiet in the conversation, and reads as a plain event line", async () => {
    const m = await ev("ana", { op: "picture.set", member: "ana", picture: face });
    expect(isQuiet(m)).toBe(true);
    expect(describeEvent(m)).toBe("set their picture");
  });

  test("a snapshot carries it", async () => {
    let base: FoldBase | null = null;
    const set = await ev("ana", { op: "picture.set", member: "ana", picture: face });
    fold([set], roster, Date.now(), null, null, null, (b) => (base = b));
    expect(base).not.toBeNull();
    expect(fold([], roster, Date.now(), null, null, base).members.get("ana")?.picture).toEqual(face);
  });
});
