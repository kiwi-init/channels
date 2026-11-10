import { spawnSync } from "node:child_process";
import type { KeptHow } from "@kiwi/core/protocol.ts";

export type Git = (args: readonly string[]) => { ok: boolean; out: string };

export const gitIn =
  (cwd: string): Git =>
  (args) => {
    const r = spawnSync("git", [...args], { cwd, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] });
    return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
  };

export type HeadCompare = { kind: "same"; head: string } | { kind: "kept"; how: KeptHow; head: string; approved: string; tip: string } | { kind: "changed"; why: string };

const MAX_LINKS = 50;
const FULL_SHA = /^[0-9a-f]{40}$/;

const short = (sha: string): string => sha.slice(0, 7);

function resolve(git: Git, ref: string, kind: "commit" | "tree"): string | undefined {
  const r = git(["rev-parse", "--verify", "--quiet", `${ref}^{${kind}}`]);
  return r.ok && FULL_SHA.test(r.out) ? r.out : undefined;
}

function parentsOf(git: Git, commit: string): string[] | undefined {
  const r = git(["rev-list", "--parents", "-n", "1", commit]);
  const [self, ...parents] = r.out.split(/\s+/).filter(Boolean);
  return r.ok && self === commit ? parents : undefined;
}

function cleanMergeTree(git: Git, ours: string, theirs: string): string | undefined {
  const r = git(["merge-tree", "--write-tree", ours, theirs]);
  const tree = r.out.split("\n")[0] ?? "";
  return r.ok && FULL_SHA.test(tree) ? tree : undefined;
}

function linkRefusal(git: Git, commit: string, tip: string, target: string): { first: string } | { why: string } {
  const parents = parentsOf(git, commit);
  if (!parents) return { why: `${short(commit)} can't be read in this checkout` };
  const [first, second, ...more] = parents;
  if (first === undefined || second === undefined || more.length) return { why: `${short(commit)} isn't a merge of two parents, so it may change the task's code` };
  if (!git(["merge-base", "--is-ancestor", second, tip]).ok) return { why: `${short(commit)} merges ${short(second)}, which isn't on ${target}` };
  const merged = cleanMergeTree(git, first, second);
  if (!merged) return { why: `${short(commit)} merges ${target} with a conflict` };
  if (merged !== resolve(git, commit, "tree")) return { why: `${short(commit)} holds edits beyond the merge of ${target}` };
  return { first };
}

export function compareHeads(git: Git, approvedRef: string, headRef: string, target: string): HeadCompare {
  const approved = resolve(git, approvedRef, "commit");
  if (!approved) return { kind: "changed", why: `the approved commit ${approvedRef} isn't in this checkout` };
  const head = resolve(git, headRef, "commit");
  if (!head) return { kind: "changed", why: `${headRef} isn't a commit in this checkout` };
  if (head === approved) return { kind: "same", head };
  const tip = resolve(git, target, "commit");
  if (!tip) return { kind: "changed", why: `${target} isn't in this checkout (git fetch first)` };
  const tree = resolve(git, head, "tree");
  if (tree !== undefined && tree === resolve(git, approved, "tree")) return { kind: "kept", how: "same-tree", head, approved, tip };
  let at = head;
  for (let links = 0; links < MAX_LINKS; links++) {
    const link = linkRefusal(git, at, tip, target);
    if ("why" in link) return { kind: "changed", why: link.why };
    if (link.first === approved) return { kind: "kept", how: "clean-merge", head, approved, tip };
    at = link.first;
  }
  return { kind: "changed", why: `more than ${MAX_LINKS} merges sit between ${short(approved)} and ${short(head)}` };
}

export function repoOf(git: Git): string | undefined {
  const url = git(["remote", "get-url", "origin"]);
  const m = url.ok ? /[:/]([^/:\s]+\/[^/\s]+?)(?:\.git)?$/.exec(url.out) : null;
  return m?.[1];
}

export function targetOf(git: Git): string {
  const r = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  return r.ok && r.out ? r.out : "origin/main";
}
