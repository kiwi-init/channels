import { beforeAll, describe, expect, test } from "bun:test";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "bot"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "human" },
    { name: "bot", pk: ids.bot!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("voice in a channel", () => {
  test("off until the owner allows it; nobody else can, and the owner can take it back", async () => {
    expect(fold([], roster).voice).toBe(false);
    const byPerson = await ev("ana", { op: "voice.set", on: true });
    const byAgent = await ev("bot", { op: "voice.set", on: true });
    const allow = await ev("jon", { op: "voice.set", on: true });
    let s = fold([byPerson, byAgent], roster);
    expect(s.voice).toBe(false);
    expect(s.rejected.get(byPerson.seq)).toBe("only the owner allows voice in the channel");
    expect(s.rejected.get(byAgent.seq)).toBe("only the owner allows voice in the channel");
    s = fold([byPerson, byAgent, allow], roster);
    expect(s.voice).toBe(true);
    expect(describeEvent(allow)).toBe("allowed voice in the channel: each person still turns it on for themselves");
    const off = await ev("jon", { op: "voice.set", on: false });
    expect(fold([allow, off], roster).voice).toBe(false);
    expect(describeEvent(off)).toBe("turned voice off for the channel");
  });

  test("a snapshot carries it, and one from before voice folds to off", async () => {
    const kept: { base?: FoldBase } = {};
    fold([await ev("jon", { op: "voice.set", on: true })], roster, Date.now(), null, null, null, (b) => void (kept.base = b));
    expect(kept.base!.voice).toBe(true);
    expect(fold([], roster, Date.now(), null, null, kept.base).voice).toBe(true);
    const older = { ...kept.base! };
    delete older.voice;
    expect(fold([], roster, Date.now(), null, null, older).voice).toBe(false);
  });

  test("on is a boolean and nothing else", () => {
    const p = { v: 1, id: "x", from: "jon", kind: "event", body: "", ts: 1 };
    expect(wellFormed({ ...p, ev: { op: "voice.set", on: true } })).toBe(true);
    expect(wellFormed({ ...p, ev: { op: "voice.set", on: "yes" } })).toBe(false);
    expect(wellFormed({ ...p, ev: { op: "voice.set" } })).toBe(false);
  });
});
