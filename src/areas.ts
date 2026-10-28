import { execFileSync } from "node:child_process";
import { areasOf } from "@kiwi/core/routing.ts";
import { taskOfBranch } from "@kiwi/core/work.ts";

const DEFAULT_BRANCHES = new Set(["main", "master", "trunk", "HEAD"]);
const REMOTE = "refs/remotes/origin/";

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim();
  } catch {
    // Not a checkout, no git, or no such ref: there are no areas to say.
    return null;
  }
}

const lines = (out: string | null) => out?.split("\n").filter(Boolean) ?? [];

function taskBranch(task: number, prefix: string | null, cwd: string): string | null {
  if (!prefix) return null;
  for (const ref of lines(git(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin"], cwd))) {
    const name = ref.replace(/^origin\//, "");
    if (!DEFAULT_BRANCHES.has(name) && taskOfBranch(name, prefix) === task) return ref;
  }
  return null;
}

function bases(prefix: string | null, cwd: string): string[] {
  return lines(git(["for-each-ref", "--format=%(refname)", REMOTE], cwd)).filter((ref) => taskOfBranch(ref.slice(REMOTE.length), prefix) === null);
}

export function branchAreas(task: number, prefix: string | null, cwd = process.cwd()): string[] | null {
  const head = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const here = !!head && !DEFAULT_BRANCHES.has(head) && taskOfBranch(head, prefix) === task;
  const branch = here ? "HEAD" : taskBranch(task, prefix, cwd);
  if (!branch) return null;
  const from = bases(prefix, cwd);
  if (!from.length) return null;
  const committed = git(["log", "--no-merges", "--name-only", "--format=", branch, "--not", ...from], cwd);
  if (committed === null) return null;
  const files = [...lines(committed), ...(here ? lines(git(["diff", "--name-only", "HEAD"], cwd)) : [])];
  const areas = areasOf([...new Set(files)]);
  return areas.length ? areas : null;
}
