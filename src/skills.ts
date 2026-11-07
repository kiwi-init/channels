import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import MODS_SKILL from "./mods-skill.txt" with { type: "text" };
import { git, type Git, KIT_TYPES, KIT_TYPES_FILE, ModError, modsDir, parseSource } from "./mods.ts";

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SKILL_FILE = "SKILL.md";
const SKILL_BYTES = 256 * 1024;
const MANIFEST_BYTES = 64 * 1024;
const PATHISH = /(^|[\s`(["'])((?:\.\/)?[\w.-]+(?:\/[\w.-]*)+|[\w-]+\.(?:md|mjs|js|ts|tsx|css|html|json|sh|py))(?=$|[\s`)\]"',:;])/gm;

export interface Skill {
  name: string;
  about: string;
  note: string | null;
  mod: string;
  path: string | null;
  source: string | null;
  ref: string | null;
  builtin: boolean;
}

const BUILT_IN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  mods: { [SKILL_FILE]: MODS_SKILL, [KIT_TYPES_FILE]: KIT_TYPES },
};

export const DEFAULT_SKILLS: readonly Skill[] = [
  {
    name: "anatomy",
    about: "interactive figures that explain how things work",
    note: "In Channels, send a figure you built with `kiwi send --figure page.html`: it takes page-light.html beside it and a snapshot too.",
    mod: "anatomy",
    path: null,
    source: "github.com/wheresryan22/anatomy",
    ref: "1482e8469b0a9e0d8cc18ea2740a01423d29ae80",
    builtin: false,
  },
  {
    name: "mods",
    about: "make Channels mods: panels, commands, tabs and attachment drawers",
    note: "Check one with `kiwi mod check NAME` before you hand it over.",
    mod: "channels",
    path: null,
    source: null,
    ref: null,
    builtin: true,
  },
];

const skillsDir = (home: string): string => join(home, "skills");

const short = (ref: string): string => ref.slice(0, 7);

export function skillsIn(raw: unknown, mod: string): Skill[] {
  const list = raw && typeof raw === "object" ? (raw as { skills?: unknown }).skills : undefined;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new ModError("mod.json's skills must be a list");
  return list.map((entry): Skill => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new ModError("each of mod.json's skills is an object with a name and an about");
    const { name, about, note, path, source, ref } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !NAME.test(name)) throw new ModError("a skill's name must be lowercase letters, digits and dashes");
    if (typeof about !== "string" || !about.trim() || about.length > 80 || about.includes("\n")) throw new ModError(`skill ${name}: about is one line of up to 80 characters`);
    if (note !== undefined && (typeof note !== "string" || note.length > 300 || note.includes("\n"))) throw new ModError(`skill ${name}: note is one line of up to 300 characters`);
    const told = typeof note === "string" && note.trim() ? note.trim() : null;
    if (path !== undefined) {
      if (source !== undefined || ref !== undefined) throw new ModError(`skill ${name}: give a path or a source, not both`);
      if (typeof path !== "string" || !path || isAbsolute(path) || normalize(path).split(/[\\/]/).includes("..")) throw new ModError(`skill ${name}: path is a folder inside the mod`);
      return { name, about: about.trim(), note: told, mod, path: normalize(path), source: null, ref: null, builtin: false };
    }
    if (typeof source !== "string") throw new ModError(`skill ${name}: give a path inside the mod, or a source and a ref`);
    if (parseSource(source).ref !== null) throw new ModError(`skill ${name}: put the commit in ref, not after # in the source`);
    if (typeof ref !== "string" || !COMMIT.test(ref)) throw new ModError(`skill ${name}: ref is the full 40-character commit it's pinned to`);
    return { name, about: about.trim(), note: told, mod, path: null, source, ref, builtin: false };
  });
}

export function listSkills(home: string): Skill[] {
  const byName = new Map(DEFAULT_SKILLS.map((s) => [s.name, s]));
  const dir = modsDir(home);
  let names: string[] = [];
  try {
    names = readdirSync(dir)
      .filter((n) => NAME.test(n))
      .sort();
  } catch {
    // No mods folder yet: the default skills are all there is.
  }
  for (const mod of names) {
    const file = join(dir, mod, "mod.json");
    try {
      if (!existsSync(file) || statSync(file).size > MANIFEST_BYTES) continue;
      for (const s of skillsIn(JSON.parse(readFileSync(file, "utf8")), mod)) byName.set(s.name, s);
    } catch {
      // A mod whose mod.json can't be read adds no skills; kiwi mod list says what's wrong with it.
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function headOf(dir: string, run: Git): string | null {
  try {
    return run(["rev-parse", "HEAD"], dir);
  } catch {
    // Not a checkout Kiwi can read: it's fetched again.
    return null;
  }
}

export function fetched(home: string, skill: Skill, run: Git = git): boolean {
  if (skill.path !== null || skill.builtin) return true;
  const at = join(skillsDir(home), skill.name);
  return existsSync(join(at, SKILL_FILE)) && headOf(at, run) === skill.ref;
}

function builtinHome(home: string, skill: Skill): string {
  const files = BUILT_IN[skill.name];
  if (!files) throw new ModError(`skill ${skill.name}: Channels has no such skill built in`);
  const at = join(skillsDir(home), skill.name);
  mkdirSync(at, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    const to = join(at, file);
    if (!existsSync(to) || readFileSync(to, "utf8") !== text) writeFileSync(to, text);
  }
  return at;
}

export function skillHome(home: string, skill: Skill, run: Git = git): string {
  if (skill.builtin) return builtinHome(home, skill);
  if (skill.path !== null) {
    const dir = join(modsDir(home), skill.mod, skill.path);
    if (!existsSync(join(dir, SKILL_FILE))) throw new ModError(`skill ${skill.name}: the ${skill.mod} mod has no ${join(skill.path, SKILL_FILE)}`);
    return dir;
  }
  const at = join(skillsDir(home), skill.name);
  if (fetched(home, skill, run)) return at;
  const source = parseSource(skill.source!);
  const ref = skill.ref!;
  mkdirSync(skillsDir(home), { recursive: true });
  const tmp = join(skillsDir(home), `.fetching-${randomBytes(6).toString("hex")}`);
  try {
    try {
      run(["init", "--quiet", tmp]);
      try {
        run(["fetch", "--quiet", "--depth", "1", source.url, ref], tmp);
      } catch {
        // Some servers only hand out commits a branch or a tag points at: fetch those, then take the pinned one.
        run(["fetch", "--quiet", source.url, "+refs/heads/*:refs/remotes/origin/*", "+refs/tags/*:refs/tags/*"], tmp);
      }
      run(["-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "--detach", ref], tmp);
    } catch (e) {
      throw new ModError(`couldn't fetch the ${skill.name} skill from ${source.shown} at ${short(ref)}: ${(e as Error).message}. It needs the network once, then works offline`);
    }
    if (!existsSync(join(tmp, SKILL_FILE))) throw new ModError(`${source.shown} at ${short(ref)} has no ${SKILL_FILE}, so it isn't a skill`);
    rmSync(at, { recursive: true, force: true });
    renameSync(tmp, at);
    return at;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function skillText(skill: Skill, dir: string): string {
  const file = join(dir, SKILL_FILE);
  if (statSync(file).size > SKILL_BYTES) throw new ModError(`skill ${skill.name}: its ${SKILL_FILE} is over 256 KB`);
  const body = readFileSync(file, "utf8")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(PATHISH, (whole, lead: string, path: string) => {
      const clean = path.replace(/^\.\//, "");
      if (clean.split("/").includes("..") || !existsSync(join(dir, clean))) return whole;
      return `${lead}${join(dir, clean)}`;
    });
  const from = skill.builtin ? "Channels itself" : skill.source ? `${skill.source} at ${short(skill.ref!)}` : `the ${skill.mod} mod`;
  return `Skill "${skill.name}", from ${from}. Its files are in ${dir}, and the paths below point there.${skill.note ? ` ${skill.note}` : ""}\n\n${body.trim()}\n`;
}
