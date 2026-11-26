import type { Frozen } from "@kiwi/core/state.ts";
import * as Effect from "effect/Effect";
import { prOfTask, taskOfBranch } from "@kiwi/core/prs.ts";
import type { ChannelState, Task } from "@kiwi/core/state.ts";
import { SNAPSHOT_DIRTY_SHOWN, sameFacts, type SnapshotFacts } from "@kiwi/core/task-snapshot.ts";

const DEFAULT_PREFIX = "T";
const GIT_MS = 1_000;

export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
}

const run = async (args: readonly string[], cwd: string, signal: AbortSignal): Promise<string | null> => {
  const p = Bun.spawn(["git", ...args], { cwd, env: process.env, stdin: "ignore", stdout: "pipe", stderr: "ignore", signal, timeout: GIT_MS, killSignal: "SIGKILL" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return code === 0 ? out.trimEnd() : null;
};

const git = (args: readonly string[], cwd: string): Effect.Effect<string | null> =>
  Effect.tryPromise({ try: (signal) => run(args, cwd, signal), catch: () => null }).pipe(Effect.orElseSucceed(() => null));

export function parseWorktrees(out: string): Worktree[] {
  return out.split(/\n\n+/).flatMap((block) => {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    const head = lines.find((l) => l.startsWith("HEAD "))?.slice("HEAD ".length);
    const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length);
    if (!path || !head || lines.includes("bare") || lines.some((l) => l.startsWith("prunable"))) return [];
    return [{ path, head, branch: ref?.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null }];
  });
}

export const worktreesOf = (dir: string): Effect.Effect<Worktree[]> => Effect.map(git(["worktree", "list", "--porcelain"], dir), (out) => (out ? parseWorktrees(out) : []));

export function worktreeOfTask(t: Frozen<Task>, state: Pick<ChannelState, "github" | "branchPrefix">, trees: readonly Worktree[]): Worktree | null {
  const pr = prOfTask(state.github, state.branchPrefix, t);
  const prefix = state.branchPrefix ?? DEFAULT_PREFIX;
  return trees.find((w) => w.branch !== null && (taskOfBranch(w.branch, prefix) === t.id || w.branch === pr?.branch)) ?? null;
}

const baseOf = (path: string): Effect.Effect<SnapshotFacts["base"]> =>
  Effect.gen(function* () {
    const named = yield* git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], path);
    const name = named ?? ((yield* git(["rev-parse", "--verify", "--quiet", "origin/main"], path)) ? "origin/main" : null);
    if (!name) return undefined;
    const counts = (yield* git(["rev-list", "--left-right", "--count", `${name}...HEAD`], path))?.split(/\s+/).map(Number);
    if (!counts || counts.length !== 2 || counts.some((c) => !Number.isSafeInteger(c))) return undefined;
    return { name, behind: counts[0]!, ahead: counts[1]! };
  });

export const factsOf = (tree: Worktree): Effect.Effect<SnapshotFacts | null> =>
  Effect.gen(function* () {
    const [subject, status, base] = yield* Effect.all(
      [git(["log", "-1", "--format=%s", tree.head], tree.path), git(["status", "--porcelain=v1", "--untracked-files=all"], tree.path), baseOf(tree.path)],
      {
        concurrency: "unbounded",
      },
    );
    if (subject === null || status === null) return null;
    const dirty = status
      .split("\n")
      .filter((l) => l.length > 3)
      .map((l) => l.slice(3))
      .sort();
    return {
      path: tree.path,
      branch: tree.branch,
      head: tree.head,
      subject: subject.slice(0, 200),
      dirty: dirty.slice(0, SNAPSHOT_DIRTY_SHOWN).map((f) => f.slice(0, 300)),
      ...(dirty.length > SNAPSHOT_DIRTY_SHOWN ? { more: dirty.length - SNAPSHOT_DIRTY_SHOWN } : {}),
      ...(base ? { base } : {}),
    };
  });

export const snapshotsDue = (state: ChannelState, me: string, dir: string): Effect.Effect<{ task: number; facts: SnapshotFacts }[]> =>
  Effect.gen(function* () {
    const mine = [...state.tasks.values()].filter((t) => t.owner === me && t.state !== "done" && !t.archived);
    if (!mine.length) return [];
    const trees = yield* worktreesOf(dir);
    const found = yield* Effect.forEach(
      mine,
      (t) => {
        const tree = worktreeOfTask(t, state, trees);
        return tree ? Effect.map(factsOf(tree), (facts) => (facts && !(t.snapshot && sameFacts(t.snapshot, facts)) ? { task: t.id, facts } : null)) : Effect.succeed(null);
      },
      { concurrency: "unbounded" },
    );
    return found.filter((d): d is { task: number; facts: SnapshotFacts } => d !== null);
  });
