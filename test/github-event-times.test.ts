import { describe, expect, test } from "bun:test";
import { cleanGithubNote, type GithubNote } from "@kiwi/core/protocol.ts";
import { prKey } from "@kiwi/core/state.ts";
import { applyGithub, prChecks, type GithubState } from "@kiwi/core/state/github.ts";
import { heldBefore, inOrderOfHappening, trustedAt } from "@kiwi/core/state/times.ts";
import { githubItem, syncNotes } from "../src/relay/github.ts";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const MERGE = "m".repeat(40);
const T = (iso: string): number => Date.parse(iso);

const fresh = (): GithubState => ({ prs: new Map(), checks: new Map(), issues: new Map(), rules: new Map(), releases: new Map() });
const pr = (over: Partial<GithubNote>): GithubNote => ({ event: "pull_request", repo: "o/r", number: 7, state: "open", at: 999, ...over });

describe("a GitHub event keeps when it happened on GitHub, not only when it reached the relay (#623 §5)", () => {
  test("a merged PR carries GitHub's merged_at; an open one its updated_at", () => {
    const merged = githubItem(
      "pull_request",
      {
        action: "closed",
        repository: { full_name: "o/r" },
        pull_request: {
          number: 7,
          state: "closed",
          merged: true,
          merged_at: "2026-11-06T10:00:00Z",
          closed_at: "2026-11-06T10:00:00Z",
          updated_at: "2026-11-06T10:00:01Z",
          head: { sha: HEAD_A },
          merge_commit_sha: MERGE,
        },
      },
      T("2026-11-06T10:05:00Z"),
    );
    expect(merged).toMatchObject({ at: T("2026-11-06T10:05:00Z"), happened: T("2026-11-06T10:00:00Z"), merged: true });
    const open = githubItem(
      "pull_request",
      { action: "synchronize", repository: { full_name: "o/r" }, pull_request: { number: 7, state: "open", updated_at: "2026-11-06T09:00:00Z", head: { sha: HEAD_B } } },
      5,
    );
    expect(open).toMatchObject({ at: 5, happened: T("2026-11-06T09:00:00Z") });
  });

  test("a finished check or workflow run carries its completion time; a push its pushed_at", () => {
    const check = githubItem(
      "check_run",
      {
        action: "completed",
        repository: { full_name: "o/r" },
        check_run: { id: 1, name: "ci-ok", status: "completed", conclusion: "success", head_sha: HEAD_A, started_at: "2026-11-06T09:50:00Z", completed_at: "2026-11-06T09:55:00Z" },
      },
      5,
    );
    expect(check).toMatchObject({ happened: T("2026-11-06T09:55:00Z") });
    const running = githubItem(
      "check_run",
      { action: "created", repository: { full_name: "o/r" }, check_run: { id: 1, name: "ci-ok", status: "in_progress", head_sha: HEAD_A, started_at: "2026-11-06T09:50:00Z" } },
      5,
    );
    expect(running).toMatchObject({ happened: T("2026-11-06T09:50:00Z") });
    const wf = githubItem(
      "workflow_run",
      {
        action: "completed",
        repository: { full_name: "o/r" },
        workflow_run: { id: 9, name: "CI", status: "completed", conclusion: "success", head_sha: HEAD_A, run_started_at: "2026-11-06T09:40:00Z", updated_at: "2026-11-06T09:58:00Z" },
      },
      5,
    );
    expect(wf).toMatchObject({ happened: T("2026-11-06T09:58:00Z") });
    const push = githubItem("push", { ref: "refs/heads/T7", after: HEAD_B, repository: { full_name: "o/r", pushed_at: 1_794_000_000 } }, 5);
    expect(push).toMatchObject({ happened: 1_794_000_000_000 });
  });

  test("an event without a time GitHub vouches for has none, so it counts as late", () => {
    const item = githubItem("pull_request", { action: "edited", repository: { full_name: "o/r" }, pull_request: { number: 7, state: "open", updated_at: "not a date" } }, 5);
    expect(item?.happened).toBeUndefined();
  });

  test("a sync keeps the merge time and each check's completion time", () => {
    const [merged] = syncNotes(
      "o/r",
      [
        {
          number: 7,
          state: "MERGED",
          headRefOid: HEAD_A,
          headRefName: "T7",
          mergeCommit: { oid: MERGE },
          updatedAt: "2026-11-06T10:00:02Z",
          closedAt: "2026-11-06T10:00:00Z",
          mergedAt: "2026-11-06T10:00:00Z",
        },
      ],
      [],
      0,
      T("2026-11-06T11:00:00Z"),
    );
    expect(merged).toMatchObject({ merged: true, happened: T("2026-11-06T10:00:00Z") });
    const open = syncNotes(
      "o/r",
      [
        {
          number: 8,
          state: "OPEN",
          headRefOid: HEAD_B,
          updatedAt: "2026-11-06T10:30:00Z",
          commits: {
            nodes: [
              {
                commit: {
                  checkSuites: {
                    nodes: [
                      { checkRuns: { nodes: [{ databaseId: 3, name: "ci-ok", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-11-06T10:20:00Z", completedAt: "2026-11-06T10:25:00Z" }] } },
                    ],
                  },
                },
              },
            ],
          },
        },
      ],
      [],
      0,
      T("2026-11-06T11:00:00Z"),
    );
    expect(open[0]).toMatchObject({ happened: T("2026-11-06T10:30:00Z") });
    expect(open[1]).toMatchObject({ event: "check_run", happened: T("2026-11-06T10:25:00Z") });
  });

  test("a finished check with a missing or malformed completion time has none: its start time never stands in for it", () => {
    const synced = (run: Record<string, unknown>): GithubNote[] =>
      syncNotes(
        "o/r",
        [
          {
            number: 8,
            state: "OPEN",
            headRefOid: HEAD_B,
            updatedAt: "2026-11-06T09:00:00Z",
            commits: { nodes: [{ commit: { checkSuites: { nodes: [{ checkRuns: { nodes: [{ databaseId: 3, name: "ci-ok", ...run }] } }] } } }] },
          },
        ],
        [],
        0,
        T("2026-11-06T11:00:00Z"),
      );
    const finished = { status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-11-06T10:00:00Z" };
    const shipped = T("2026-11-06T10:05:00Z");
    for (const run of [finished, { ...finished, completedAt: "not a date" }]) {
      const notes = synced(run);
      expect(notes[1]?.happened).toBeUndefined();
      const g = fresh();
      applyGithub(g, notes, 2);
      const pull = g.prs.get(prKey("o/r", 8));
      if (!pull) throw new Error("no PR");
      const [check] = prChecks(g, pull);
      expect(check).toMatchObject({ conclusion: "success" });
      expect(check?.completedAt).toBeUndefined();
      expect(heldBefore(check?.completedAt, shipped)).toBe(false);
    }
    expect(synced({ status: "IN_PROGRESS", startedAt: "2026-11-06T10:00:00Z" })[1]?.happened).toBe(T("2026-11-06T10:00:00Z"));
  });

  test("the owner's app can post the time, and a bad one drops the note", () => {
    expect(cleanGithubNote({ event: "pull_request", repo: "o/r", at: 1, happened: 2 })).toMatchObject({ happened: 2 });
    expect(cleanGithubNote({ event: "pull_request", repo: "o/r", at: 1, happened: -1 })).toBeNull();
    expect(cleanGithubNote({ event: "pull_request", repo: "o/r", at: 1, happened: 1.5 })).toBeNull();
    expect(cleanGithubNote({ event: "pull_request", repo: "o/r", at: 1, happened: "2026-11-06" })).toBeNull();
  });
});

describe("the fold applies GitHub's events in the order they happened, whenever they arrive", () => {
  test("a late synchronize can't reopen a merged PR or move its head; the merge keeps its time", () => {
    const g = fresh();
    applyGithub(g, [pr({ state: "closed", merged: true, sha: HEAD_A, merge: MERGE, happened: 300 })], 2);
    applyGithub(g, [pr({ action: "synchronize", sha: HEAD_B, happened: 200 })], 3);
    expect(g.prs.get(prKey("o/r", 7))).toMatchObject({ state: "merged", sha: HEAD_A, merge: MERGE, mergedAt: 300 });
  });

  test("a merged PR stays merged, even after a note GitHub didn't date", () => {
    const g = fresh();
    applyGithub(g, [pr({ state: "closed", merged: true, sha: HEAD_A, merge: MERGE, happened: 300 })], 2);
    applyGithub(g, [pr({ action: "synced", sha: HEAD_B })], 3);
    expect(g.prs.get(prKey("o/r", 7))).toMatchObject({ state: "merged", sha: HEAD_A, mergedAt: 300 });
  });

  test("an older head arriving after a newer one is ignored, and so is an older push", () => {
    const g = fresh();
    applyGithub(g, [pr({ action: "synchronize", sha: HEAD_B, branch: "T7", happened: 200 })], 2);
    applyGithub(g, [pr({ action: "opened", sha: HEAD_A, branch: "T7", happened: 100 })], 3);
    expect(g.prs.get(prKey("o/r", 7))?.sha).toBe(HEAD_B);
    applyGithub(g, [{ event: "push", repo: "o/r", branch: "T7", sha: HEAD_A, happened: 150, at: 999 }], 4);
    expect(g.prs.get(prKey("o/r", 7))?.sha).toBe(HEAD_B);
    applyGithub(g, [{ event: "push", repo: "o/r", branch: "T7", sha: "c".repeat(40), happened: 250, at: 999 }], 5);
    expect(g.prs.get(prKey("o/r", 7))).toMatchObject({ sha: "c".repeat(40), happened: 250 });
  });

  test("a merge with no time GitHub vouches for is kept without one", () => {
    const g = fresh();
    applyGithub(g, [pr({ state: "closed", merged: true, sha: HEAD_A, merge: MERGE })], 2);
    expect(g.prs.get(prKey("o/r", 7))?.state).toBe("merged");
    expect(g.prs.get(prKey("o/r", 7))?.mergedAt).toBeUndefined();
  });

  test("an issue's late reopen note from before it closed doesn't reopen it", () => {
    const g = fresh();
    applyGithub(g, [{ event: "issues", repo: "o/r", number: 9, state: "closed", reason: "completed", happened: 500, at: 999 }], 2);
    applyGithub(g, [{ event: "issues", repo: "o/r", number: 9, state: "open", happened: 400, at: 1000 }], 3);
    expect(g.issues.get(prKey("o/r", 9))).toMatchObject({ state: "closed", happened: 500 });
  });

  test("a check keeps when it completed, and a late in-progress note for the same run doesn't undo it", () => {
    const g = fresh();
    applyGithub(g, [{ event: "check_run", repo: "o/r", number: 7, sha: HEAD_A, name: "ci-ok", run: 5, status: "completed", conclusion: "success", happened: 400, at: 999 }], 2);
    applyGithub(g, [{ event: "check_run", repo: "o/r", sha: HEAD_A, name: "ci-ok", run: 5, status: "in_progress", happened: 350, at: 1000 }], 3);
    applyGithub(g, [pr({ sha: HEAD_A, happened: 100 })], 4);
    const pull = g.prs.get(prKey("o/r", 7));
    if (!pull) throw new Error("no PR");
    expect(prChecks(g, pull)).toEqual([{ name: "ci-ok", status: "completed", conclusion: "success", run: 5, at: 999, completedAt: 400 }]);
  });
});

describe("evidence counts only when it's known to have come first", () => {
  test("a check answer's time is the relay's receipt time, never the sender's", () => {
    expect(trustedAt({ ts: 100, rts: 250 })).toBe(250);
    expect(trustedAt({ ts: 100 })).toBeUndefined();
  });

  test("a missing time is late: it never comes before the ship, and a ship with no time proves nothing", () => {
    expect(heldBefore(100, 200)).toBe(true);
    expect(heldBefore(200, 200)).toBe(true);
    expect(heldBefore(201, 200)).toBe(false);
    expect(heldBefore(undefined, 200)).toBe(false);
    expect(heldBefore(100, undefined)).toBe(false);
  });

  test("evidence sorts by when it happened, the undated last, in arrival order", () => {
    const arrived = [
      { id: "late-dated", at: 300 },
      { id: "undated-1", at: undefined },
      { id: "early", at: 100 },
      { id: "undated-2", at: undefined },
      { id: "middle", at: 200 },
    ];
    expect(inOrderOfHappening(arrived, (e) => e.at).map((e) => e.id)).toEqual(["early", "middle", "late-dated", "undated-1", "undated-2"]);
  });
});
