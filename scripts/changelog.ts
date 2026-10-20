// The changelog writes itself from main's history. Every PR is squash-merged into one commit whose
// subject is the PR's title (… (#N)), so a release's entries are the commits since the last release:
// each one's title and a link to its PR. Version bumps ("kiwi 0.11.0 (#98)") are left out.
//
// A tag's release writes its section (scripts/stamp.ts), and fails when it has none (--notes).
//
//   bun scripts/changelog.ts                  print the section for src/version.ts's version, from the last release to HEAD
//   bun scripts/changelog.ts --write          put that section into CHANGELOG.md (replacing one for the same version)
//   bun scripts/changelog.ts --all --write    rebuild CHANGELOG.md from every release tag
//   bun scripts/changelog.ts --notes vX.Y.Z   the release notes for a tag: its CHANGELOG.md section
//                                             (a pre-release with none gets one made from its commits)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareVersions } from "@kiwi/core/versions.ts";

const ROOT = resolve(import.meta.dir, "..");
const FILE = resolve(ROOT, "CHANGELOG.md");
const REPO = "https://github.com/ojowwalker77/channels";
const HEADER = `# Changelog\n\nWritten by \`bun scripts/changelog.ts\` from each squash-merged pull request's title.\n`;

export type Entry = { title: string; pr: number | null };

/** A version-bump commit: "kiwi 0.11.0", "kiwi 0.11.0-rc.8 (#97)". Not a change of its own. */
export const isBump = (subject: string) => /^kiwi v?\d+\.\d+\.\d+(?:-[\w.]+)?(?: \(#\d+\))?$/.test(subject.trim());

const isPre = (version: string) => version.replace(/^v/, "").includes("-");

export function entryOf(subject: string): Entry {
  const m = /^(.*?)\s*\(#(\d+)\)$/.exec(subject.trim());
  return { title: m ? m[1]! : subject.trim(), pr: m ? Number(m[2]) : null };
}

/** The changelog section for one release. */
export function section(version: string, date: string, entries: Entry[]): string {
  const items = entries.map((e) => `- **${e.title}**${e.pr ? ` ([#${e.pr}](${REPO}/pull/${e.pr}))` : ""}`);
  return `## ${version.replace(/^v/, "")} — ${date}\n\n${items.join("\n") || "- No changes."}\n`;
}

/** Puts a section into the changelog's text: in place of the same version's, else above the newest. */
export function upsert(text: string, version: string, sec: string): string {
  const body = text.startsWith("# ") ? text.slice(text.indexOf("\n## ") + 1 || text.length) : text;
  const sections = body.split(/(?=^## )/m).filter((s) => s.startsWith("## "));
  const v = version.replace(/^v/, "");
  const at = sections.findIndex((s) => s.startsWith(`## ${v} `) || s.startsWith(`## ${v}\n`));
  if (at >= 0) sections[at] = sec;
  else sections.unshift(sec);
  return `${HEADER}\n${sections.map((s) => s.trimEnd() + "\n").join("\n")}`;
}

/** The section for one version as CHANGELOG.md has it, or null. */
export function sectionIn(text: string, version: string): string | null {
  const v = version.replace(/^v/, "");
  const sec = text.split(/(?=^## )/m).find((s) => s.startsWith(`## ${v} `) || s.startsWith(`## ${v}\n`));
  return sec ? sec.trimEnd() + "\n" : null;
}

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

function subjects(range: string): string[] {
  return git("log", "--first-parent", "--reverse", "--format=%s", range)
    .split("\n")
    .filter((s) => s.trim());
}

/** The release before this version among tags reachable from `ref`: the last real one, or for a pre-release, the last of any kind. */
function previousTag(version: string, ref: string): string | null {
  const tags = git("tag", "--merged", ref, "--list", "v*")
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+/.test(t) && compareVersions(t, version) < 0 && (isPre(version) || !isPre(t)));
  return tags.sort(compareVersions).pop() ?? null;
}

export function sectionFor(version: string, ref: string, date: string): string {
  const prev = previousTag(version, ref);
  const entries = subjects(prev ? `${prev}..${ref}` : ref)
    .filter((s) => !isBump(s))
    .map(entryOf);
  return section(version, date, entries);
}

const tagDate = (ref: string) => git("log", "-1", "--format=%cs", ref).trim();

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { write: { type: "boolean" }, all: { type: "boolean" }, notes: { type: "string" } },
  });
  const { VERSION } = await import("../src/version.ts");
  const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : HEADER;

  if (values.notes) {
    const tag = values.notes;
    const sec = sectionIn(current, tag);
    if (sec) console.log(sec.replace(/^## .*\n\n/, ""));
    else if (isPre(tag)) console.log(sectionFor(tag, tag, tagDate(tag)).replace(/^## .*\n\n/, ""));
    else {
      console.error(`CHANGELOG.md has no section for ${tag}: bun scripts/stamp.ts ${tag} writes it`);
      process.exit(1);
    }
  } else if (values.all) {
    const tags = git("tag", "--list", "v*")
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
      .sort(compareVersions);
    let text = HEADER;
    for (const t of tags) text = upsert(text, t, sectionFor(t, t, tagDate(t)));
    if (values.write) writeFileSync(FILE, text);
    else process.stdout.write(text);
  } else {
    const sec = sectionFor(VERSION, "HEAD", new Date().toISOString().slice(0, 10));
    if (values.write && git("tag", "--list", `v${VERSION}`).trim()) {
      console.error(`v${VERSION} is already released. Bump src/version.ts (and both package.json files) first, then run this again.`);
      process.exit(1);
    }
    if (values.write) {
      writeFileSync(FILE, upsert(current, VERSION, sec));
      console.log(`CHANGELOG.md: ${VERSION}`);
    } else process.stdout.write(sec);
  }
}
