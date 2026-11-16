import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { isQuiet, wellFormedEvent, type Event, type Message } from "@kiwi/core/protocol.ts";
import { reentryText } from "@kiwi/core/reentry.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import type { SnapshotFacts } from "@kiwi/core/task-snapshot.ts";
import { factsOf, snapshotsDue, worktreesOf } from "../src/hooks/snapshot.ts";

const ids: Record<string, Identity> = {};
let roster: Roster;
let seq = 0;
async function ev(from: string, e: Event, at?: number): Promise<Message> {
  seq = at ?? seq + 1;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

const root = realpathSync(mkdtempSync(join(tmpdir(), "kiwi-snapshot-")));
const origin = join(root, "origin");
const hook = join(root, "repo");
const work = join(root, "repo-T7");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (cwd: string, file: string, message: string) => {
  writeFileSync(join(cwd, file), message);
  git(cwd, "add", file);
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message);
};

beforeAll(async () => {
  for (const n of ["jon", "bot", "fox"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "bot", pk: ids.bot!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "fox", pk: ids.fox!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
  execFileSync("git", ["init", "-q", "-b", "main", origin]);
  commit(origin, "README.md", "first");
  execFileSync("git", ["clone", "-q", origin, hook]);
  git(hook, "worktree", "add", "-q", "-b", "T7-snapshots", work);
  commit(work, "hook.ts", "Stop hook saves a snapshot");
  writeFileSync(join(work, "wip.ts"), "half done");
  writeFileSync(join(hook, "someone-else.txt"), "not T7's");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const board = async (extra: Message[] = []) => {
  const seven = await ev("jon", { op: "task.add", title: "Snapshots", owner: "bot" }, 7);
  const eight = await ev("jon", { op: "task.add", title: "No branch of its own", owner: "bot" }, 8);
  return fold([seven, eight, ...extra], roster);
};

describe("a snapshot on Stop", () => {
  test("describes the task's own worktree, names its path, and reads its files as that checkout's state", async () => {
    const due = snapshotsDue(await board(), "bot", hook);
    expect(due).toHaveLength(1);
    expect(due[0]!.task).toBe(7);
    expect(due[0]!.facts).toEqual({
      path: work,
      branch: "T7-snapshots",
      head: git(work, "rev-parse", "HEAD"),
      subject: "Stop hook saves a snapshot",
      dirty: ["wip.ts"],
      base: { name: "origin/main", ahead: 1, behind: 0 },
    });
    expect(due[0]!.facts.dirty).not.toContain("someone-else.txt");
  });

  test("a task with no worktree of its own gets none: the hook folder's state is never pinned on it", async () => {
    const due = snapshotsDue(await board(), "bot", hook);
    expect(due.map((d) => d.task)).not.toContain(8);
    expect(worktreesOf(hook).map((w) => w.path)).toEqual([hook, work]);
  });

  test("isn't saved again while nothing changed, and is once something did", async () => {
    const facts = factsOf(worktreesOf(hook).find((w) => w.path === work)!)!;
    const saved = await ev("bot", { op: "task.snapshot", task: 7, ...facts });
    expect(snapshotsDue(await board([saved]), "bot", hook)).toEqual([]);
    writeFileSync(join(work, "more.ts"), "next step");
    const again = snapshotsDue(await board([saved]), "bot", hook);
    rmSync(join(work, "more.ts"));
    expect(again.map((d) => d.facts.dirty)).toEqual([["more.ts", "wip.ts"]]);
  });
});

describe("a snapshot on the board", () => {
  const facts: SnapshotFacts = { path: "/home/www/repo-T7", branch: "T7-snapshots", head: "a".repeat(40), subject: "Stop hook", dirty: ["wip.ts"], base: { name: "origin/main", ahead: 2, behind: 1 } };

  test("is a quiet event of its own, kept apart from the notes, and only the task's owner saves one", async () => {
    expect(wellFormedEvent({ op: "task.snapshot", task: 7, ...facts })).toBe(true);
    expect(wellFormedEvent({ op: "task.snapshot", task: 7, ...facts, path: "relative/path" })).toBe(false);
    expect(wellFormedEvent({ op: "task.snapshot", task: 7, ...facts, head: "abc" })).toBe(false);
    const mine = await ev("bot", { op: "task.snapshot", task: 7, ...facts });
    const theirs = await ev("fox", { op: "task.snapshot", task: 7, ...facts, branch: "main" });
    expect(isQuiet(mine)).toBe(true);
    expect(describeEvent(mine)).toBe(`noted where T7 stands on disk: T7-snapshots at aaaaaaaaa in /home/www/repo-T7`);
    const state = await board([mine, theirs]);
    const t = state.tasks.get(7)!;
    expect(t.snapshot).toMatchObject({ ...facts, seq: mine.seq, by: "bot" });
    expect(t.notes).toEqual([]);
    expect(state.rejected.get(theirs.seq)).toBe("only T7's owner saves its snapshot");
  });

  test("re-entry shows the authored checkpoint, with the snapshot beside it", async () => {
    const note = await ev("bot", { op: "task.update", task: 7, note: "next: the Stop hook test; trap: the shared checkout", checkpoint: true });
    const snap = await ev("bot", { op: "task.snapshot", task: 7, ...facts });
    const text = reentryText(await board([note, snap]), "bot", 100)!;
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.startsWith("T7 "));
    expect(lines[at + 1]).toMatch(new RegExp(`^  checkpoint by bot, .+ \\(#${note.seq}\\):$`));
    expect(lines[at + 2]).toBe("  │ next: the Stop hook test; trap: the shared checkout");
    expect(lines[at + 3]).toMatch(new RegExp(`^  on disk at the end of a turn, .+ \\(#${snap.seq}\\), /home/www/repo-T7:$`));
    expect(lines.slice(at + 4, at + 6)).toEqual([
      "  │ branch T7-snapshots at aaaaaaaaa “Stop hook”, 2 ahead and 1 behind origin/main",
      "  │ uncommitted in that checkout, which may hold others' edits too: wip.ts",
    ]);
  });
});
