import { existsSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { join, parse, resolve } from "node:path";
import type { Config } from "../config.ts";
import { seatsAt } from "../seats.ts";

const REPO_DEPTH = 3;
const REPOS_MAX = 100;
const VISITS_MAX = 5_000;
const SKIP = new Set(["node_modules", "Library", "Applications", "Movies", "Music", "Pictures"]);

export function seatFolders(cfg: Config, room?: string): string[] {
  const latest = new Map<string, number>();
  for (const dir of Object.keys(cfg.bindings ?? {})) {
    for (const seat of seatsAt(cfg, dir)) {
      if (room && cfg.channels[seat.alias]?.roomId !== room) continue;
      latest.set(dir, Math.max(latest.get(dir) ?? 0, seat.seen ?? seat.at ?? 0));
    }
  }
  return [...latest]
    .filter(([dir]) => existsSync(dir))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dir]) => dir);
}

export function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    // Not there, or not readable: not a folder an agent can start in.
    return false;
  }
}

function gitAt(dir: string): number | null {
  try {
    return statSync(join(dir, ".git")).mtimeMs;
  } catch {
    // No .git here: not a repo, so look inside it.
    return null;
  }
}

function children(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    // A folder this user can't read holds no repo to start in.
    return [];
  }
}

export function gitRepos(home: string, depth = REPO_DEPTH): string[] {
  const found: { dir: string; at: number }[] = [];
  let level = [home];
  let visits = 0;
  for (let d = 0; d < depth && level.length && visits < VISITS_MAX; d++) {
    const next: string[] = [];
    for (const dir of level) {
      for (const entry of children(dir)) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name) || ++visits > VISITS_MAX) continue;
        const path = join(dir, entry.name);
        const at = gitAt(path);
        if (at === null) next.push(path);
        else found.push({ dir: path, at });
      }
    }
    level = next;
  }
  return found
    .sort((a, b) => b.at - a.at || a.dir.localeCompare(b.dir))
    .slice(0, REPOS_MAX)
    .map((r) => r.dir);
}

export function remoteFolders(cfg: Config, room?: string): string[] {
  return [...new Set([...seatFolders(cfg, room), ...(cfg.launchRoots ?? []).filter(isFolder)])];
}

export function launchFolders(cfg: Config, room?: string, home = homedir()): string[] {
  return [...new Set([...remoteFolders(cfg, room), ...gitRepos(home)])];
}

export function withLaunchRoot(cfg: Config, dir: string): Config | string {
  const path = resolve(dir);
  if (!isFolder(path)) return `${path} isn't a folder on this computer`;
  const real = realpathSync(path);
  if (real === parse(real).root) return "a launch folder can't be the whole disk: pick a folder in it";
  return { ...cfg, launchRoots: [...new Set([...(cfg.launchRoots ?? []), real])] };
}

export function withoutLaunchRoot(cfg: Config, dir: string): Config {
  const path = resolve(dir);
  const real = isFolder(path) ? realpathSync(path) : path;
  const left = (cfg.launchRoots ?? []).filter((r) => r !== path && r !== real);
  if (left.length) return { ...cfg, launchRoots: left };
  const next = { ...cfg };
  delete next.launchRoots;
  return next;
}
