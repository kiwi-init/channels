import { fsError } from "./errors.ts";
import { parentOf, type Node, type Store } from "./store.ts";

const SPACE = "git";
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface GitStat {
  type: "file" | "dir" | "symlink";
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

function norm(path: string): string {
  const parts: string[] = [];
  for (const p of path.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return `/${parts.join("/")}`;
}

function encodingOf(opts: unknown): string | undefined {
  if (typeof opts === "string") return opts;
  if (typeof opts === "object" && opts !== null && "encoding" in opts) {
    const e: unknown = opts.encoding;
    return typeof e === "string" ? e : undefined;
  }
  return undefined;
}

function toStat(n: Node, path: string): GitStat {
  const type = n.kind === "dir" ? "dir" : n.kind === "symlink" ? "symlink" : "file";
  let ino = 0;
  for (let i = 0; i < path.length; i++) ino = (ino * 31 + path.charCodeAt(i)) >>> 0;
  return {
    type,
    mode: n.mode,
    size: n.size,
    ino,
    mtimeMs: n.mtime,
    ctimeMs: n.mtime,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => type === "file",
    isDirectory: () => type === "dir",
    isSymbolicLink: () => type === "symlink",
  };
}

export class GitFs {
  constructor(private readonly store: Store) {}

  private live(path: string): Node | undefined {
    if (path === "/") return { kind: "dir", mode: 0o40755, mtime: 0, size: 0, target: null };
    const n = this.store.get(SPACE, path);
    return n === undefined || n.kind === "gone" ? undefined : n;
  }

  private ensureDir(path: string): void {
    if (path === "/" || this.live(path) !== undefined) return;
    this.ensureDir(parentOf(path));
    this.store.put(SPACE, path, { kind: "dir", mode: 0o40755, mtime: Date.now(), size: 0, target: null });
  }

  readonly promises = {
    readFile: async (raw: string, opts?: unknown): Promise<string | Uint8Array> => {
      const path = norm(raw);
      const n = this.live(path);
      if (n === undefined) throw fsError("ENOENT", "open", path);
      if (n.kind === "dir") throw fsError("EISDIR", "read", path);
      const data = this.store.read(SPACE, path);
      const e = encodingOf(opts);
      return e === "utf8" || e === "utf-8" ? dec.decode(data) : data;
    },
    writeFile: async (raw: string, data: string | Uint8Array, opts?: unknown): Promise<void> => {
      const path = norm(raw);
      this.ensureDir(parentOf(path));
      const bytes = typeof data === "string" ? enc.encode(data) : data;
      const mode = typeof opts === "object" && opts !== null && "mode" in opts && typeof opts.mode === "number" ? opts.mode : 0o100644;
      this.store.put(SPACE, path, { kind: "file", mode, mtime: Date.now(), size: bytes.byteLength, target: null }, bytes);
    },
    unlink: async (raw: string): Promise<void> => {
      const path = norm(raw);
      if (this.live(path) === undefined) throw fsError("ENOENT", "unlink", path);
      this.store.drop(SPACE, path);
    },
    readdir: async (raw: string): Promise<string[]> => {
      const path = norm(raw);
      const n = this.live(path);
      if (n === undefined) throw fsError("ENOENT", "scandir", path);
      if (n.kind !== "dir") throw fsError("ENOTDIR", "scandir", path);
      return this.store.children(SPACE, path).filter((c) => c.node.kind !== "gone").map((c) => c.name);
    },
    mkdir: async (raw: string): Promise<void> => {
      const path = norm(raw);
      if (this.live(path) !== undefined) throw fsError("EEXIST", "mkdir", path);
      if (this.live(parentOf(path)) === undefined) throw fsError("ENOENT", "mkdir", path);
      this.store.put(SPACE, path, { kind: "dir", mode: 0o40755, mtime: Date.now(), size: 0, target: null });
    },
    rmdir: async (raw: string): Promise<void> => {
      const path = norm(raw);
      if (this.live(path) === undefined) throw fsError("ENOENT", "rmdir", path);
      if (this.store.children(SPACE, path).length > 0) throw fsError("ENOTEMPTY", "rmdir", path);
      this.store.drop(SPACE, path);
    },
    stat: async (raw: string): Promise<GitStat> => {
      const path = norm(raw);
      const n = this.live(path);
      if (n === undefined) throw fsError("ENOENT", "stat", path);
      return toStat(n, path);
    },
    lstat: async (raw: string): Promise<GitStat> => {
      const path = norm(raw);
      const n = this.live(path);
      if (n === undefined) throw fsError("ENOENT", "lstat", path);
      return toStat(n, path);
    },
    readlink: async (raw: string): Promise<string> => {
      const path = norm(raw);
      const n = this.live(path);
      if (n === undefined || n.kind !== "symlink" || n.target === null) throw fsError("EINVAL", "readlink", path);
      return n.target;
    },
    symlink: async (target: string, raw: string): Promise<void> => {
      const path = norm(raw);
      this.ensureDir(parentOf(path));
      this.store.put(SPACE, path, { kind: "symlink", mode: 0o120000, mtime: Date.now(), size: target.length, target });
    },
    chmod: async (raw: string, mode: number): Promise<void> => {
      const path = norm(raw);
      const n = this.live(path);
      if (n === undefined) throw fsError("ENOENT", "chmod", path);
      this.store.put(SPACE, path, { ...n, mode }, n.kind === "file" ? this.store.read(SPACE, path) : undefined);
    },
  };
}
