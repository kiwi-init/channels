import type { BufferEncoding, CpOptions, FileContent, FsStat, IFileSystem, MkdirOptions, RmOptions } from "just-bash/browser";

type ReadFileOptions = Exclude<Parameters<IFileSystem["readFile"]>[1], BufferEncoding | undefined>;
type WriteFileOptions = Exclude<Parameters<IFileSystem["writeFile"]>[2], BufferEncoding | undefined>;
type DirentEntry = Awaited<ReturnType<NonNullable<IFileSystem["readdirWithFileTypes"]>>>[number];
import { fsError } from "./errors.ts";
import { baseName, parentOf } from "./store.ts";
import type { Worktree } from "./tree.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

function norm(path: string): string {
  const parts: string[] = [];
  for (const p of path.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return `/${parts.join("/")}`;
}

function encodingOf(o: ReadFileOptions | BufferEncoding | WriteFileOptions | undefined): BufferEncoding | null | undefined {
  if (o === undefined) return undefined;
  if (typeof o === "string") return o;
  return o.encoding;
}

function decode(bytes: Uint8Array, e: BufferEncoding | null | undefined): string {
  if (e === "base64") {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }
  if (e === "hex") return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (e === "binary" || e === "latin1") {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
  return dec.decode(bytes);
}

function encode(c: FileContent, e: BufferEncoding | null | undefined): Uint8Array {
  if (typeof c !== "string") return c;
  if (e === "binary" || e === "latin1") return Uint8Array.from(c, (ch) => ch.charCodeAt(0) & 0xff);
  if (e === "base64") return Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0));
  return enc.encode(c);
}

export class WorktreeFs implements IFileSystem {
  constructor(private readonly wt: Worktree) {}

  private async target(path: string): Promise<string> {
    const n = this.wt.lookup(path);
    if (n?.kind !== "symlink") return path;
    const t = n.target ?? dec.decode(await this.wt.read(path));
    return t.startsWith("/") ? norm(t) : norm(`${parentOf(path)}/${t}`);
  }

  private async follow(raw: string): Promise<string> {
    let p = norm(raw);
    for (let i = 0; i < 8; i++) {
      const next = await this.target(p);
      if (next === p) return p;
      p = next;
    }
    throw fsError("EINVAL", "too many links", raw);
  }

  async readFile(path: string, options?: ReadFileOptions | BufferEncoding): Promise<string> {
    return decode(await this.wt.read(await this.follow(path)), encodingOf(options));
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return this.wt.read(await this.follow(path));
  }

  async writeFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> {
    this.wt.write(await this.follow(path), encode(content, encodingOf(options)));
  }

  async appendFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> {
    const p = await this.follow(path);
    const prev = this.wt.lookup(p) === undefined ? new Uint8Array() : await this.wt.read(p);
    const add = encode(content, encodingOf(options));
    const out = new Uint8Array(prev.byteLength + add.byteLength);
    out.set(prev);
    out.set(add, prev.byteLength);
    this.wt.write(p, out);
  }

  async exists(path: string): Promise<boolean> {
    return this.wt.lookup(norm(path)) !== undefined;
  }

  private async statOf(p: string): Promise<FsStat> {
    const n = this.wt.lookup(p);
    if (n === undefined) throw fsError("ENOENT", "stat", p);
    const size = n.kind === "file" ? (n.size >= 0 ? n.size : (await this.wt.read(p)).byteLength) : n.size;
    return { isFile: n.kind === "file", isDirectory: n.kind === "dir", isSymbolicLink: n.kind === "symlink", mode: n.mode | (n.kind === "dir" ? 0o40000 : n.kind === "symlink" ? 0o120000 : 0o100000), size, mtime: new Date(n.mtime) };
  }

  async stat(path: string): Promise<FsStat> {
    return this.statOf(await this.follow(path));
  }

  async lstat(path: string): Promise<FsStat> {
    return this.statOf(norm(path));
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    this.wt.mkdir(norm(path), options?.recursive === true);
  }

  async readdir(path: string): Promise<string[]> {
    const p = await this.follow(path);
    const n = this.wt.lookup(p);
    if (n === undefined) throw fsError("ENOENT", "scandir", p);
    if (n.kind !== "dir") throw fsError("ENOTDIR", "scandir", p);
    return this.wt.list(p);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const p = await this.follow(path);
    const names = await this.readdir(p);
    return names.map((name) => {
      const n = this.wt.lookup(p === "/" ? `/${name}` : `${p}/${name}`);
      return { name, isFile: n?.kind === "file", isDirectory: n?.kind === "dir", isSymbolicLink: n?.kind === "symlink" };
    });
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const p = norm(path);
    const n = this.wt.lookup(p);
    if (n === undefined) {
      if (options?.force === true) return;
      throw fsError("ENOENT", "rm", p);
    }
    if (n.kind === "dir" && options?.recursive !== true && this.wt.list(p).length > 0) throw fsError("ENOTEMPTY", "rm", p);
    this.wt.remove(p);
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const s = norm(src);
    const d = norm(dest);
    const n = this.wt.lookup(s);
    if (n === undefined) throw fsError("ENOENT", "cp", s);
    if (n.kind === "dir") {
      if (options?.recursive !== true) throw fsError("EISDIR", "cp", s);
      this.wt.mkdir(d, true);
      for (const c of this.wt.list(s)) await this.cp(`${s}/${c}`, `${d}/${c}`, options);
      return;
    }
    this.wt.write(d, await this.wt.read(s), n.mode);
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.cp(src, dest, { recursive: true });
    this.wt.remove(norm(src));
  }

  resolvePath(base: string, path: string): string {
    return path.startsWith("/") ? norm(path) : norm(`${base}/${path}`);
  }

  getAllPaths(): string[] {
    const out = new Set<string>([...this.wt.base.dirs.keys(), ...this.wt.base.files.keys()]);
    for (const dir of [...out]) for (const name of this.wt.list(dir)) out.add(dir === "/" ? `/${name}` : `${dir}/${name}`);
    return [...out].filter((p) => this.wt.lookup(p) !== undefined);
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.wt.chmod(norm(path), mode & 0o777);
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    this.wt.symlink(target, norm(linkPath));
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.cp(existingPath, newPath);
  }

  async readlink(path: string): Promise<string> {
    const p = norm(path);
    const n = this.wt.lookup(p);
    if (n?.kind !== "symlink") throw fsError("EINVAL", "readlink", p);
    return n.target ?? dec.decode(await this.wt.read(p));
  }

  async realpath(path: string): Promise<string> {
    const p = await this.follow(path);
    if (this.wt.lookup(p) === undefined) throw fsError("ENOENT", "realpath", p);
    return p;
  }

  async utimes(path: string, _atime: Date, _mtime: Date): Promise<void> {
    if (this.wt.lookup(norm(path)) === undefined) throw fsError("ENOENT", "utimes", baseName(path));
  }
}
