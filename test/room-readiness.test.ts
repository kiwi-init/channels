import { beforeAll, describe, expect, test } from "bun:test";
import { hear } from "@kiwi/channel/online.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { EVENT_OPS_VERSION, PRIVATE_ROOM_OPS, wellFormed, type Message } from "@kiwi/core/protocol.ts";
import { roomReadiness } from "@kiwi/core/room-rules.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
let roster: Roster;

async function msg(from: string, ops?: number, key = from): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "msg" as const, body: `hi ${seq}`, ts: seq, ...(ops !== undefined ? { ops } : {}) };
  const p = await sign(ids[key]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

beforeAll(async () => {
  for (const n of ["jon", "ana", "ana-phone", "bo"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "human" },
    { name: "ana", pk: ids["ana-phone"]!.pk, owner: false, at: 1, active: true, kind: "human" },
    { name: "bo", pk: ids.bo!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("which members can read a private room (T869)", () => {
  test("a message says which event ops its client knows, and an old validator's rules still take it", async () => {
    const m = await msg("ana", EVENT_OPS_VERSION);
    expect(wellFormed(m)).toBe(true);
    expect(wellFormed({ ...m, ops: 0 })).toBe(false);
    expect(wellFormed({ ...m, ops: "9" })).toBe(false);
    expect(wellFormed({ ...m, ops: undefined })).toBe(true);
  });

  test("the fold keeps each key's latest signed ops, and a base carries it", async () => {
    const ms = [await msg("ana", 8), await msg("ana", EVENT_OPS_VERSION), await msg("ana", undefined, "ana-phone"), await msg("bo")];
    let base: FoldBase | null = null;
    const s = fold(ms, roster, Date.now(), null, null, null, (b) => (base = b));
    expect(base).not.toBeNull();
    expect(s.members.get("ana")!.ops).toEqual({ [ids.ana!.pk]: EVENT_OPS_VERSION, [ids["ana-phone"]!.pk]: 0 });
    expect(s.members.get("bo")!.ops).toEqual({ [ids.bo!.pk]: 0 });
    expect(s.members.get("jon")!.ops).toBeUndefined();
    const again = fold([...ms, await msg("bo", EVENT_OPS_VERSION)], roster, Date.now(), null, null, base);
    expect(again.members.get("ana")!.ops).toEqual(s.members.get("ana")!.ops);
    expect(again.members.get("bo")!.ops).toEqual({ [ids.bo!.pk]: EVENT_OPS_VERSION });
  });

  test("a forged message says nothing about anyone's app", async () => {
    const forged = { ...(await msg("ana", EVENT_OPS_VERSION, "bo")) };
    expect(fold([forged], roster).members.get("ana")!.ops).toBeUndefined();
  });

  test("ready, old or not seen: no ops is not seen, a lower one is old, and live presence only ever helps", () => {
    const need = PRIVATE_ROOM_OPS;
    expect(roomReadiness(undefined, [], need)).toBe("unseen");
    expect(roomReadiness({ a: 0 }, [], need)).toBe("unseen");
    expect(roomReadiness({ a: need }, [], need)).toBe("ready");
    expect(roomReadiness({ a: need, b: 0 }, [], need)).toBe("ready");
    expect(roomReadiness({ a: need, b: need - 1 }, [], need)).toBe("old");
    expect(roomReadiness({ a: need - 1 }, [need], need)).toBe("ready");
    expect(roomReadiness(undefined, [need], need)).toBe("ready");
    expect(roomReadiness({ a: need }, [need - 1], need)).toBe("ready");
  });

  test("a presence beacon's ops reaches the app's list of who's online, and a bad one doesn't", async () => {
    const at = Date.now();
    const p = { v: 1 as const, type: "presence" as const, from: "ana", client: "app", ts: at, pk: "k", sigOk: true };
    expect(hear(new Map(), { ...p, ops: EVENT_OPS_VERSION }, at).get("k")?.ops).toBe(EVENT_OPS_VERSION);
    expect(hear(new Map(), { ...p, ops: -1 }, at).get("k")?.ops).toBeUndefined();
  });
});
