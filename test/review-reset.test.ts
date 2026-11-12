import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "owl", "win", "mac", "zed", "kim"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "owl", pk: ids.owl!.pk, owner: false, at: 1, active: true, kind: "agent", role: "lead" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "zed", pk: ids.zed!.pk, owner: false, at: 4, active: true, kind: "agent" },
    { name: "kim", pk: ids.kim!.pk, owner: false, at: 5, active: true, kind: "agent" },
  ];
});

const S1 = "sessionAAAAAAAA1";
const S2 = "sessionBBBBBBBB2";
const card = (from: string, session?: string) => ev(from, { op: "card", harness: "codex", ...(session === undefined ? {} : { session }) });
const on = () => ev("jon", { op: "review.reset.set", on: true });
const review = (task: number, at: string) => ev("win", { op: "task.update", task, state: "review", at });
const approve = (from: string, task: number, round: number, at: string) => ev(from, { op: "task.update", task, state: "done", verdict: "approved", round, at });
const markOf = (s: ChannelState, name: string) => s.members.get(name)?.reset;

async function twoInReview(reviewer = "mac"): Promise<{ t1: number; t2: number; log: Message[] }> {
  const log: Message[] = [await on(), await card(reviewer, S1)];
  const a = await ev("owl", { op: "task.add", title: "One", owner: "win", review: reviewer });
  const b = await ev("owl", { op: "task.add", title: "Two", owner: "win", review: reviewer });
  log.push(a, b, await review(a.seq, "a1"), await review(b.seq, "b1"));
  return { t1: a.seq, t2: b.seq, log };
}

describe("the session fingerprint and the new ops are well formed", () => {
  test("a card takes a 16-character fingerprint and nothing else; the ops take their fields", async () => {
    const base = { v: 1 as const, id: "x", from: "mac", kind: "event" as const, body: "", ts: 1, sig: "s", pk: "p" };
    expect(wellFormed({ ...base, ev: { op: "card", session: S1 } })).toBe(true);
    for (const session of ["", "short", `${S1}x`, "has spaces 12345", 7]) expect(wellFormed({ ...base, ev: { op: "card", session } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "review.reset.set", on: true } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "review.reset.set", on: "yes" } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "review.reset.waive", member: "mac", waived: true } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "review.reset.waive", member: " ", waived: true } })).toBe(false);
  });
});

describe("off by default", () => {
  test("a verdict marks nobody and a second verdict from the same session goes through", async () => {
    const { t1, t2, log } = await twoInReview();
    const rest = [await approve("mac", t1, 1, "a1"), await approve("mac", t2, 1, "b1")];
    const s = fold([...log.slice(1), ...rest], roster);
    expect(s.reviewReset).toBe(false);
    expect(markOf(s, "mac")).toBeUndefined();
    expect(s.rejected.size).toBe(0);
  });
});

describe("a verdict marks the reviewer, and the mark is enforced in the fold", () => {
  test("the mark records the verdict and the session it came from", async () => {
    const { t1, log } = await twoInReview();
    const pass = await approve("mac", t1, 1, "a1");
    const s = fold([...log, pass], roster);
    expect(markOf(s, "mac")).toEqual({ kind: "needs", verdict: pass.seq, session: S1 });
  });

  test("an already-open second round waits: its verdict is refused, and the lead can move it", async () => {
    const { t1, t2, log } = await twoInReview();
    const pass = await approve("mac", t1, 1, "a1");
    const second = await approve("mac", t2, 1, "b1");
    const s = fold([...log, pass, second], roster);
    expect(s.rejected.get(second.seq)).toBe(`mac needs a fresh session since verdict #${pass.seq}: it gives T${t2}'s verdict from a new session, or the lead moves the review`);
    expect(s.tasks.get(t2)!.state).toBe("review");
    const moved = await ev("owl", { op: "task.update", task: t2, review: "zed" });
    const byZed = await approve("zed", t2, 1, "b1");
    const after = fold([...log, pass, second, moved, byZed], roster);
    expect(after.rejected.has(moved.seq)).toBe(false);
    expect(after.rejected.has(byZed.seq)).toBe(false);
    expect(after.tasks.get(t2)!.state).toBe("done");
  });

  test("moving review to a marked seat, claiming an open review and opening a round for it are refused", async () => {
    const { t1, log } = await twoInReview();
    const pass = await approve("mac", t1, 1, "a1");
    const c = await ev("owl", { op: "task.add", title: "Three", owner: "win", review: "zed" });
    const toMac = await ev("owl", { op: "task.update", task: c.seq, review: "mac" });
    const open = await ev("owl", { op: "task.add", title: "Four", owner: "win", review: "*" });
    const claim = await ev("mac", { op: "task.update", task: open.seq, claim: true, review: "mac" });
    const added = await ev("owl", { op: "task.add", title: "Five", owner: "win", review: "mac" });
    const round = await review(added.seq, "f1");
    const s = fold([...log, pass, c, toMac, open, claim, added, round], roster);
    expect(s.rejected.get(toMac.seq)).toBe(`mac needs a fresh session since verdict #${pass.seq}: T${c.seq}'s review goes to someone else until it rejoins from a new session`);
    expect(s.rejected.get(claim.seq)).toBe(`mac needs a fresh session since verdict #${pass.seq}: it takes T${open.seq}'s review from a new session`);
    expect(s.rejected.get(round.seq)).toBe(`mac needs a fresh session since verdict #${pass.seq}: T${added.seq} opens no round for it until it rejoins from a new session`);
  });
});

describe("what clears the mark", () => {
  test("only a valid, nonempty, different fingerprint clears it: the same one, none, or an empty one leaves it", async () => {
    const { t1, t2, log } = await twoInReview();
    const pass = await approve("mac", t1, 1, "a1");
    const same = await card("mac", S1);
    const none = await card("mac");
    const kept = fold([...log, pass, same, none], roster);
    expect(markOf(kept, "mac")?.kind).toBe("needs");
    const fresh = await card("mac", S2);
    const second = await approve("mac", t2, 1, "b1");
    const cleared = fold([...log, pass, same, none, fresh, second], roster);
    expect(cleared.rejected.has(second.seq)).toBe(false);
    expect(markOf(cleared, "mac")).toEqual({ kind: "needs", verdict: second.seq, session: S2 });
  });

  test("turning the setting off clears an existing mark; turning it on again marks nobody by itself", async () => {
    const { t1, log } = await twoInReview();
    const pass = await approve("mac", t1, 1, "a1");
    const off = await ev("jon", { op: "review.reset.set", on: false });
    const again = await on();
    const s = fold([...log, pass, off, again], roster);
    expect(markOf(s, "mac")).toBeUndefined();
  });

  test("waiving the seat clears an existing mark and keeps it from being marked", async () => {
    const { t1, t2, log } = await twoInReview();
    const pass = await approve("mac", t1, 1, "a1");
    const waive = await ev("jon", { op: "review.reset.waive", member: "mac", waived: true });
    const second = await approve("mac", t2, 1, "b1");
    const s = fold([...log, pass, waive, second], roster);
    expect(s.rejected.has(second.seq)).toBe(false);
    expect(markOf(s, "mac")).toEqual({ kind: "waived" });
  });

  test("only the owner turns it on or waives a seat", async () => {
    const byLead = await ev("owl", { op: "review.reset.set", on: true });
    const waive = await ev("owl", { op: "review.reset.waive", member: "mac", waived: true });
    const s = fold([byLead, waive], roster);
    expect(s.reviewReset).toBe(false);
    expect(s.rejected.get(byLead.seq)).toBe("only the owner, or a person they fully trust, turns the fresh-session rule for reviewers on or off");
    expect(s.rejected.get(waive.seq)).toBe("only the owner, or a person they fully trust, waives the fresh-session rule for a reviewer");
  });
});

describe("seats that are never marked", () => {
  test("a seat with no fingerprint on its card (a pid-tracked harness) is never marked", async () => {
    const { t1, t2, log } = await twoInReview("kim");
    const withoutPrint = log.filter((m) => !(m.ev?.op === "card"));
    const pass = await approve("kim", t1, 1, "a1");
    const second = await approve("kim", t2, 1, "b1");
    const s = fold([...withoutPrint, pass, second], roster);
    expect(markOf(s, "kim")).toBeUndefined();
    expect(s.rejected.size).toBe(0);
  });
});

describe("the same marks after a restart", () => {
  test("folding from a kept base gives the same marks and setting as one fold from the start", async () => {
    const { t1, t2, log } = await twoInReview();
    const pass = await approve("mac", t1, 1, "a1");
    const second = await approve("mac", t2, 1, "b1");
    const all = [...log, pass, second];
    const whole = fold(all, roster);
    for (const cut of [2, all.length - 2, all.length - 1]) {
      const made: FoldBase[] = [];
      fold(all.slice(0, cut), roster, Date.now(), null, null, null, (b) => void made.push(b));
      const resumed = fold(all.slice(cut), roster, Date.now(), null, null, made.at(-1)!);
      expect(markOf(resumed, "mac")).toEqual(markOf(whole, "mac"));
      expect(resumed.reviewReset).toBe(true);
      expect(resumed.rejected.has(second.seq)).toBe(whole.rejected.has(second.seq));
    }
  });
});
