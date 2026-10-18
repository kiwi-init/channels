import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { taskRepo, verdictsAfter } from "@kiwi/core/work.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac", "rev"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "rev", pk: ids.rev!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("the verdicts the owner's app posts as kiwi/review checks", () => {
  test("each verdict on a round with a commit, in the task's PR repo, once, after the mark", async () => {
    const add = await ev("jon", { op: "task.add", title: "Diffs", owner: "mac", review: "rev" });
    const t = add.seq;
    const log = [
      add,
      await ev("mac", { op: "task.update", task: t, state: "doing", note: "https://github.com/ojow/site/pull/3" }),
      await ev("mac", { op: "task.update", task: t, state: "review", at: "a".repeat(40) }),
      await ev("rev", { op: "task.update", task: t, state: "doing", verdict: "rejected", note: "tests missing", round: 1 }),
      await ev("mac", { op: "task.update", task: t, state: "review", at: "b".repeat(40) }),
      await ev("rev", { op: "task.update", task: t, state: "done", verdict: "approved", note: "good now", round: 2 }),
    ];
    const s = fold(log, roster);
    expect(taskRepo(s, log, t)).toBe("ojow/site");
    const all = verdictsAfter(s, log, 0);
    expect(all).toEqual([
      { repo: "ojow/site", sha: "a".repeat(40), verdict: "rejected", task: t, seq: log[3]!.seq, note: "tests missing" },
      { repo: "ojow/site", sha: "b".repeat(40), verdict: "approved", task: t, seq: log[5]!.seq, note: "good now" },
    ]);
    expect(verdictsAfter(s, log, log[3]!.seq).map((c) => c.verdict)).toEqual(["approved"]);
  });

  test("no repo to post to (no PR, several repos connected) or no commit on the round: nothing", async () => {
    const add = await ev("jon", { op: "task.add", title: "No PR", owner: "mac", review: "rev" });
    const log = [
      await ev("jon", { op: "repos.set", repos: ["ojow/a", "ojow/b"] }),
      add,
      await ev("mac", { op: "task.update", task: add.seq, state: "review", at: "c".repeat(40) }),
      await ev("rev", { op: "task.update", task: add.seq, state: "done", verdict: "approved", round: 1 }),
    ];
    const s = fold(log, roster);
    expect(taskRepo(s, log, add.seq)).toBeNull();
    expect(verdictsAfter(s, log, 0)).toEqual([]);
    const one = [await ev("jon", { op: "repos.set", repos: ["ojow/a"] }), ...log.slice(1)];
    expect(verdictsAfter(fold(one, roster), one, 0)).toMatchObject([{ repo: "ojow/a", verdict: "approved" }]);
  });
});
