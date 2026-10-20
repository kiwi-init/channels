import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectWhere, whereFromFiles } from "../src/card.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-where-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]): string => {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: root } });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};

function repo(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "first");
  return dir;
}

describe("where an agent works, read from git's files with no git process", () => {
  test("the origin's owner/repo and the branch, from the repo or any folder inside it", () => {
    const dir = repo("plain");
    git(dir, "remote", "add", "origin", "git@github.com:ojow/channels.git");
    git(dir, "checkout", "-q", "-b", "T149-daemon-cpu");
    mkdirSync(join(dir, "src", "deep"), { recursive: true });
    expect(whereFromFiles(dir)).toEqual({ repo: "ojow/channels", branch: "T149-daemon-cpu" });
    expect(whereFromFiles(join(dir, "src", "deep"))).toEqual({ repo: "ojow/channels", branch: "T149-daemon-cpu" });
  });

  test("a worktree's own branch, with the origin from the main repo's config", () => {
    const dir = repo("main-of-worktree");
    git(dir, "remote", "add", "origin", "https://github.com/ojow/kiwi.git");
    git(dir, "worktree", "add", "-q", "-b", "T41-launch", join(root, "wt"));
    expect(whereFromFiles(join(root, "wt"))).toEqual({ repo: "ojow/kiwi", branch: "T41-launch" });
  });

  test("a detached head has no branch, a repo with no origin no repo, and no repo at all neither", () => {
    const dir = repo("detached");
    git(dir, "checkout", "-q", "--detach");
    expect(whereFromFiles(dir)).toEqual({});
    mkdirSync(join(root, "loose"));
    expect(whereFromFiles(join(root, "loose"))).toEqual({});
  });

  test("a config that rewrites or includes others is left to git, which reads the same answer", () => {
    const dir = repo("rewritten");
    git(dir, "remote", "add", "origin", "gh:ojow/rewritten");
    git(dir, "config", "url.git@github.com:.insteadOf", "gh:");
    expect(whereFromFiles(dir)).toBeNull();
    expect(detectWhere(dir)).toEqual({ repo: "ojow/rewritten", branch: "main" });
  });

  test("agrees with git on this checkout", () => {
    const here = join(import.meta.dir, "..");
    const fromGit = { repo: git(here, "remote", "get-url", "origin"), branch: git(here, "rev-parse", "--abbrev-ref", "HEAD") };
    const read = whereFromFiles(here);
    if (read) expect(read.branch ?? "HEAD").toBe(fromGit.branch);
  });
});
