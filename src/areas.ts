import { execFileSync } from "node:child_process";
import { areasOf } from "@kiwi/core/routing.ts";
import { taskOfBranch } from "@kiwi/core/work.ts";

const DEFAULT_BRANCHES = new Set(["main", "master", "trunk", "HEAD"]);

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
  } catch {
    // Not a checkout, no git, or no such ref: there are no areas to say.
    return null;
  }
}

// A local or pushed branch named after the task, the most recently committed first.
function taskBranch(task: number, prefix: string | null, cwd: string): string | null {
  if (!prefix) return null;
  const refs = git(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin"], cwd);
  for (const ref of refs?.split("\n") ?? []) {
    const name = ref.replace(/^origin\//, "");
    if (!DEFAULT_BRANCHES.has(name) && taskOfBranch(name, prefix) === task) return ref;
  }
  return null;
}

// The folders the task's own branch changed since main. A checkout on any other branch says nothing
// about the task: ~/www/channels sits on Jow's site-redo with his uncommitted work (T713).
export function branchAreas(task: number, prefix: string | null, cwd = process.cwd()): string[] | null {
  const head = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const here = !!head && !DEFAULT_BRANCHES.has(head) && taskOfBranch(head, prefix) === task;
  const branch = here ? "HEAD" : taskBranch(task, prefix, cwd);
  if (!branch) return null;
  const main = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd) || "origin/main";
  const base = git(["merge-base", branch, main], cwd);
  if (!base) return null;
  // On the task's branch its uncommitted work counts too; from elsewhere, only what the branch committed.
  const files = git(here ? ["diff", "--name-only", base] : ["diff", "--name-only", base, branch], cwd);
  if (files === null) return null;
  const areas = areasOf(files.split("\n").filter(Boolean));
  return areas.length ? areas : null;
}
