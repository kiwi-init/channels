import { beforeAll, describe, expect, test } from "bun:test";
import { formatStatus } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { landingWaits } from "@kiwi/core/prs.ts";
import { wellFormed, type Event, type GithubNote, type Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { briefText, PEOPLE_MERGE } from "../src/brief.ts";
import { firstPrompt } from "../src/loop/work.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "win", "mac"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

const HEAD = "4444444444444444444444444444444444444444";

describe("who merges a channel's pull requests (#623 §6)", () => {
  test("agents by default; the owner can make it people, and an agent can't change it", async () => {
    expect(fold([], roster).merges).toBe("agents");
    const people = await ev("jon", { op: "merges.set", by: "people" });
    expect(fold([people], roster).merges).toBe("people");
    const back = await ev("win", { op: "merges.set", by: "agents" });
    const s = fold([people, back], roster);
    expect(s.merges).toBe("people");
    expect(s.rejected.get(back.seq)).toContain("sets who merges");
    const base = { v: 1, id: "x", from: "jon", kind: "event", body: "", ts: 1 };
    expect(wellFormed({ ...base, ev: { op: "merges.set", by: "people" } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "merges.set", by: "bots" } })).toBe(false);
  });

  test("with people merging, agents are told not to merge: the brief, the landing session, the waits line and status say so", async () => {
    const people = await ev("jon", { op: "merges.set", by: "people" });
    const prefix = await ev("jon", { op: "branch.prefix.set", prefix: "T" });
    const add = await ev("jon", { op: "task.add", title: "Ship", owner: "win", review: "mac", then: "merge" });
    const round = await ev("win", { op: "task.update", task: add.seq, state: "review", at: HEAD });
    const pass = await ev("mac", { op: "task.update", task: add.seq, state: "done", verdict: "approved", round: 1, at: HEAD });
    const pr: GithubNote = { event: "pull_request", repo: "o/r", number: 9, state: "open", branch: `T${add.seq}-ship`, sha: HEAD, at: seq };
    const news = await ev("jon", { op: "github", items: [pr] });
    const s = fold([people, prefix, add, round, pass, news], roster);
    const t = s.tasks.get(add.seq)!;
    expect(landingWaits(s, t)).toBe("waits for a person to merge PR #9");
    const prompt = firstPrompt({ kind: "coding", task: add.seq }, s, "win", "contrib");
    expect(prompt).toContain("People merge pull requests here, so don't merge it yourself");
    expect(prompt).not.toContain("merge its PR at the approved head");
    expect(briefText({ alias: "contrib", agent: "win", mc: "kiwi", listen: "", merges: "people" })).toContain(PEOPLE_MERGE);
    expect(briefText({ alias: "contrib", agent: "win", mc: "kiwi", listen: "", merges: "agents" })).not.toContain(PEOPLE_MERGE);
    expect(formatStatus({ alias: "contrib", me: "win", state: s, online: new Map(), unread: 0 })).toContain("who merges: people");
  });

  for (const then of ["release:tag", "release:npm:@kiwi/cli@1.2.3", "run"] as const) {
    test(`with people merging, a ${then} landing leaves the PR merge to a person and keeps the rest of the step with the agent`, async () => {
      const people = await ev("jon", { op: "merges.set", by: "people" });
      const add = await ev("jon", { op: "task.add", title: "Ship", owner: "win", review: "mac", then });
      const round = await ev("win", { op: "task.update", task: add.seq, state: "review", at: HEAD });
      const pass = await ev("mac", { op: "task.update", task: add.seq, state: "done", verdict: "approved", round: 1, at: HEAD });
      const s = fold([people, add, round, pass], roster);
      expect(s.tasks.get(add.seq)!.state).toBe("landing");
      const prompt = firstPrompt({ kind: "coding", task: add.seq }, s, "win", "contrib");
      expect(prompt).toContain("People merge pull requests here, so don't merge its PR yourself");
      expect(prompt).toContain(`the rest of its ${then} step is yours`);
      expect(prompt).not.toContain("merge its PR at the approved head");
    });
  }
});
