import fs from "node:fs";
import path from "node:path";

import type { ModDetails, ModSettingView } from "./bridge.ts";

const COPIES = ".sources.json";
const README = /^readme(?:\.(?:md|markdown))?$/i;
const README_BYTES = 64 * 1024;
const WALK_ENTRIES = 50_000;

function configValue(raw: string): string {
  let out = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\" && i + 1 < raw.length) {
      const n = raw[++i];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
    } else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "#" || c === ";")) break;
    else out += c;
  }
  return out.trim();
}

export function kiwiKeys(dir: string): Record<string, string> | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, ".git", "config"), "utf8");
  } catch {
    // Not a clone kiwi mod add made: a copy it took from a repo of many, or a folder put there by hand.
    return null;
  }
  const keys: Record<string, string> = {};
  let inKiwi = false;
  for (const line of text.split("\n")) {
    let rest = line.trim();
    const head = /^\[([^\]]*)\](.*)$/.exec(rest);
    if (head) {
      inKiwi = (head[1] ?? "").trim().toLowerCase() === "kiwi";
      rest = (head[2] ?? "").trim();
    }
    const kv = inKiwi ? /^([a-z][a-z0-9-]*)\s*=(.*)$/i.exec(rest) : null;
    if (kv) keys[(kv[1] ?? "").toLowerCase()] = configValue(kv[2] ?? "");
  }
  return keys;
}

export function copyOf(dir: string): Record<string, unknown> | null {
  try {
    const copies = JSON.parse(fs.readFileSync(path.join(path.dirname(dir), COPIES), "utf8")) as unknown;
    const copy = copies && typeof copies === "object" ? (copies as Record<string, unknown>)[path.basename(dir)] : null;
    return copy && typeof copy === "object" ? (copy as Record<string, unknown>) : null;
  } catch {
    // No mod was copied out of a repo of many, or the file isn't kiwi mod add's: the folder counts as local.
    return null;
  }
}

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function headCommit(dir: string): string | null {
  const git = path.join(dir, ".git");
  let head: string;
  try {
    head = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim();
  } catch {
    // Not a git clone, or a worktree whose .git is a file: no commit to show.
    return null;
  }
  if (/^[0-9a-f]{40}$/.test(head)) return head;
  const ref = /^ref: (refs\/[\w./-]+)$/.exec(head)?.[1];
  if (!ref || ref.split("/").includes("..")) return null;
  try {
    const loose = fs.readFileSync(path.join(git, ref), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(loose)) return loose;
  } catch {
    // The branch lives only in packed-refs.
  }
  try {
    for (const line of fs.readFileSync(path.join(git, "packed-refs"), "utf8").split("\n")) {
      const [sha, name] = line.trim().split(" ");
      if (name === ref && sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
    }
  } catch {
    // No packed-refs either: a branch with no commits yet.
  }
  return null;
}

function measure(dir: string): { bytes: number | null; updated: number | null } {
  let bytes = 0;
  let updated = 0;
  let seen = 0;
  const walk = (at: string, inGit: boolean): boolean => {
    let list: fs.Dirent[];
    try {
      list = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      // A folder that can't be read adds nothing to the size.
      return true;
    }
    for (const d of list) {
      if (++seen > WALK_ENTRIES) return false;
      const at2 = path.join(at, d.name);
      const git = inGit || (at === dir && d.name === ".git");
      if (d.isDirectory()) {
        if (!walk(at2, git)) return false;
        continue;
      }
      const st = fs.lstatSync(at2, { throwIfNoEntry: false });
      if (!st) continue;
      bytes += st.size;
      if (!git && st.mtimeMs > updated) updated = st.mtimeMs;
    }
    return true;
  };
  return walk(dir, false) ? { bytes, updated: updated ? Math.round(updated) : null } : { bytes: null, updated: null };
}

function readme(dir: string): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // An unreadable folder has no README to show.
    return null;
  }
  const rank = (n: string): number => (/\.md$/i.test(n) ? 0 : /\.markdown$/i.test(n) ? 1 : 2);
  const name = names.filter((n) => README.test(n)).sort((a, b) => rank(a) - rank(b))[0];
  if (!name) return null;
  const file = path.join(dir, name);
  if (!fs.lstatSync(file).isFile()) return null;
  const buf = Buffer.alloc(README_BYTES);
  const fd = fs.openSync(file, "r");
  let n: number;
  try {
    n = fs.readSync(fd, buf, 0, README_BYTES, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buf.subarray(0, n).toString("utf8");
}

export interface DetailsBase {
  name: string;
  version: string | null;
  source: string;
  author: string | null;
  iconWhy: string | null;
  settings: ModSettingView[];
}

export function modDetails(dir: string, base: DetailsBase): ModDetails {
  const link = fs.lstatSync(dir, { throwIfNoEntry: false });
  let real = dir;
  try {
    real = fs.realpathSync(dir);
  } catch {
    // A link to a folder that's gone: the details say what little is known.
  }
  const keys = link?.isSymbolicLink() ? null : kiwiKeys(dir);
  const copy = keys || link?.isSymbolicLink() ? null : copyOf(dir);
  const added = Date.parse(text(keys?.["added"]) ?? text(copy?.["added"]) ?? "");
  const born = link?.birthtimeMs ?? 0;
  const { bytes, updated } = measure(real);
  return {
    ...base,
    commit: headCommit(real) ?? text(copy?.["commit"]),
    installed: Number.isFinite(added) ? added : born > 0 ? Math.round(born) : null,
    updated,
    bytes,
    readme: readme(real),
  };
}
