import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, GithubNote, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { ciCommitLine, ciPusher, ciRedAfter, ciRedTitle, onMain } from "@kiwi/core/ci-red.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: seq });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jow", "wren", "marten", "gazelle"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "wren", pk: ids.wren!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "marten", pk: ids.marten!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "gazelle", pk: ids.gazelle!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

const check = (over: Partial<GithubNote>): GithubNote => ({
  event: "check_run",
  repo: "ojow/channels",
  action: "completed",
  name: "test / unit",
  sha: "a".repeat(40),
  branch: "main",
  conclusion: "failure",
  url: "https://github.com/ojow/channels/runs/1",
  at: 1,
  ...over,
});

describe("CI red becomes a task", () => {
  test("a failed, timed-out or broken check is red; a green one, a run still going or a whole workflow isn't", async () => {
    const m = await ev("jow", {
      op: "github",
      items: [
        check({}),
        check({ name: "lint", conclusion: "timed_out" }),
        check({ name: "build", conclusion: "success" }),
        check({ name: "slow", conclusion: undefined, status: "in_progress" }),
        check({ name: "skipped", conclusion: "skipped" }),
        { ...check({ name: "ci" }), event: "workflow_run" },
      ],
    });
    const s = fold([m], roster);
    expect(ciRedAfter(s, [m], 0).map((r) => [r.name, r.conclusion])).toEqual([
      ["test / unit", "failure"],
      ["lint", "timed_out"],
    ]);
    expect(ciRedAfter(s, [m], m.seq)).toEqual([]);
  });

  test("the same check on the same commit, said twice, is one red", async () => {
    const a = await ev("jow", { op: "github", items: [check({})] });
    const b = await ev("jow", { op: "github", items: [check({}), check({ sha: "b".repeat(40) })] });
    expect(ciRedAfter(fold([a, b], roster), [a, b], 0).map((r) => r.sha[0])).toEqual(["a", "b"]);
  });

  test("GitHub's news posted by anyone but the owner's app is ignored", async () => {
    const forged = await ev("wren", { op: "github", items: [check({})] });
    expect(ciRedAfter(fold([forged], roster), [forged], 0)).toEqual([]);
  });

  test("whoever pushed: the owner of T<n> for a T<n>-… branch, else the one agent whose card is on that branch", async () => {
    const t = await ev("jow", { op: "task.add", title: "Copy buttons", owner: "wren" });
    const cards = [await ev("marten", { op: "card", branch: "issue-sweep" }), await ev("gazelle", { op: "card", branch: "main" }), await ev("wren", { op: "card", branch: "main" })];
    const s = fold([t, ...cards], roster);
    expect(ciPusher(s, `T${t.seq}-copy-buttons`)).toBe("wren");
    expect(ciPusher(s, "issue-sweep")).toBe("marten");
    expect(ciPusher(s, "main")).toBeUndefined();
    expect(ciPusher(s, "nobody-here")).toBeUndefined();
    expect(ciPusher(s, undefined)).toBeUndefined();
  });

  test("only a red on main opens anything: a PR branch's red is its PR's to fix, already shown on the PR", async () => {
    const t = await ev("jow", { op: "task.add", title: "Copy buttons", owner: "wren" });
    const reds = await ev("jow", {
      op: "github",
      items: [check({ branch: `T${t.seq}-copy-buttons` }), check({ branch: "master", sha: "e".repeat(40) }), check({ branch: "main", sha: "f".repeat(40) })],
    });
    expect(ciRedAfter(fold([t, reds], roster), [t, reds], 0).map((r) => r.branch)).toEqual(["master", "main"]);
    expect(onMain(undefined)).toBe(true);
    expect(onMain("main")).toBe(true);
    expect(onMain("T41-launch")).toBe(false);
    expect(onMain("mainline")).toBe(false);
  });

  test("a red on a commit that already has an open CI task points at that task; a done one doesn't count", async () => {
    const sha = "d".repeat(40);
    const open = await ev("jow", { op: "task.add", title: ciRedTitle("test / unit", "main"), detail: `${ciCommitLine("ojow/channels", sha)} on main\n...` });
    const red = await ev("jow", { op: "github", items: [check({ sha, name: "lint" })] });
    expect(ciRedAfter(fold([open, red], roster), [open, red], 0)[0]!.task).toBe(open.seq);
    const done = await ev("jow", { op: "task.update", task: open.seq, state: "done" });
    expect(ciRedAfter(fold([open, done, red], roster), [open, done, red], 0)[0]!.task).toBeUndefined();
  });

  test("the title and the commit line", () => {
    expect(ciRedTitle("test / unit", "T51-ci")).toBe("CI red: test / unit on T51-ci");
    expect(ciRedTitle("lint")).toBe("CI red: lint");
    expect(ciCommitLine("ojow/channels", "0123456789abcdef0123")).toBe("Commit ojow/channels@0123456789ab");
  });
});

describe("runs on main", () => {
  test("each has a concurrency group of its own, so no push or rehearsal cancels it into a red ci-ok; a pull request's newest push still cancels its older run", () => {
    const ci = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../.github/workflows/ci.yml"), "utf8")) as { concurrency: { group: string; "cancel-in-progress": boolean } };
    expect(ci.concurrency.group).toBe("ci-${{ github.event.pull_request.number || github.run_id }}");
    expect(ci.concurrency["cancel-in-progress"]).toBe(true);
  });
});
