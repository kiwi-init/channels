import { DurableObject } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Bash, InMemoryFs, MountableFs } from "just-bash/browser";
import { gitCommand } from "./gitcmd.ts";
import { GitFs } from "./gitfs.ts";
import { Store } from "./store.ts";
import { GITDIR, snapshot, Worktree, type Git, type Snapshot } from "./tree.ts";
import { WorktreeFs } from "./wtfs.ts";

interface Env {
  WORKSPACE: DurableObjectNamespace<Workspace>;
}

interface WtRow extends Record<string, SqlStorageValue> {
  name: string;
  branch: string;
  head: string;
}

const MOUNT = "/work";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string" || v === "") throw new Error(`${field} is required`);
  return v;
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? Object.fromEntries(Object.entries(v)) : {};
}

export class Workspace extends DurableObject<Env> {
  private readonly store: Store;
  private readonly g: Git;
  private readonly snaps = new Map<string, Snapshot>();
  private readonly trees = new Map<string, Worktree>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new Store(ctx.storage.sql);
    this.g = { fs: new GitFs(this.store), cache: {} };
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS wt(name TEXT PRIMARY KEY, branch TEXT NOT NULL, head TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  private meta(k: string): string | undefined {
    const r = this.ctx.storage.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return r?.v;
  }

  private async snap(commit: string): Promise<Snapshot> {
    const hit = this.snaps.get(commit);
    if (hit !== undefined) return hit;
    const s = await snapshot(this.g, commit);
    this.snaps.set(commit, s);
    return s;
  }

  private async tree(name: string): Promise<Worktree> {
    const hit = this.trees.get(name);
    if (hit !== undefined) return hit;
    const r = this.ctx.storage.sql.exec<WtRow>("SELECT name, branch, head FROM wt WHERE name = ?", name).toArray()[0];
    if (r === undefined) throw new Error(`no worktree ${name}`);
    const head = await git.resolveRef({ fs: this.g.fs, gitdir: GITDIR, ref: `refs/heads/${r.branch}` });
    const wt = new Worktree(this.store, this.g, r.name, r.branch, await this.snap(head));
    this.trees.set(name, wt);
    return wt;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const body = req.method === "POST" ? obj(await req.json()) : {};
    const t0 = performance.now();
    const ms = (): number => Math.round((performance.now() - t0) * 10) / 10;
    try {
      const op = url.pathname.split("/").at(-1);
      if (op === "clone") {
        const repo = str(body.url, "url");
        await git.clone({ fs: this.g.fs, http, dir: "/", gitdir: GITDIR, url: repo, singleBranch: true, depth: 1, noCheckout: true, noTags: true, cache: this.g.cache });
        const main = (await git.currentBranch({ fs: this.g.fs, gitdir: GITDIR })) ?? "main";
        const head = await git.resolveRef({ fs: this.g.fs, gitdir: GITDIR, ref: main });
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta(k, v) VALUES ('main', ?)", main);
        const s = await this.snap(head);
        return json({ ms: ms(), main, head, files: s.files.size, dirs: s.dirs.size, storedBytes: this.store.bytes() });
      }
      if (op === "worktrees") {
        const name = str(body.name, "name");
        const from = typeof body.from === "string" ? body.from : (this.meta("main") ?? "main");
        const branch = `agent/${name}`;
        const head = await git.resolveRef({ fs: this.g.fs, gitdir: GITDIR, ref: `refs/heads/${from}` });
        await git.writeRef({ fs: this.g.fs, gitdir: GITDIR, ref: `refs/heads/${branch}`, value: head, force: true });
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO wt(name, branch, head) VALUES (?, ?, ?)", name, branch, head);
        this.trees.delete(name);
        await this.tree(name);
        return json({ ms: ms(), worktree: name, branch, head });
      }
      if (op === "exec") {
        const wt = await this.tree(str(body.worktree, "worktree"));
        const script = str(body.script, "script");
        const fs = new MountableFs({ base: new InMemoryFs(), mounts: [{ mountPoint: MOUNT, filesystem: new WorktreeFs(wt) }] });
        const who = { name: `agent ${wt.name}`, email: `${wt.name}@agents.kiwi` };
        const bash = new Bash({ fs, cwd: MOUNT, env: { HOME: MOUNT, PWD: MOUNT, USER: wt.name }, customCommands: [gitCommand(wt, this.g, who, MOUNT)], executionLimitProfile: "hardened", executionLimits: { maxExecutionTimeMs: 20_000 }, defenseInDepth: false });
        const r = await bash.exec(script);
        return json({ ms: ms(), exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr });
      }
      if (op === "merge") {
        const wt = await this.tree(str(body.worktree, "worktree"));
        const main = this.meta("main") ?? "main";
        const r = await git.merge({ fs: this.g.fs, gitdir: GITDIR, ours: main, theirs: wt.branch, author: { name: "kiwi merge queue", email: "merge@agents.kiwi" }, message: `Merge ${wt.branch}`, cache: this.g.cache });
        this.trees.clear();
        return json({ ms: ms(), merged: wt.branch, into: main, oid: r.oid, fastForward: r.fastForward === true, mergeCommit: r.mergeCommit === true });
      }
      if (op === "push") {
        const repo = str(body.url, "url");
        const ref = typeof body.ref === "string" ? body.ref : (this.meta("main") ?? "main");
        const remoteRef = typeof body.remoteRef === "string" ? body.remoteRef : ref;
        const r = await git.push({ fs: this.g.fs, http, gitdir: GITDIR, url: repo, ref, remoteRef, cache: this.g.cache });
        return json({ ms: ms(), ok: r.ok, error: r.error, refs: r.refs });
      }
      if (op === "stats") {
        const rows = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM node").one().n;
        const branches = await git.listBranches({ fs: this.g.fs, gitdir: GITDIR });
        const wts = this.ctx.storage.sql.exec<WtRow>("SELECT name, branch, head FROM wt").toArray();
        return json({ ms: ms(), sqliteBytes: this.ctx.storage.sql.databaseSize, storedChunkBytes: this.store.bytes(), nodeRows: rows, branches, worktrees: wts.map((w) => w.name) });
      }
      return json({ error: `unknown op ${op ?? ""}` }, 404);
    } catch (err) {
      return json({ ms: ms(), error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) }, 500);
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = /^\/ws\/([a-z0-9-]{1,64})\//.exec(url.pathname);
    if (m === null) return json({ error: "use /ws/<name>/{clone,worktrees,exec,merge,stats}" }, 404);
    return env.WORKSPACE.get(env.WORKSPACE.idFromName(m[1] ?? "")).fetch(req);
  },
} satisfies ExportedHandler<Env>;
