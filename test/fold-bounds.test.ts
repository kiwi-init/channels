import { describe, expect, test } from "bun:test";
import { newChannelKey } from "@kiwi/core/crypto.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { MAX_SNAPSHOT_LENGTH, PROTOCOL_VERSION, type Event, type Message } from "@kiwi/core/protocol.ts";
import { sealSnapshot } from "@kiwi/core/snapshot.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const OWNER = "o".repeat(43);
const WIN = "w".repeat(43);
const SPAM = "s".repeat(43);
const roster: Roster = [
  { name: "jow", pk: OWNER, owner: true, at: 0, active: true, kind: "human" },
  { name: "win", pk: WIN, owner: false, at: 0, active: true, kind: "agent", scopes: ["post", "tasks"] },
  { name: "spam", pk: SPAM, owner: false, at: 0, active: true, kind: "agent", scopes: ["post"] },
];
const PKS: Record<string, string> = { jow: OWNER, win: WIN, spam: SPAM };

function msg(seq: number, ts: number, over: Partial<Message> = {}): Message {
  const from = over.from ?? "win";
  return { v: PROTOCOL_VERSION, id: `m${seq}`, from, kind: "msg", body: `message ${seq}`, ts, rts: ts, seq, sigOk: true, pk: PKS[from], ...over };
}

function cutAt(messages: Message[], n: number) {
  const state = fold(messages.slice(n), roster, T0, null, null, baseOf(messages.slice(0, n)));
  return { trust: [...state.trust].filter(([seq]) => seq > messages.length - 5), rejected: [...state.rejected].filter(([seq]) => seq > messages.length - 5) };
}

const ev = (seq: number, ts: number, e: Event, from = "jow"): Message => msg(seq, ts, { kind: "event", body: "", ev: e, from });

function baseOf(messages: Message[], from?: FoldBase): FoldBase {
  let base: FoldBase | null = null;
  fold(messages, roster, T0, null, null, from, (b) => void (base = b));
  if (!base) throw new Error("no base");
  return base;
}

describe("the fold base stays bounded", () => {
  test("after 30,000 messages a second apart, the base seals well under the snapshot cap, keeping recent seqs and a capped set of ids", async () => {
    const messages = Array.from({ length: 30_000 }, (_, i) => msg(i + 1, T0 + i * 1_000, { id: crypto.randomUUID() }));
    const base = baseOf(messages);
    expect(base.trust.length).toBe(5_000);
    expect(base.trust[0]![0]).toBe(25_001);
    expect(base.sent!.length).toBe(3_000);
    expect(base.sentFloors).toEqual([[WIN, T0 + 26_999 * 1_000 + 1]]);
    expect(base.hw).toBe(T0 + 29_999 * 1_000);
    const owner = await generateIdentity("jow");
    const sealed = await sealSnapshot(owner, { roomId: "ab".repeat(16), ownerPk: owner.pk, ownerXpk: owner.xpk ?? "", epoch: 0, keys: { "0": newChannelKey() } }, base);
    expect(sealed).not.toBeNull();
    expect(sealed!.ct.length).toBeLessThan(MAX_SNAPSHOT_LENGTH / 2);
  });

  test("an id the cap dropped is refused by the floor if it comes back", () => {
    const messages = Array.from({ length: 4_000 }, (_, i) => msg(i + 1, T0 + i * 1_000));
    const base = baseOf(messages);
    expect(base.sentFloors).toEqual([[WIN, T0 + 999 * 1_000 + 1]]);
    const dropped = messages[10]!;
    const state = fold([{ ...dropped, seq: 4_001 }], roster, T0, null, null, base);
    expect(state.rejected.get(4_001)).toContain("too long before");
  });

  test("a replay is still refused after pruning: by its id within two days, by the high-water mark before that", () => {
    const messages = Array.from({ length: 4 * 24 * 60 }, (_, i) => msg(i + 1, T0 + i * MIN));
    const base = baseOf(messages);
    const old = messages[0]!;
    const recent = messages.at(-10)!;
    const next = messages.length + 1;
    const replayed = [
      { ...old, seq: next, rts: old.ts },
      { ...recent, seq: next + 1 },
    ];
    const state = fold(replayed, roster, T0, null, null, base);
    expect(state.trust.get(next)).toBe("refused");
    expect(state.rejected.get(next)).toContain("too long before");
    expect(state.trust.get(next + 1)).toBe("refused");
    expect(state.rejected.get(next + 1)).toContain(`a copy of #${recent.seq}`);
  });

  test("a member's far-future timestamp can't move the high-water mark", () => {
    const base = baseOf([msg(1, T0), msg(2, T0 + 10 * DAY, { rts: T0 + MIN })]);
    expect(base.hw).toBe(T0 + MIN);
    const state = fold([msg(3, T0 + 2 * MIN)], roster, T0, null, null, base);
    expect(state.trust.get(3)).toBe("verified");
  });

  test("tasks and PRs closed a month before the log's latest message shrink to a card, measured on log time", () => {
    const at = (d: number) => T0 + d * DAY;
    const messages = [
      ev(1, at(0), { op: "task.add", title: "old done", detail: "lots of detail" }),
      ev(2, at(0), { op: "task.update", task: 1, note: "a long note" }),
      ev(3, at(1), { op: "task.update", task: 1, state: "done" }),
      ev(4, at(1), { op: "task.add", title: "still open" }),
      ev(5, at(0), { op: "github", items: [{ event: "pull_request", repo: "o/r", number: 7, state: "closed", merged: true, title: "old pr", at: at(0) }] }),
      msg(6, at(40)),
    ];
    const base = baseOf(messages);
    const done = base.tasks.find((t) => t.id === 1)!;
    expect(done).toMatchObject({ id: 1, title: "old done", state: "done", notes: [], rounds: [] });
    expect(done.detail).toBeUndefined();
    expect(base.tasks.find((t) => t.id === 4)?.title).toBe("still open");
    expect(base.github?.prs.some((p) => p.number === 7)).toBe(false);
    expect(baseOf(messages).tasks).toEqual(base.tasks);
  });

  test("an open ask is kept without its image bytes", () => {
    const ask = msg(1, T0, { from: "jow", kind: "ask", to: ["win"], body: "which one?", imgs: [{ name: "a.png", mime: "image/png", data: "iVBORw0KGgo=" }] });
    const base = baseOf([ask]);
    expect(base.asks[0]?.imgs).toEqual([{ name: "a.png", mime: "image/png" }]);
  });

  test("the same log gives the same verdicts folded whole or from any cut, for a late honest message and after a member's future-dated spam", () => {
    const busy = Array.from({ length: 4_000 }, (_, i) => msg(i + 1, T0 + i * 1_000));
    const late = msg(4_001, T0 + 4_000 * 1_000 - 58 * MIN, { from: "jow", rts: T0 + 4_001 * 1_000 });
    const log = [...busy, late, msg(4_002, T0 + 4_002 * 1_000)];
    const whole = cutAt(log, 0);
    expect(whole.trust.find(([seq]) => seq === 4_001)?.[1]).toBe("verified");
    expect(cutAt(log, 3_400)).toEqual(whole);
    expect(cutAt(log, 4_000)).toEqual(whole);

    const spam = Array.from({ length: 3_000 }, (_, i) => msg(i + 101, T0 + 365 * DAY + i, { from: "spam", rts: T0 + (i + 101) * 1_000 }));
    const honest = Array.from({ length: 100 }, (_, i) => msg(i + 1, T0 + i * 1_000));
    const behind = msg(3_102, T0 + 3_100 * 1_000, { from: "jow", rts: T0 + 3_102 * 1_000 });
    const mixed = [...honest, ...spam, msg(3_101, T0 + 3_101 * 1_000), behind, msg(3_103, T0 + 3_103 * 1_000)];
    const all = cutAt(mixed, 0);
    expect(all.trust.find(([seq]) => seq === 3_102)?.[1]).toBe("verified");
    expect(cutAt(mixed, 3_000)).toEqual(all);
    expect(cutAt(mixed, 3_100)).toEqual(all);
  });

  test("a base from before this change keeps refusing replays of its ids after the upgrade, whatever the relay puts after it", () => {
    const messages = Array.from({ length: 6_000 }, (_, i) => msg(i + 1, T0 + i * 1_000));
    const fresh = baseOf(messages);
    const old: FoldBase = { ...fresh, sent: messages.map((m): [string, number] => [m.id, m.seq]), sentKeys: undefined, sentFloors: undefined, hw: undefined };
    const upgraded = baseOf(
      Array.from({ length: 10 }, (_, i) => msg(6_001 + i, T0 + (6_000 + i) * 1_000)),
      old,
    );
    const replay = { ...messages[999]!, seq: 6_011 };
    const state = fold([replay], roster, T0, null, null, upgraded);
    expect(state.rejected.get(6_011)).toContain("a copy of #1000");

    const backdated = baseOf(
      Array.from({ length: 500 }, (_, i) => msg(6_001 + i, T0 + (6_000 + i) * 1_000, { rts: T0 + (6_000 + i) * 1_000 - 3 * DAY })),
      old,
    );
    const honest = baseOf(
      Array.from({ length: 500 }, (_, i) => msg(6_501 + i, T0 + (6_500 + i) * 1_000)),
      backdated,
    );
    const again = { ...messages[5_990]!, seq: 7_001 };
    for (const base of [backdated, honest]) expect(fold([again], roster, T0, null, null, base).rejected.get(7_001)).toContain("a copy of #5991");

    const held = msg(6_001, T0 - 3 * DAY, { id: "held" });
    const forged = Array.from({ length: 499 }, (_, i) => msg(6_002 + i, T0 + (6_000 + i) * 1_000, { sigOk: false }));
    const afterHeld = baseOf([held, ...forged], old);
    const later = baseOf(
      Array.from({ length: 500 }, (_, i) => msg(6_501 + i, T0 + (6_500 + i) * 1_000)),
      afterHeld,
    );
    for (const base of [afterHeld, later, baseOf([held], old)]) expect(fold([{ ...again, seq: 7_001 }], roster, T0, null, null, base).rejected.get(7_001)).toContain("a copy of #5991");
  });

  test("a direct thread that's been quiet for thousands of messages keeps its place", () => {
    const dm = msg(1, T0, { from: "jow", to: ["win"], dm: true, body: "just us" });
    const log = [dm, ...Array.from({ length: 5_500 }, (_, i) => msg(i + 2, T0 + (i + 1) * 1_000))];
    const whole = fold(log, roster, T0, null, null);
    const fromBase = fold(log.slice(5_400), roster, T0, null, null, baseOf(log.slice(0, 5_400)));
    expect([...fromBase.places].map(([k, v]) => [k, v.count, v.last])).toEqual([...whole.places].map(([k, v]) => [k, v.count, v.last]));
    expect([...whole.places.keys()].some((k) => k.startsWith("dm"))).toBe(true);
  });

  test("a task carded long after it closed still needs its review when it's reopened and marked done", () => {
    const at = (d: number) => T0 + d * DAY;
    const log = [
      ev(1, at(0), { op: "task.add", title: "needs a review", owner: "win", review: "any" }),
      ev(2, at(0), { op: "task.update", task: 1, state: "doing" }, "win"),
      ev(3, at(1), { op: "task.update", task: 1, state: "done" }),
      msg(4, at(40)),
      ev(5, at(40), { op: "task.update", task: 1, state: "doing" }, "win"),
      ev(6, at(40), { op: "task.update", task: 1, state: "done" }, "win"),
    ];
    const whole = fold(log, roster, T0, null, null);
    const fromBase = fold(log.slice(4), roster, T0, null, null, baseOf(log.slice(0, 4)));
    expect(baseOf(log.slice(0, 4)).tasks[0]).toMatchObject({ review: "any", workedBy: ["win"] });
    expect(fromBase.tasks.get(1)?.state).toBe(whole.tasks.get(1)?.state);
    expect(fromBase.rejected.get(6)).toBe(whole.rejected.get(6));
  });

  test("one member's future-dated ids can't pin the cap: other keys' out-of-order and same-millisecond sends are still accepted", () => {
    const spam = Array.from({ length: 3_000 }, (_, i) => msg(i + 1, T0 + 365 * DAY + i, { from: "spam", rts: T0 + i }));
    const t = T0 + 3_000;
    const log = [...spam, msg(3_001, t + 5, { from: "jow" }), msg(3_002, t + 4, { from: "jow", rts: t + 6 }), msg(3_003, t + 5), msg(3_004, t + 5, { id: "same-ms" })];
    const whole = fold(log, roster, T0, null, null);
    for (const seq of [3_001, 3_002, 3_003, 3_004]) expect(whole.trust.get(seq)).toBe("verified");
    expect(cutAt(log, 3_001)).toEqual(cutAt(log, 0));
    expect(cutAt(log, 3_002)).toEqual(cutAt(log, 0));
  });

  test("a carded task reopened for review continues its round numbers, so a round 2 approval is accepted from a base as from the whole log", () => {
    const at = (d: number) => T0 + d * DAY;
    const log = [
      ev(1, at(0), { op: "task.add", title: "reviewed twice", owner: "win", review: "*" }),
      ev(2, at(0), { op: "task.update", task: 1, state: "review" }, "win"),
      ev(3, at(1), { op: "task.update", task: 1, state: "done", verdict: "approved", round: 1 }),
      msg(4, at(40)),
      ev(5, at(40), { op: "task.update", task: 1, state: "review" }, "win"),
      ev(6, at(40), { op: "task.update", task: 1, state: "done", verdict: "approved", round: 2 }),
    ];
    const whole = fold(log, roster, T0, null, null);
    const fromBase = fold(log.slice(4), roster, T0, null, null, baseOf(log.slice(0, 4)));
    expect(whole.tasks.get(1)?.state).toBe("done");
    expect(whole.rejected.get(6)).toBeUndefined();
    expect(fromBase.tasks.get(1)?.rounds.at(-1)?.n).toBe(2);
    expect(fromBase.tasks.get(1)?.state).toBe("done");
    expect(fromBase.rejected.get(6)).toBeUndefined();
  });

  test("a v5 base with more ids than fit under the cap upgrades to bases that seal, and still refuses replays of its ids", async () => {
    const messages = Array.from({ length: 20_000 }, (_, i) => msg(i + 1, T0 + i * 1_000, { id: crypto.randomUUID() }));
    const fresh = baseOf(messages);
    const v5: FoldBase = { ...fresh, sent: messages.map((m): [string, number] => [m.id, m.seq]), sentKeys: undefined, sentFloors: undefined, hw: undefined, oldSent: undefined };
    const upgraded = baseOf(
      Array.from({ length: 2_000 }, (_, i) => msg(20_001 + i, T0 + (20_000 + i) * 1_000, { id: crypto.randomUUID() })),
      v5,
    );
    const later = baseOf([msg(22_001, T0 + 22_000 * 1_000, { id: crypto.randomUUID() })], upgraded);
    expect(upgraded.oldSent?.length).toBe(20_000);
    const owner = await generateIdentity("jow");
    const access = { roomId: "ab".repeat(16), ownerPk: owner.pk, ownerXpk: owner.xpk ?? "", epoch: 0, keys: { "0": newChannelKey() } };
    for (const base of [upgraded, later]) {
      const sealed = await sealSnapshot(owner, access, base);
      expect(sealed).not.toBeNull();
      expect(fold([{ ...messages[12_345]!, seq: 22_002 }], roster, T0, null, null, base).rejected.get(22_002)).toContain("a copy of #12346");
    }
  });
});
