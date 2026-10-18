import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let roster: Roster;
let seq = 0;

async function signed(from: string, ev: Event, ts: number): Promise<Omit<Message, "seq" | "rts" | "sigOk">> {
  return sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev, ts });
}
async function at(p: Omit<Message, "seq" | "rts" | "sigOk">, rts: number): Promise<Message> {
  seq++;
  return { ...p, seq, rts, sigOk: await verify(p) } as Message;
}

beforeAll(async () => {
  for (const n of ["jon", "bot"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human", sponsor: { user: "u-jon", name: "Jon", handle: "jon" } },
    { name: "bot", pk: ids.bot!.pk, owner: false, at: 1, active: true, kind: "agent" },
  ];
});

describe("a message counts once, at the time it was sent", () => {
  test("a copy of the owner's earlier hold posted again is refused, and the later hold stands", async () => {
    const off = await signed("jon", { op: "hold.set", on: false }, 1000);
    const on = await signed("jon", { op: "hold.set", on: true }, 2000);
    const msgs = [await at(off, 1000), await at(on, 2000)];
    const copy = await at(off, 3000);
    const s = fold([...msgs, copy], roster, 4000);
    expect(s.hold?.by).toBe("jon");
    expect(s.trust.get(copy.seq)).toBe("refused");
    expect(s.rejected.get(copy.seq)).toBe(`a copy of #${msgs[0]!.seq}, sent again`);
  });

  test("the copy is refused across an incremental fold, from the snapshot it kept", async () => {
    const off = await signed("jon", { op: "hold.set", on: false }, 1000);
    const first = await at(off, 1000);
    let base: FoldBase | null = null;
    fold([first], roster, 2000, null, null, null, (b) => (base = b));
    const copy = await at(off, 3000);
    const s = fold([first, copy], roster, 4000, null, null, base);
    expect(s.trust.get(copy.seq)).toBe("refused");
  });

  test("a message signed more than a day before the relay got it is refused", async () => {
    const day = 24 * 3_600_000;
    const old = await at(await signed("jon", { op: "hold.set", on: true }, 1000), 1000 + day + 1);
    const late = await at(await signed("jon", { op: "hold.set", on: true }, 1000), 1000 + day - 1);
    expect(fold([old], roster, old.rts!).trust.get(old.seq)).toBe("refused");
    expect(fold([late], roster, late.rts!).trust.get(late.seq)).toBe("verified");
  });

  test("the same text sent twice is two messages: each has its own id", async () => {
    const a = await at(await signed("bot", { op: "fact.set", key: "k", value: "v" } as Event, 1000), 1000);
    const b = await at(await signed("bot", { op: "fact.set", key: "k", value: "v" } as Event, 1000), 1000);
    const s = fold([a, b], roster, 2000);
    expect(s.trust.get(a.seq)).not.toBe("refused");
    expect(s.trust.get(b.seq)).not.toBe("refused");
  });
});
