import git, { type TreeEntry } from "isomorphic-git";
import { fsError } from "./errors.ts";
import type { GitFs } from "./gitfs.ts";
import { baseName, parentOf, type Node, type Store } from "./store.ts";

export const GITDIR = "/.git";

export interface Entry {
  oid: string;
  mode: string;
}

export interface Snapshot {
  commit: string;
  time: number;
  files: Map<string, Entry>;
  dirs: Map<string, Set<string>>;
}

export interface Change {
  path: string;
  status: "added" | "modified" | "deleted";
  before: string | null;
}

export type GitCache = Record<string, unknown>;

export interface Git {
  fs: GitFs;
  cache: GitCache;
}

function addDirs(dirs: Map<string, Set<string>>, path: string): void {
  let child = path;
  let dir = parentOf(path);
  for (;;) {
    let set = dirs.get(dir);
    if (set === undefined) {
      set = new Set();
      dirs.set(dir, set);
    }
    const had = set.has(baseName(child));
    set.add(baseName(child));
    if (dir === "/" || had) return;
    child = dir;
    dir = parentOf(dir);
  }
}

function gitOrder(e: TreeEntry): string {
  return e.type === "tree" ? `${e.path}/` : e.path;
}

export async function snapshot(g: Git, commit: string): Promise<Snapshot> {
  const c = await git.readCommit({ fs: g.fs, gitdir: GITDIR, oid: commit, cache: g.cache });
  const files = new Map<string, Entry>();
  const dirs = new Map<string, Set<string>>([["/", new Set()]]);
  const walkTree = async (oid: string, prefix: string): Promise<void> => {
    const t = await git.readTree({ fs: g.fs, gitdir: GITDIR, oid, cache: g.cache });
    for (const e of t.tree) {
      const p = `${prefix}/${e.path}`;
      if (e.type === "tree") {
        if (!dirs.has(p)) dirs.set(p, new Set());
        addDirs(dirs, p);
        await walkTree(e.oid, p);
      } else if (e.type === "blob") {
        files.set(p, { oid: e.oid, mode: e.mode });
        addDirs(dirs, p);
      }
    }
  };
  await walkTree(c.commit.tree, "");
  return { commit, time: c.commit.committer.timestamp * 1000, files, dirs };
}

export class Worktree {
  readonly space: string;
  private blobCache = new Map<string, Uint8Array>();

  constructor(
    private readonly store: Store,
    private readonly g: Git,
    readonly name: string,
    readonly branch: string,
    public base: Snapshot,
  ) {
    this.space = `wt:${name}`;
  }

  private overlay(path: string): Node | undefined {
    return this.store.get(this.space, path);
  }

  lookup(path: string): Node | undefined {
    if (path === "/") return { kind: "dir", mode: 0o755, mtime: this.base.time, size: 0, target: null };
    const o = this.overlay(path);
    if (o !== undefined) return o.kind === "gone" ? undefined : o;
    const f = this.base.files.get(path);
    if (f !== undefined) {
      const kind = f.mode === "120000" ? "symlink" : "file";
      return { kind, mode: f.mode === "100755" ? 0o755 : 0o644, mtime: this.base.time, size: -1, target: null };
    }
    if (this.base.dirs.has(path)) return { kind: "dir", mode: 0o755, mtime: this.base.time, size: 0, target: null };
    return undefined;
  }

  async read(path: string): Promise<Uint8Array> {
    const o = this.overlay(path);
    if (o !== undefined) {
      if (o.kind === "gone") throw fsError("ENOENT", "open", path);
      if (o.kind === "dir") throw fsError("EISDIR", "read", path);
      return this.store.read(this.space, path);
    }
    const f = this.base.files.get(path);
    if (f === undefined) throw this.base.dirs.has(path) ? fsError("EISDIR", "read", path) : fsError("ENOENT", "open", path);
    const hit = this.blobCache.get(f.oid);
    if (hit !== undefined) return hit;
    const { blob } = await git.readBlob({ fs: this.g.fs, gitdir: GITDIR, oid: f.oid, cache: this.g.cache });
    this.blobCache.set(f.oid, blob);
    return blob;
  }

  list(dir: string): string[] {
    const names = new Set(this.base.dirs.get(dir) ?? []);
    for (const c of this.store.children(this.space, dir)) {
      if (c.node.kind === "gone") names.delete(c.name);
      else names.add(c.name);
    }
    return [...names].sort();
  }

  private ensureDir(dir: string): void {
    if (dir === "/") return;
    const n = this.lookup(dir);
    if (n !== undefined) {
      if (n.kind !== "dir") throw fsError("ENOTDIR", "mkdir", dir);
      return;
    }
    this.ensureDir(parentOf(dir));
    this.store.put(this.space, dir, { kind: "dir", mode: 0o755, mtime: Date.now(), size: 0, target: null });
  }

  mkdir(path: string, recursive: boolean): void {
    if (this.lookup(path) !== undefined) {
      if (recursive) return;
      throw fsError("EEXIST", "mkdir", path);
    }
    if (!recursive && this.lookup(parentOf(path)) === undefined) throw fsError("ENOENT", "mkdir", path);
    this.ensureDir(path);
  }

  write(path: string, bytes: Uint8Array, mode?: number): void {
    this.ensureDir(parentOf(path));
    const prev = this.lookup(path);
    if (prev?.kind === "dir") throw fsError("EISDIR", "open", path);
    this.store.put(this.space, path, { kind: "file", mode: mode ?? prev?.mode ?? 0o644, mtime: Date.now(), size: bytes.byteLength, target: null }, bytes);
  }

  symlink(target: string, path: string): void {
    this.ensureDir(parentOf(path));
    this.store.put(this.space, path, { kind: "symlink", mode: 0o777, mtime: Date.now(), size: target.length, target });
  }

  async chmod(path: string, mode: number): Promise<void> {
    const n = this.lookup(path);
    if (n === undefined) throw fsError("ENOENT", "chmod", path);
    if (n.kind === "dir") {
      this.store.put(this.space, path, { ...n, mode });
      return;
    }
    const bytes = await this.read(path);
    this.store.put(this.space, path, { ...n, kind: "file", mode, size: bytes.byteLength }, bytes);
  }

  remove(path: string): void {
    const n = this.lookup(path);
    if (n === undefined) throw fsError("ENOENT", "rm", path);
    if (n.kind === "dir") for (const c of this.list(path)) this.remove(path === "/" ? `/${c}` : `${path}/${c}`);
    const inBase = this.base.files.has(path) || this.base.dirs.has(path);
    if (inBase) this.store.put(this.space, path, { kind: "gone", mode: 0, mtime: Date.now(), size: 0, target: null });
    else this.store.drop(this.space, path);
  }

  async changes(): Promise<Change[]> {
    const out: Change[] = [];
    for (const { path, node } of this.store.all(this.space)) {
      const before = this.base.files.get(path);
      if (node.kind === "gone") {
        if (before !== undefined) out.push({ path, status: "deleted", before: before.oid });
        continue;
      }
      if (node.kind === "dir") continue;
      const bytes = node.kind === "symlink" ? new TextEncoder().encode(node.target ?? "") : this.store.read(this.space, path);
      const { oid } = await git.hashBlob({ object: bytes });
      const mode = node.kind === "symlink" ? "120000" : node.mode & 0o111 ? "100755" : "100644";
      if (before === undefined) out.push({ path, status: "added", before: null });
      else if (before.oid !== oid || before.mode !== mode) out.push({ path, status: "modified", before: before.oid });
    }
    return out;
  }

  async baseBlob(oid: string): Promise<Uint8Array> {
    const { blob } = await git.readBlob({ fs: this.g.fs, gitdir: GITDIR, oid, cache: this.g.cache });
    return blob;
  }

  async commit(message: string, author: { name: string; email: string }): Promise<string | null> {
    const changes = await this.changes();
    if (changes.length === 0) return null;
    const files = new Map(this.base.files);
    for (const c of changes) {
      if (c.status === "deleted") {
        files.delete(c.path);
        continue;
      }
      const node = this.overlay(c.path);
      if (node === undefined) continue;
      const bytes = node.kind === "symlink" ? new TextEncoder().encode(node.target ?? "") : this.store.read(this.space, c.path);
      const oid = await git.writeBlob({ fs: this.g.fs, gitdir: GITDIR, blob: bytes });
      const mode = node.kind === "symlink" ? "120000" : node.mode & 0o111 ? "100755" : "100644";
      files.set(c.path, { oid, mode });
    }
    const tree = await this.writeTrees(files);
    const now = Math.floor(Date.now() / 1000);
    const who = { ...author, timestamp: now, timezoneOffset: 0 };
    const oid = await git.writeCommit({ fs: this.g.fs, gitdir: GITDIR, commit: { message: `${message}\n`, tree, parent: [this.base.commit], author: who, committer: who } });
    await git.writeRef({ fs: this.g.fs, gitdir: GITDIR, ref: `refs/heads/${this.branch}`, value: oid, force: true });
    this.store.clear(this.space);
    this.base = await snapshot(this.g, oid);
    return oid;
  }

  private async writeTrees(files: Map<string, Entry>): Promise<string> {
    const byDir = new Map<string, TreeEntry[]>([["/", []]]);
    const dirsOf = new Set<string>(["/"]);
    for (const path of files.keys()) {
      let d = parentOf(path);
      while (!dirsOf.has(d)) {
        dirsOf.add(d);
        d = parentOf(d);
      }
    }
    for (const [path, e] of files) {
      const d = parentOf(path);
      const list = byDir.get(d) ?? [];
      list.push({ mode: e.mode, path: baseName(path), oid: e.oid, type: "blob" });
      byDir.set(d, list);
    }
    const depth = (d: string): number => (d === "/" ? 0 : d.split("/").length - 1);
    const ordered = [...dirsOf].sort((a, b) => depth(b) - depth(a));
    let root = "";
    for (const d of ordered) {
      const entries = (byDir.get(d) ?? []).sort((a, b) => gitOrder(a) < gitOrder(b) ? -1 : gitOrder(a) > gitOrder(b) ? 1 : 0);
      const oid = await git.writeTree({ fs: this.g.fs, gitdir: GITDIR, tree: entries });
      if (d === "/") root = oid;
      else {
        const p = parentOf(d);
        const list = byDir.get(p) ?? [];
        list.push({ mode: "040000", path: baseName(d), oid, type: "tree" });
        byDir.set(p, list);
      }
    }
    return root;
  }
}
