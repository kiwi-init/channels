import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveGit } from "./git-server.ts";

interface Exec {
  ms: number;
  exitCode: number;
  stdout: string;
  stderr: string;
}

const here = join(import.meta.dir, "..");
const repoRoot = join(here, "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "kiwi-lab-"));
const gitPort = 18790;
const devPort = 18787;
const origin = `http://127.0.0.1:${gitPort}/repo.git`;
const base = `http://127.0.0.1:${devPort}/ws/e2e`;

function run(cmd: string[], cwd: string): string {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
}

async function post<T>(op: string, body: Record<string, string>): Promise<T> {
  const r = await fetch(`${base}/${op}`, { method: "POST", body: JSON.stringify(body) });
  const j: unknown = await r.json();
  if (!r.ok) throw new Error(`${op}: ${JSON.stringify(j)}`);
  return j as T;
}

function sh(worktree: string, script: string): Promise<Exec> {
  return post<Exec>("exec", { worktree, script });
}

async function waitUp(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/stats`);
      if (r.ok) return;
    } catch {
      await Bun.sleep(500);
    }
  }
  throw new Error("wrangler dev never came up");
}

const bare = join(scratch, "repo.git");
run(["git", "clone", "--quiet", "--bare", "--no-local", repoRoot, bare], scratch);
const head = run(["git", "rev-parse", "HEAD"], repoRoot);
run(["git", "update-ref", "refs/heads/main", head], bare);
run(["git", "symbolic-ref", "HEAD", "refs/heads/main"], bare);
run(["git", "config", "http.receivepack", "true"], bare);

const git = serveGit(scratch, gitPort);
const dev = Bun.spawn(["bunx", "wrangler", "dev", "--port", String(devPort), "--ip", "127.0.0.1", "--persist-to", join(scratch, "state")], { cwd: here, stdout: "ignore", stderr: "ignore", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });

try {
  await waitUp();
  const clone = await post<{ ms: number; files: number; head: string; storedBytes: number }>("clone", { url: origin });
  const tracked = Number(run(["git", "ls-tree", "-r", "--name-only", head], repoRoot).split("\n").length);
  check(clone.head === head && clone.files === tracked, `clone: ${clone.files} files at ${head.slice(0, 7)} into the Durable Object in ${clone.ms}ms (${clone.storedBytes} bytes)`);

  const t0 = performance.now();
  await Promise.all(["otter", "heron", "lynx"].map((name) => post("worktrees", { name })));
  check(true, `3 copy-on-write worktrees in ${Math.round(performance.now() - t0)}ms`);

  const edits = await Promise.all([
    sh("otter", `printf 'otter was here\\n' >> AGENTS.md && git commit -m "otter: sign AGENTS.md"`),
    sh("heron", `mkdir -p docs/ideas && printf '# Workspaces\\n' > docs/ideas/workspaces.md && git status && git commit -m "heron: workspaces idea"`),
    sh("lynx", `rm NOTICE && git diff | grep -c '^-' && git commit -m "lynx: drop NOTICE"`),
  ]);
  for (const e of edits) check(e.exitCode === 0, `agent script exit 0 in ${e.ms}ms: ${e.stdout.trim().split("\n").at(-1) ?? ""}`);

  const isolated = await sh("otter", "test -e NOTICE && test ! -e docs/ideas/workspaces.md && echo isolated");
  check(isolated.stdout.trim() === "isolated", "worktrees are isolated from each other");

  for (const name of ["heron", "otter", "lynx"]) {
    const m = await post<{ fastForward: boolean; mergeCommit: boolean }>("merge", { worktree: name });
    check(m.fastForward || m.mergeCommit, `merge agent/${name} into main (${m.fastForward ? "fast-forward" : "merge commit"})`);
  }

  await post("worktrees", { name: "reviewer" });
  const seen = await sh("reviewer", "tail -1 AGENTS.md; cat docs/ideas/workspaces.md; test ! -e NOTICE && echo gone");
  check(seen.stdout === "otter was here\n# Workspaces\ngone\n", "a fresh worktree from main sees all three agents' work");

  await post("worktrees", { name: "ana" });
  await post("worktrees", { name: "bob" });
  await sh("ana", `sed -i '1s/.*/# ana/' README.md && git commit -m ana`);
  await sh("bob", `sed -i '1s/.*/# bob/' README.md && git commit -m bob`);
  await post("merge", { worktree: "ana" });
  const clash = await fetch(`${base}/merge`, { method: "POST", body: JSON.stringify({ worktree: "bob" }) });
  const clashBody = await clash.text();
  check(clash.status === 500 && clashBody.includes("README.md"), "a conflicting merge is refused and names README.md");

  const pushed = await post<{ ok: boolean }>("push", { url: origin, ref: "main", remoteRef: "refs/heads/from-durable-object" });
  check(pushed.ok, "push main from the Durable Object to the origin");
  run(["git", "fsck", "--strict", "--no-dangling"], bare);
  check(true, "git fsck --strict on the origin passes");
  const log = run(["git", "log", "--format=%s", "-12", "from-durable-object"], bare);
  check(log.includes("lynx: drop NOTICE") && log.includes("heron: workspaces idea") && log.includes("otter: sign AGENTS.md"), "the origin has every agent's commit");
} finally {
  dev.kill();
  await git.stop(true);
  rmSync(scratch, { recursive: true, force: true });
}
