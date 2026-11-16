import { execFileSync } from "node:child_process";
import { prOfTask, taskOfBranch } from "@kiwi/core/prs.ts";
import type { ChannelState, Task } from "@kiwi/core/state.ts";
import { SNAPSHOT_DIRTY_SHOWN, sameFacts, type SnapshotFacts } from "@kiwi/core/task-snapshot.ts";

const DEFAULT_PREFIX = "T";

export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1_000 }).trimEnd();
  } catch {
    // Not a checkout, no git, a worktree gone from disk, or no such ref: that fact is left out.
    return null;
  }
}

export function worktreesOf(dir: string): Worktree[] {
  const out = git(["worktree", "list", "--porcelain"], dir);
  if (!out) return [];
  return out.split(/\n\n+/).flatMap((block) => {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    const head = lines.find((l) => l.startsWith("HEAD "))?.slice("HEAD ".length);
    const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length);
    if (!path || !head || lines.includes("bare") || lines.some((l) => l.startsWith("prunable"))) return [];
    return [{ path, head, branch: ref?.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null }];
  });
}

export function worktreeOfTask(t: Task, state: Pick<ChannelState, "github" | "branchPrefix">, trees: readonly Worktree[]): Worktree | null {
  const pr = prOfTask(state.github, state.branchPrefix, t);
  const prefix = state.branchPrefix ?? DEFAULT_PREFIX;
  return trees.find((w) => w.branch !== null && (taskOfBranch(w.branch, prefix) === t.id || w.branch === pr?.branch)) ?? null;
}

function baseOf(path: string): SnapshotFacts["base"] {
  const name = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], path) ?? (git(["rev-parse", "--verify", "--quiet", "origin/main"], path) ? "origin/main" : null);
  if (!name) return undefined;
  const counts = git(["rev-list", "--left-right", "--count", `${name}...HEAD`], path)
    ?.split(/\s+/)
    .map(Number);
  if (!counts || counts.length !== 2 || counts.some((c) => !Number.isSafeInteger(c))) return undefined;
  return { name, behind: counts[0]!, ahead: counts[1]! };
}

export function factsOf(tree: Worktree): SnapshotFacts | null {
  const subject = git(["log", "-1", "--format=%s", tree.head], tree.path);
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"], tree.path);
  if (subject === null || status === null) return null;
  const dirty = status
    .split("\n")
    .filter((l) => l.length > 3)
    .map((l) => l.slice(3))
    .sort();
  const base = baseOf(tree.path);
  return {
    path: tree.path,
    branch: tree.branch,
    head: tree.head,
    subject: subject.slice(0, 200),
    dirty: dirty.slice(0, SNAPSHOT_DIRTY_SHOWN).map((f) => f.slice(0, 300)),
    ...(dirty.length > SNAPSHOT_DIRTY_SHOWN ? { more: dirty.length - SNAPSHOT_DIRTY_SHOWN } : {}),
    ...(base ? { base } : {}),
  };
}

export function snapshotsDue(state: ChannelState, me: string, dir: string): { task: number; facts: SnapshotFacts }[] {
  const mine = [...state.tasks.values()].filter((t) => t.owner === me && t.state !== "done" && !t.archived);
  if (!mine.length) return [];
  const trees = worktreesOf(dir);
  return mine.flatMap((t) => {
    const tree = worktreeOfTask(t, state, trees);
    const facts = tree && factsOf(tree);
    return facts && !(t.snapshot && sameFacts(t.snapshot, facts)) ? [{ task: t.id, facts }] : [];
  });
}
