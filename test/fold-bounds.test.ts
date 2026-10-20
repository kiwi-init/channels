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
const roster: Roster = [
  { name: "jow", pk: OWNER, owner: true, at: 0, active: true, kind: "human" },
  { name: "win", pk: WIN, owner: false, at: 0, active: true, kind: "agent", scopes: ["post", "tasks"] },
];

function msg(seq: number, ts: number, over: Partial<Message> = {}): Message {
  const from = over.from ?? "win";
  return { v: PROTOCOL_VERSION, id: `m${seq}`, from, kind: "msg", body: `message ${seq}`, ts, rts: ts, seq, sigOk: true, pk: from === "jow" ? OWNER : WIN, ...over };
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
    expect(base.sentFloor).toBe(T0 + 26_999 * 1_000 + 1);
    expect(base.hw).toBe(T0 + 29_999 * 1_000);
    const owner = await generateIdentity("jow");
    const sealed = await sealSnapshot(owner, { roomId: "ab".repeat(16), ownerPk: owner.pk, ownerXpk: owner.xpk ?? "", epoch: 0, keys: { "0": newChannelKey() } }, base);
    expect(sealed).not.toBeNull();
    expect(sealed!.ct.length).toBeLessThan(MAX_SNAPSHOT_LENGTH / 2);
  });

  test("an id the cap dropped is refused by the floor if it comes back", () => {
    const messages = Array.from({ length: 4_000 }, (_, i) => msg(i + 1, T0 + i * 1_000));
    const base = baseOf(messages);
    expect(base.sentFloor).toBe(T0 + 999 * 1_000 + 1);
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
});
