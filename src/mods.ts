import { isAppPrefix } from "@kiwi/core/mod-names.ts";
import { bundleMod } from "@kiwi/core/node/mod-bundle.ts";
import { readModIcon } from "@kiwi/core/node/mod-icon.ts";
import { checkManifest, type ModManifest } from "@kiwi/core/node/mod-manifest.ts";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

import KIT_TYPES from "./mod-kit.txt" with { type: "text" };

const MOD_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const STARTER_SHELL = "^3.6";
const MANIFEST_BYTES = 64 * 1024;
const PROTOCOLS = ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always", "-c", "protocol.file.allow=always"];

export class ModError extends Error {}

export interface Source {
  url: string;
  shown: string;
  ref: string | null;
  path: string | null;
}

interface Copy {
  source: string;
  url: string;
  path: string;
  ref: string | null;
  commit: string;
  hash: string;
  added?: string;
}

const COPIES = ".sources.json";

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
  if (/^https:\/\/[^\s]+$/.test(base) || /^ssh:\/\/[^\s]+$/.test(base) || /^file:\/\/\/[^\s]+$/.test(base))
    return { url: base, shown: base.replace(/^https:\/\//, "").replace(/\.git$/, ""), ref, path: null };
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(base)) return { url: base, shown: base, ref, path: null };
  if (isAbsolute(base)) return { url: base, shown: base, ref, path: null };
  const short = /^([a-z0-9.-]+\.[a-z]{2,}\/[\w.-]+\/[\w.-]+?)(?:\.git)?((?:\/[\w.-]+)+)?$/i.exec(base);
  if (short) {
    const repo = short[1]!;
    const path = short[2]?.slice(1) ?? null;
    if (path?.split("/").some((p) => p === "." || p === "..")) throw new ModError(`"${base}": a mod's folder in its repo can't walk out of it`);
    return { url: `https://${repo}.git`, shown: path ? `${repo}/${path}` : repo, ref, path };
  }
  throw new ModError(`"${base}" isn't a repo kiwi can clone: use github.com/owner/repo (or github.com/owner/repo/folder for one mod in it), an https:// or ssh address, or a full path`);
}

export function readManifest(text: string, folder?: string): ModManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ModError("its mod.json isn't JSON");
  }
  const named = raw && typeof raw === "object" ? (raw as { name?: unknown }).name : undefined;
  const checked = checkManifest(raw, folder ?? (typeof named === "string" ? named : ""), null);
  if (!checked.ok) throw new ModError(checked.why);
  return checked.manifest;
}

function manifestAt(dir: string, folder?: string): ModManifest {
  const file = join(dir, "mod.json");
  if (!existsSync(file)) throw new ModError("it has no mod.json");
  if (statSync(file).size > MANIFEST_BYTES) throw new ModError("its mod.json is over 64 KB");
  return readManifest(readFileSync(file, "utf8"), folder);
}

const isGit = (dir: string): boolean => existsSync(join(dir, ".git"));

function copiesOf(home: string): Record<string, Copy> {
  try {
    const raw = JSON.parse(readFileSync(join(modsDir(home), COPIES), "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, Copy>) : {};
  } catch {
    // No copied mods yet, or a file that isn't ours: every folder reads as local.
    return {};
  }
}

function keepCopy(home: string, name: string, copy: Copy | null): void {
  const all = copiesOf(home);
  if (copy) all[name] = copy;
  else delete all[name];
  writeFileSync(join(modsDir(home), COPIES), `${JSON.stringify(all, null, 2)}\n`);
}

function folderHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel)).sort()) {
      const path = rel ? `${rel}/${entry}` : entry;
      const st = lstatSync(join(dir, path));
      if (st.isDirectory()) walk(path);
      else hash.update(`${path}\0${st.isSymbolicLink() ? `-> ${readlinkSync(join(dir, path))}` : readFileSync(join(dir, path)).toString("base64")}\0`);
    }
  };
  walk("");
  return hash.digest("hex");
}

function cloneAt(source: Source, ref: string | null, tmp: string, run: Git): string {
  try {
    run(["clone", "--quiet", "--", source.url, tmp]);
  } catch (e) {
    throw new ModError(`couldn't clone ${source.shown}: ${(e as Error).message}`);
  }
  const commit = ref ? (commitOf(tmp, `origin/${ref}`, run) ?? commitOf(tmp, ref, run)) : commitOf(tmp, "HEAD", run);
  if (!commit) throw new ModError(ref ? `${source.shown} has no branch, tag or commit "${ref}"` : `${source.shown} has no commits`);
  run(["-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "--detach", commit], tmp);
  return commit;
}

function placeCopy(from: string, at: string): void {
  const staged = `${at}.placing-${randomBytes(6).toString("hex")}`;
  try {
    cpSync(from, staged, { recursive: true, verbatimSymlinks: true });
    rmSync(at, { recursive: true, force: true });
    renameSync(staged, at);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

const changedIn = (dir: string, run: Git): boolean => run(["status", "--porcelain"], dir) !== "" || run(["rev-list", "HEAD", "--not", "--remotes", "--tags"], dir) !== "";

function commitOf(dir: string, ref: string, run: Git): string | null {
  try {
    return run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], dir) || null;
  } catch {
    // Not a ref in this clone: the caller tries the next spelling or says so.
    return null;
  }
}

export function addMod(home: string, raw: string, run: Git = git): { manifest: ModManifest; commit: string; source: Source } {
  const source = parseSource(raw);
  const dir = modsDir(home);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.adding-${randomBytes(6).toString("hex")}`);
  try {
    const commit = cloneAt(source, source.ref, tmp, run);
    const root = source.path ? join(tmp, source.path) : tmp;
    let manifest: ModManifest;
    try {
      if (source.path && !statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new ModError(`it has no folder ${source.path}`);
      manifest = manifestAt(root);
    } catch (e) {
      throw new ModError(`${source.shown} isn't a mod: ${(e as Error).message}`);
    }
    const at = join(dir, manifest.name);
    if (existsSync(at)) throw new ModError(`a mod named ${manifest.name} is already in ${dir}: kiwi mod update ${manifest.name}, or kiwi mod remove ${manifest.name} first`);
    if (source.path) {
      placeCopy(root, at);
      keepCopy(home, manifest.name, { source: source.shown, url: source.url, path: source.path, ref: source.ref, commit, hash: folderHash(at), added: new Date().toISOString() });
      return { manifest, commit, source };
    }
    run(["config", "kiwi.source", source.shown], tmp);
    run(["config", "kiwi.added", new Date().toISOString()], tmp);
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
  const copies = copiesOf(home);
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
    const copy = copies[name];
    if (!link && isGit(dir)) {
      info.source = sourceOf(dir, run);
      info.local = info.source === null;
      info.commit = commitOf(dir, "HEAD", run)?.slice(0, 7) ?? null;
      info.changed = changedIn(dir, run);
    } else if (!link && copy) {
      info.source = copy.source;
      info.local = false;
      info.commit = copy.commit.slice(0, 7);
      info.changed = folderHash(dir) !== copy.hash;
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

function diffNeeds(was: ModManifest | null, next: ModManifest): { added: string[]; dropped: string[] } {
  const before = new Set(was?.needs ?? []);
  const after = new Set(next.needs);
  return { added: next.needs.filter((n) => !before.has(n)), dropped: (was?.needs ?? []).filter((n) => !after.has(n)) };
}

function updateCopy(home: string, name: string, dir: string, copy: Copy, take: (added: string[]) => boolean, run: Git): Change | null {
  if (folderHash(dir) !== copy.hash) throw new ModError("has changes that aren't in its source: keep them in a repo of your own, or kiwi mod remove --force it and add it again");
  const tmp = join(modsDir(home), `.updating-${randomBytes(6).toString("hex")}`);
  try {
    const to = cloneAt({ url: copy.url, shown: copy.source, ref: copy.ref, path: copy.path }, copy.ref, tmp, run);
    if (to === copy.commit) return null;
    const root = join(tmp, copy.path);
    if (existsSync(root) && folderHash(root) === copy.hash) {
      if (take([])) keepCopy(home, name, { ...copy, commit: to });
      return null;
    }
    let next: ModManifest;
    try {
      next = manifestAt(root, name);
    } catch (e) {
      throw new ModError(`its new version can't load: ${(e as Error).message}`);
    }
    let was: ModManifest | null = null;
    try {
      was = manifestAt(dir, name);
    } catch {
      // The current copy is broken: the update can only help, and it lists every need as new.
    }
    let commits = 0;
    try {
      commits = Number(run(["rev-list", "--count", `${copy.commit}..${to}`, "--", copy.path], tmp)) || 0;
    } catch {
      // Its old commit is gone from the source's history: the count is unknown, the update still applies.
    }
    const { added, dropped } = diffNeeds(was, next);
    const applied = take(added);
    if (applied) {
      placeCopy(root, dir);
      keepCopy(home, name, { ...copy, commit: to, hash: folderHash(dir) });
    }
    return { name, from: was?.version ?? null, to: next.version, commits, added, dropped, applied };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export const updateMods = (home: string, only: string | null, yes: boolean, run: Git = git): Updates => updatesOf(home, only, (added) => !added.length || yes, run);

export const checkUpdates = (home: string, only: string | null = null, run: Git = git): Updates => updatesOf(home, only, () => false, run);

function updatesOf(home: string, only: string | null, take: (added: string[]) => boolean, run: Git): Updates {
  if (only !== null && !MOD_NAME.test(only)) throw new ModError(`"${only}" isn't a mod name`);
  const names = only === null ? folders(home) : [only];
  if (only !== null && !folders(home).includes(only)) throw new ModError(`there's no mod named ${only} (kiwi mod list)`);
  const changes: Change[] = [];
  const current: string[] = [];
  const skipped: { name: string; why: string }[] = [];
  const copies = copiesOf(home);
  for (const name of names) {
    const dir = join(modsDir(home), name);
    const copy = copies[name];
    if (copy && !lstatSync(dir).isSymbolicLink() && !isGit(dir)) {
      try {
        const change = updateCopy(home, name, dir, copy, take, run);
        if (change) changes.push(change);
        else current.push(name);
      } catch (e) {
        skipped.push({ name, why: (e as Error).message });
      }
      continue;
    }
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
      let next: ModManifest;
      try {
        next = readManifest(run(["show", `${to}:mod.json`], dir), name);
      } catch (e) {
        skipped.push({ name, why: `its new version can't load: ${(e as Error).message}` });
        continue;
      }
      let was: ModManifest | null = null;
      try {
        was = manifestAt(dir, name);
      } catch {
        // The current checkout is broken: the update can only help, and it lists every need as new.
      }
      const { added, dropped } = diffNeeds(was, next);
      const commits = Number(run(["rev-list", "--count", `HEAD..${to}`], dir)) || 0;
      const applied = take(added);
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
  const copy = isGit(dir) ? undefined : copiesOf(home)[name];
  if (!force) {
    if (copy) {
      if (folderHash(dir) !== copy.hash) throw new ModError(`${name} has changes that aren't in its source: --force removes them anyway`);
    } else {
      if (!isGit(dir) || sourceOf(dir, run) === null) throw new ModError(`${name} isn't from a git source, so removing it deletes its only copy: --force removes it anyway`);
      if (changedIn(dir, run)) throw new ModError(`${name} has changes that aren't in its source: --force removes them anyway`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  if (copy) keepCopy(home, name, null);
  return { link: null };
}

const titleOf = (name: string): string =>
  name
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

export const KIT_TYPES_FILE = "kiwi-mod.d.ts";

const STARTER_TSCONFIG = {
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", lib: ["ES2022", "DOM", "DOM.Iterable"], strict: true, noEmit: true, skipLibCheck: true },
};

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

function freshTypes(dir: string): void {
  const file = join(dir, KIT_TYPES_FILE);
  if (existsSync(file) && readFileSync(file, "utf8") !== KIT_TYPES) writeFileSync(file, KIT_TYPES);
}

const STARTER_ICON = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
  '  <rect width="64" height="64" rx="14" fill="#2f6fe4"/>',
  '  <path d="M20 22h24M20 32h24M20 42h14" stroke="#fff" stroke-width="5" stroke-linecap="round"/>',
  "</svg>",
  "",
].join("\n");

function starter(dir: string, name: string): void {
  const title = titleOf(name);
  writeFileSync(join(dir, "mod.json"), json({ name, version: "0.1.0", shell: STARTER_SHELL, needs: ["panel"], icon: "icon.svg" }));
  writeFileSync(join(dir, "icon.svg"), STARTER_ICON);
  writeFileSync(join(dir, KIT_TYPES_FILE), KIT_TYPES);
  writeFileSync(join(dir, "tsconfig.json"), json(STARTER_TSCONFIG));
  writeFileSync(join(dir, "package.json"), json({ private: true, devDependencies: { "@types/react": "^19.3.0" } }));
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  writeFileSync(
    join(dir, "index.tsx"),
    [
      'import { Action, Actions, List, panel, Toast } from "@kiwi/mod"',
      "",
      "function View() {",
      "  return (",
      `    <List searchBarPlaceholder=${JSON.stringify(`Search ${title}`)}>`,
      `      <List.Section title=${JSON.stringify(title)}>`,
      "        <List.Item",
      '          title="Edit index.tsx and save"',
      '          subtitle="Channels reloads it"',
      '          icon="spec"',
      "          actions={",
      "            <Actions>",
      `              <Action title="Say hi" onAction={() => Toast.show({ title: ${JSON.stringify(`Hi from ${title}`)} })} />`,
      "            </Actions>",
      "          }",
      "        />",
      "      </List.Section>",
      "    </List>",
      "  )",
      "}",
      "",
      `panel({ title: ${JSON.stringify(title)}, render: View })`,
      "",
    ].join("\n"),
  );
}

export interface DevStart {
  at: string;
  dir: string;
  how: "created" | "linked" | "opened";
}

function realOf(at: string, name: string): string {
  try {
    return realpathSync(at);
  } catch {
    throw new ModError(`${at} links to ${readlinkSync(at)}, which is gone: kiwi mod remove ${name}, then link it again`);
  }
}

export function startDev(home: string, name: string, cwd: string): DevStart {
  if (!MOD_NAME.test(name)) throw new ModError(`"${name}" isn't a mod name: use lowercase letters, digits and dashes`);
  if (isAppPrefix(name)) throw new ModError(`"${name}" is a name Channels keeps for its own commands: pick another`);
  const at = join(modsDir(home), name);
  if (lstatSync(at, { throwIfNoEntry: false })) {
    const dir = realOf(at, name);
    freshTypes(dir);
    return { at, dir, how: "opened" };
  }
  mkdirSync(modsDir(home), { recursive: true });
  const here = join(cwd, "mod.json");
  if (existsSync(here)) {
    let named: unknown;
    try {
      named = (JSON.parse(readFileSync(here, "utf8")) as { name?: unknown } | null)?.name;
    } catch {
      // Unreadable: the message below says so.
    }
    if (named !== name)
      throw new ModError(
        typeof named === "string"
          ? `this folder's mod.json names it "${named}": kiwi mod dev ${named}`
          : "this folder has a mod.json with no name kiwi can read: fix it, or run kiwi mod dev from another folder",
      );
    const dir = realpathSync(cwd);
    symlinkSync(dir, at);
    freshTypes(dir);
    return { at, dir, how: "linked" };
  }
  mkdirSync(at);
  starter(at, name);
  return { at, dir: at, how: "created" };
}

export type DevRound = { ok: true; manifest: ModManifest; hash: string; bytes: number; icon: string | null } | { ok: false; why: string };

export async function devRound(dir: string, name: string): Promise<DevRound> {
  let manifest: ModManifest;
  try {
    manifest = manifestAt(dir, name);
  } catch (e) {
    return { ok: false, why: (e as Error).message };
  }
  const built = await bundleMod(dir);
  if (!built.ok) return { ok: false, why: built.why };
  const art = manifest.icon ? readModIcon(dir, manifest.icon) : null;
  return { ok: true, manifest, hash: built.hash, bytes: built.code.length, icon: art && !art.ok ? art.why : null };
}

export function nudgeApp(at: string): void {
  if (!lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink()) return;
  const now = new Date();
  lutimesSync(at, now, now);
}
