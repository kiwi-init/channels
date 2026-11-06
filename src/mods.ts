import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const MOD_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MANIFEST_BYTES = 64 * 1024;
const PROTOCOLS = ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always", "-c", "protocol.file.allow=always"];

export class ModError extends Error {}

export interface Source {
  url: string;
  shown: string;
  ref: string | null;
}

export interface Manifest {
  name: string;
  version: string;
  needs: string[];
}

export interface ModInfo {
  name: string;
  version: string | null;
  needs: string[];
  source: string | null;
  commit: string | null;
  local: boolean;
  link: string | null;
  changed: boolean;
  problem: string | null;
}

interface Change {
  name: string;
  from: string | null;
  to: string;
  commits: number;
  added: string[];
  dropped: string[];
  applied: boolean;
}

export type Git = (args: string[], cwd?: string) => string;

export const git: Git = (args, cwd) => {
  try {
    return execFileSync("git", [...PROTOCOLS, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" },
    }).trim();
  } catch (e) {
    const err = e as { stderr?: string; code?: string };
    if (err.code === "ENOENT") throw new ModError("git isn't installed, and mods are git repos");
    const said = (err.stderr ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "git failed";
    throw new ModError(said.replace(/^(fatal|error): /, ""));
  }
};

export const modsDir = (home: string): string => join(home, "mods");

export function parseSource(raw: string): Source {
  const hash = raw.lastIndexOf("#");
  const base = (hash > 0 ? raw.slice(0, hash) : raw).trim();
  const ref = hash > 0 ? raw.slice(hash + 1).trim() : null;
  if (ref !== null && !/^[\w./-]{1,200}$/.test(ref)) throw new ModError(`"#${ref}" isn't a branch, tag or commit`);
  if (ref?.startsWith("-") || ref?.includes("..")) throw new ModError(`"#${ref}" isn't a branch, tag or commit`);
  if (!base || base.startsWith("-")) throw new ModError("give a git repo: kiwi mod add github.com/owner/repo");
  if (/^https:\/\/[^\s]+$/.test(base) || /^ssh:\/\/[^\s]+$/.test(base) || /^file:\/\/\/[^\s]+$/.test(base)) return { url: base, shown: base.replace(/^https:\/\//, "").replace(/\.git$/, ""), ref };
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(base)) return { url: base, shown: base, ref };
  if (isAbsolute(base)) return { url: base, shown: base, ref };
  if (/^[a-z0-9.-]+\.[a-z]{2,}\/[\w.-]+\/[\w.-]+$/i.test(base)) return { url: `https://${base.replace(/\.git$/, "")}.git`, shown: base.replace(/\.git$/, ""), ref };
  throw new ModError(`"${base}" isn't a repo kiwi can clone: use github.com/owner/repo, an https:// or ssh address, or a full path`);
}

export function readManifest(text: string, folder?: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ModError("its mod.json isn't JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ModError("its mod.json isn't a JSON object");
  const { name, version, needs } = raw as Record<string, unknown>;
  if (typeof name !== "string" || !MOD_NAME.test(name)) throw new ModError("mod.json's name must be lowercase letters, digits and dashes");
  if (folder !== undefined && name !== folder) throw new ModError(`mod.json names it "${name}", but its folder is "${folder}"`);
  if (typeof version !== "string" || !VERSION.test(version)) throw new ModError("mod.json's version isn't a version like 1.0.0");
  if (needs !== undefined && (!Array.isArray(needs) || needs.some((n) => typeof n !== "string"))) throw new ModError("mod.json's needs must be a list of strings");
  return { name, version, needs: [...new Set((needs ?? []) as string[])] };
}

function manifestAt(dir: string, folder?: string): Manifest {
  const file = join(dir, "mod.json");
  if (!existsSync(file)) throw new ModError("it has no mod.json");
  if (statSync(file).size > MANIFEST_BYTES) throw new ModError("its mod.json is over 64 KB");
  return readManifest(readFileSync(file, "utf8"), folder);
}

const isGit = (dir: string): boolean => existsSync(join(dir, ".git"));

const changedIn = (dir: string, run: Git): boolean => run(["status", "--porcelain"], dir) !== "" || run(["rev-list", "HEAD", "--not", "--remotes", "--tags"], dir) !== "";

function commitOf(dir: string, ref: string, run: Git): string | null {
  try {
    return run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], dir) || null;
  } catch {
    // Not a ref in this clone: the caller tries the next spelling or says so.
    return null;
  }
}

export function addMod(home: string, raw: string, run: Git = git): { manifest: Manifest; commit: string; source: Source } {
  const source = parseSource(raw);
  const dir = modsDir(home);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.adding-${randomBytes(6).toString("hex")}`);
  try {
    try {
      run(["clone", "--quiet", "--", source.url, tmp]);
    } catch (e) {
      throw new ModError(`couldn't clone ${source.shown}: ${(e as Error).message}`);
    }
    const commit = source.ref ? (commitOf(tmp, `origin/${source.ref}`, run) ?? commitOf(tmp, source.ref, run)) : commitOf(tmp, "HEAD", run);
    if (!commit) throw new ModError(source.ref ? `${source.shown} has no branch, tag or commit "${source.ref}"` : `${source.shown} has no commits`);
    run(["checkout", "--quiet", "--detach", commit], tmp);
    let manifest: Manifest;
    try {
      manifest = manifestAt(tmp);
    } catch (e) {
      throw new ModError(`${source.shown} isn't a mod: ${(e as Error).message}`);
    }
    const at = join(dir, manifest.name);
    if (existsSync(at)) throw new ModError(`a mod named ${manifest.name} is already in ${dir}: kiwi mod update ${manifest.name}, or kiwi mod remove ${manifest.name} first`);
    run(["config", "kiwi.source", source.shown], tmp);
    if (source.ref) run(["config", "kiwi.ref", source.ref], tmp);
    renameSync(tmp, at);
    return { manifest, commit, source };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function folders(home: string): string[] {
  const dir = modsDir(home);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    // No mods folder yet reads as no mods.
    return [];
  }
  return names.filter((n) => !n.startsWith(".") && statSync(join(dir, n), { throwIfNoEntry: false })?.isDirectory()).sort();
}

function sourceOf(dir: string, run: Git): string | null {
  for (const key of ["kiwi.source", "remote.origin.url"]) {
    try {
      const v = run(["config", "--get", key], dir);
      if (v) return v;
    } catch {
      // That key isn't set: try the next one.
    }
  }
  return null;
}

export function listMods(home: string, run: Git = git): ModInfo[] {
  return folders(home).map((name) => {
    const dir = join(modsDir(home), name);
    const link = lstatSync(dir).isSymbolicLink() ? readlinkSync(dir) : null;
    const info: ModInfo = { name, version: null, needs: [], source: null, commit: null, local: true, link, changed: false, problem: null };
    try {
      const m = manifestAt(dir, name);
      info.version = m.version;
      info.needs = m.needs;
    } catch (e) {
      info.problem = (e as Error).message;
    }
    if (!link && isGit(dir)) {
      info.source = sourceOf(dir, run);
      info.local = info.source === null;
      info.commit = commitOf(dir, "HEAD", run)?.slice(0, 7) ?? null;
      info.changed = changedIn(dir, run);
    }
    return info;
  });
}

function target(dir: string, run: Git): string {
  let ref: string | null = null;
  try {
    ref = run(["config", "--get", "kiwi.ref"], dir) || null;
  } catch {
    // Added without #ref: it follows the repo's default branch.
  }
  const found = ref ? (commitOf(dir, `origin/${ref}`, run) ?? commitOf(dir, ref, run)) : commitOf(dir, "refs/remotes/origin/HEAD", run);
  if (!found) throw new ModError(ref ? `its source has no "${ref}" any more` : "its source has no default branch");
  return found;
}

export interface Updates {
  changes: Change[];
  current: string[];
  skipped: { name: string; why: string }[];
}

export function updateMods(home: string, only: string | null, yes: boolean, run: Git = git): Updates {
  if (only !== null && !MOD_NAME.test(only)) throw new ModError(`"${only}" isn't a mod name`);
  const names = only === null ? folders(home) : [only];
  if (only !== null && !folders(home).includes(only)) throw new ModError(`there's no mod named ${only} (kiwi mod list)`);
  const changes: Change[] = [];
  const current: string[] = [];
  const skipped: { name: string; why: string }[] = [];
  for (const name of names) {
    const dir = join(modsDir(home), name);
    if (lstatSync(dir).isSymbolicLink() || !isGit(dir) || sourceOf(dir, run) === null) {
      skipped.push({ name, why: "isn't from a git source, so there's nothing to pull" });
      continue;
    }
    try {
      if (changedIn(dir, run)) {
        skipped.push({ name, why: "has changes that aren't in its source: commit and push them, or kiwi mod remove it and add it again" });
        continue;
      }
      run(["fetch", "--quiet", "--tags", "--force", "origin"], dir);
      const to = target(dir, run);
      const at = commitOf(dir, "HEAD", run);
      if (to === at) {
        current.push(name);
        continue;
      }
      let next: Manifest;
      try {
        next = readManifest(run(["show", `${to}:mod.json`], dir), name);
      } catch (e) {
        skipped.push({ name, why: `its new version can't load: ${(e as Error).message}` });
        continue;
      }
      let was: Manifest | null = null;
      try {
        was = manifestAt(dir, name);
      } catch {
        // The current checkout is broken: the update can only help, and it lists every need as new.
      }
      const before = new Set(was?.needs ?? []);
      const after = new Set(next.needs);
      const added = next.needs.filter((n) => !before.has(n));
      const dropped = (was?.needs ?? []).filter((n) => !after.has(n));
      const commits = Number(run(["rev-list", "--count", `HEAD..${to}`], dir)) || 0;
      const applied = !added.length || yes;
      if (applied) run(["checkout", "--quiet", "--detach", to], dir);
      changes.push({ name, from: was?.version ?? null, to: next.version, commits, added, dropped, applied });
    } catch (e) {
      skipped.push({ name, why: (e as Error).message });
    }
  }
  return { changes, current, skipped };
}

export function removeMod(home: string, name: string, force: boolean, run: Git = git): { link: string | null } {
  if (!MOD_NAME.test(name)) throw new ModError(`"${name}" isn't a mod name`);
  const dir = join(modsDir(home), name);
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (!st) throw new ModError(`there's no mod named ${name} (kiwi mod list)`);
  if (st.isSymbolicLink()) {
    const link = readlinkSync(dir);
    unlinkSync(dir);
    return { link };
  }
  if (!force) {
    if (!isGit(dir) || sourceOf(dir, run) === null) throw new ModError(`${name} isn't from a git source, so removing it deletes its only copy: --force removes it anyway`);
    if (changedIn(dir, run)) throw new ModError(`${name} has changes that aren't in its source: --force removes them anyway`);
  }
  rmSync(dir, { recursive: true, force: true });
  return { link: null };
}
