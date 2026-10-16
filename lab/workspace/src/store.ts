export type Kind = "file" | "dir" | "symlink" | "gone";

export interface Node {
  kind: Kind;
  mode: number;
  mtime: number;
  size: number;
  target: string | null;
}

interface NodeRow extends Record<string, SqlStorageValue> {
  path: string;
  kind: string;
  mode: number;
  mtime: number;
  size: number;
  target: string | null;
}

const CHUNK = 1_000_000;

function asKind(s: string): Kind {
  if (s === "file" || s === "dir" || s === "symlink" || s === "gone") return s;
  throw new Error(`bad kind ${s}`);
}

function toNode(r: NodeRow): Node {
  return { kind: asKind(r.kind), mode: r.mode, mtime: r.mtime, size: r.size, target: r.target };
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function childRange(dir: string): [string, string] {
  const prefix = dir === "/" ? "/" : `${dir}/`;
  return [prefix, `${prefix.slice(0, -1)}0`];
}

export class Store {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS node(space TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, mode INTEGER NOT NULL, mtime INTEGER NOT NULL, size INTEGER NOT NULL, target TEXT, PRIMARY KEY(space, path))");
    sql.exec("CREATE TABLE IF NOT EXISTS chunk(space TEXT NOT NULL, path TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(space, path, idx))");
  }

  get(space: string, path: string): Node | undefined {
    const rows = this.sql.exec<NodeRow>("SELECT path, kind, mode, mtime, size, target FROM node WHERE space = ? AND path = ?", space, path).toArray();
    const r = rows[0];
    return r === undefined ? undefined : toNode(r);
  }

  read(space: string, path: string): Uint8Array {
    const parts = this.sql.exec<{ data: ArrayBuffer }>("SELECT data FROM chunk WHERE space = ? AND path = ? ORDER BY idx", space, path).toArray();
    const total = parts.reduce((n, p) => n + p.data.byteLength, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(new Uint8Array(p.data), at);
      at += p.data.byteLength;
    }
    return out;
  }

  put(space: string, path: string, node: Node, data?: Uint8Array): void {
    this.sql.exec("INSERT OR REPLACE INTO node(space, path, kind, mode, mtime, size, target) VALUES (?, ?, ?, ?, ?, ?, ?)", space, path, node.kind, node.mode, node.mtime, node.size, node.target);
    this.sql.exec("DELETE FROM chunk WHERE space = ? AND path = ?", space, path);
    if (data === undefined) return;
    for (let i = 0, idx = 0; i < data.byteLength || idx === 0; i += CHUNK, idx++) {
      this.sql.exec("INSERT INTO chunk(space, path, idx, data) VALUES (?, ?, ?, ?)", space, path, idx, data.subarray(i, i + CHUNK));
    }
  }

  drop(space: string, path: string): void {
    this.sql.exec("DELETE FROM node WHERE space = ? AND path = ?", space, path);
    this.sql.exec("DELETE FROM chunk WHERE space = ? AND path = ?", space, path);
  }

  children(space: string, dir: string): Array<{ name: string; node: Node }> {
    const [lo, hi] = childRange(dir);
    const rows = this.sql.exec<NodeRow>("SELECT path, kind, mode, mtime, size, target FROM node WHERE space = ? AND path >= ? AND path < ? AND instr(substr(path, ?), '/') = 0", space, lo, hi, lo.length + 1).toArray();
    return rows.map((r) => ({ name: r.path.slice(lo.length), node: toNode(r) }));
  }

  all(space: string): Array<{ path: string; node: Node }> {
    return this.sql.exec<NodeRow>("SELECT path, kind, mode, mtime, size, target FROM node WHERE space = ? ORDER BY path", space).toArray().map((r) => ({ path: r.path, node: toNode(r) }));
  }

  clear(space: string): void {
    this.sql.exec("DELETE FROM node WHERE space = ?", space);
    this.sql.exec("DELETE FROM chunk WHERE space = ?", space);
  }

  bytes(): number {
    const r = this.sql.exec<{ n: number }>("SELECT COALESCE(SUM(length(data)), 0) AS n FROM chunk").one();
    return r.n;
  }
}
