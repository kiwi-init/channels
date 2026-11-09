import type { CheckAsk } from "@kiwi/core/checks.ts";
import { beforeAll, describe, expect, test } from "bun:test";
import { formatStatus } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { landingWaits } from "@kiwi/core/prs.ts";
import { wellFormed, type Event, type GithubNote, type Message, type Payload } from "@kiwi/core/protocol.ts";
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
const KDE_CHECK: CheckAsk = { phase: "pre-ship", decider: "jon", artifact: { kind: "pr", repo: "o/r", pr: 9, sha: HEAD } };

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
    expect(landingWaits(s, t)).toBe("is ready for a person to merge PR #9");
    const prompt = firstPrompt({ kind: "coding", task: add.seq }, s, "win", "contrib");
    expect(prompt).toContain("People merge pull requests here, so don't merge it yourself");
    expect(prompt).not.toContain("merge its PR at the approved head");
    expect(briefText({ alias: "contrib", agent: "win", mc: "kiwi", listen: "", merges: "people" })).toContain(PEOPLE_MERGE);
    expect(briefText({ alias: "contrib", agent: "win", mc: "kiwi", listen: "", merges: "agents" })).not.toContain(PEOPLE_MERGE);
    expect(formatStatus({ check: "kiwi/review/test", alias: "contrib", me: "win", state: s, online: new Map(), unread: 0 })).toContain("who merges: people");
  });

  async function landingPrompt(then: "release:tag" | "release:npm:@kiwi/cli@1.2.3" | "run", withPr: boolean): Promise<string> {
    const people = await ev("jon", { op: "merges.set", by: "people" });
    const prefix = await ev("jon", { op: "branch.prefix.set", prefix: "T" });
    const add = await ev("jon", { op: "task.add", title: "Ship", owner: "win", review: "mac", then });
    const round = await ev("win", { op: "task.update", task: add.seq, state: "review", at: HEAD });
    const pass = await ev("mac", { op: "task.update", task: add.seq, state: "done", verdict: "approved", round: 1, at: HEAD });
    const pr: GithubNote = { event: "pull_request", repo: "o/r", number: 9, state: "open", branch: `T${add.seq}-ship`, sha: HEAD, at: seq };
    const news = await ev("jon", { op: "github", items: [pr] });
    const s = fold([people, prefix, add, round, pass, ...(withPr ? [news] : [])], roster);
    expect(s.tasks.get(add.seq)!.state).toBe("landing");
    return firstPrompt({ kind: "coding", task: add.seq }, s, "win", "contrib");
  }

  const leavesMerge = (prompt: string, then: string) => {
    expect(prompt).toContain("People merge pull requests here, so don't merge its PR yourself");
    expect(prompt).toContain(`Once a person has merged it, the rest of its ${then} step is yours`);
    expect(prompt).not.toContain("merge its PR at the approved head");
  };

  test("with people merging, a release:tag landing always waits for a person's merge, since its release needs the PR merged", async () => {
    leavesMerge(await landingPrompt("release:tag", false), "release:tag");
    leavesMerge(await landingPrompt("release:tag", true), "release:tag");
  });

  test("with people merging, a PR whose ship gate isn't open yet says what it waits for before a person merges it (T1142)", async () => {
    const people = await ev("jon", { op: "merges.set", by: "people" });
    const prefix = await ev("jon", { op: "branch.prefix.set", prefix: "T" });
    const add = await ev("jon", { op: "task.add", title: "Ship", owner: "win", review: "mac", then: "merge" });
    const pr: GithubNote = { event: "pull_request", repo: "o/r", number: 9, state: "open", branch: `T${add.seq}-ship`, sha: HEAD, at: seq };
    const news = await ev("jon", { op: "github", items: [pr] });
    seq++;
    const payload: Payload = {
      v: 1,
      id: crypto.randomUUID(),
      from: "win",
      kind: "blocking",
      body: "Check it on KDE",
      ts: seq,
      to: ["jon"],
      esc: true,
      choices: ["A: works", "B: not yet"],
      holds: [add.seq],
      check: KDE_CHECK,
    };
    const ask = await sign(ids.win!, payload);
    const check: Message = { ...ask, seq, rts: seq, sigOk: await verify(ask) };
    const round = await ev("win", { op: "task.update", task: add.seq, state: "review", at: HEAD });
    const pass = await ev("mac", { op: "task.update", task: add.seq, state: "done", verdict: "approved", round: 1, at: HEAD });
    const s = fold([people, prefix, add, news, check, round, pass], roster);
    expect(landingWaits(s, s.tasks.get(add.seq)!)).toBe(`waits for its ship gate (missing check #${check.seq} passed) before a person merges PR #9`);
    const agents = fold([prefix, add, news, check, round, pass], roster);
    expect(landingWaits(agents, agents.tasks.get(add.seq)!)).toBe("waits for PR #9 to merge");
  });

  for (const then of ["release:npm:@kiwi/cli@1.2.3", "run"] as const) {
    test(`with people merging, a ${then} landing with a linked PR leaves that merge to a person, then the step stays with the agent`, async () => {
      leavesMerge(await landingPrompt(then, true), then);
    });

    test(`with people merging, a ${then} landing with no PR is the agent's to do now, with no merge to wait for`, async () => {
      const prompt = await landingPrompt(then, false);
      expect(prompt).toContain(`Its ${then} step is yours: do it at the approved artifact.`);
      expect(prompt).toContain("if it comes to need one merged, don't merge it yourself");
      expect(prompt).not.toContain("Once a person has merged it");
      expect(prompt).not.toContain("merge its PR at the approved head");
    });
  }
});
