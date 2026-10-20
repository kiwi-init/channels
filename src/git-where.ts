import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
function gitDirs(cwd: string): { git: string; common: string } | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const dot = join(dir, ".git");
    const st = statSync(dot, { throwIfNoEntry: false });
    if (st?.isDirectory()) return { git: dot, common: dot };
    if (st?.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"));
      if (!m) return null;
      const git = resolve(dir, m[1]!.trim());
      const common = statSync(join(git, "commondir"), { throwIfNoEntry: false })?.isFile() ? resolve(git, readFileSync(join(git, "commondir"), "utf8").trim()) : git;
      return { git, common };
    }
    if (dirname(dir) === dir) return null;
  }
}

function originUrl(config: string): string | null {
  let inOrigin = false;
  for (const raw of config.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) inOrigin = /^\[remote\s+"origin"\]$/.test(line);
    else if (inOrigin) {
      const m = /^url\s*=\s*(.+)$/.exec(line);
      if (m) return m[1]!.trim();
    }
  }
  return null;
}

export function readGitFiles(cwd: string): { url: string | null; branch: string | null } | null {
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE) return null;
  try {
    const dirs = gitDirs(cwd);
    if (!dirs) return { url: null, branch: null };
    const config = readFileSync(join(dirs.common, "config"), "utf8");
    if (/insteadof|includeif|\[include\]/i.test(config)) return null;
    const head = readFileSync(join(dirs.git, "HEAD"), "utf8").trim();
    return { url: originUrl(config), branch: head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : null };
  } catch {
    // A git folder Kiwi can't read as files: git itself answers instead.
    return null;
  }
}
