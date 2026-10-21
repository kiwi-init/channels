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

export function branchAreas(task: number, owner: boolean, prefix: string | null, cwd = process.cwd()): string[] | null {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (!branch || DEFAULT_BRANCHES.has(branch)) return null;
  if (taskOfBranch(branch, prefix) !== task && !owner) return null;
  const head = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd) || "origin/main";
  const base = git(["merge-base", "HEAD", head], cwd);
  if (!base) return null;
  const files = git(["diff", "--name-only", base], cwd);
  if (files === null) return null;
  const areas = areasOf(files.split("\n").filter(Boolean));
  return areas.length ? areas : null;
}
