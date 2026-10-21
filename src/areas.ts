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

const CAPSULE_FILES = 20;

function changedFiles(cwd: string): string[] | null {
  const head = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd) || "origin/main";
  const base = git(["merge-base", "HEAD", head], cwd);
  if (!base) return null;
  const files = git(["diff", "--name-only", base], cwd);
  return files === null ? null : files.split("\n").filter(Boolean);
}

export function branchAreas(task: number, owner: boolean, cwd = process.cwd()): string[] | null {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (!branch || DEFAULT_BRANCHES.has(branch)) return null;
  if (taskOfBranch(branch) !== task && !owner) return null;
  const files = changedFiles(cwd);
  if (files === null) return null;
  const areas = areasOf(files);
  return areas.length ? areas : null;
}

export function branchFacts(cwd = process.cwd()): { branch?: string; head?: string; files: string[] } {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const head = git(["rev-parse", "--short", "HEAD"], cwd);
  const files = branch && !DEFAULT_BRANCHES.has(branch) ? (changedFiles(cwd) ?? []) : [];
  return { ...(branch && branch !== "HEAD" ? { branch } : {}), ...(head ? { head } : {}), files: files.slice(0, CAPSULE_FILES) };
}
