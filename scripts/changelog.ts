// The changelog writes itself from main's history. Every PR is squash-merged into one commit whose
// subject is the PR's title (… (#N)) and whose body is its description, so a release's entries are
// the commits since the last release: the title, a link, and the description's first paragraph.
// Version bumps ("kiwi 0.11.0 (#98)") and trailers (Co-authored-by) are left out.
//
// A description is required: CI fails a pull request whose commits have none (--check), and the
// release workflow fails a tag whose version has no section in CHANGELOG.md (--notes).
//
//   bun scripts/changelog.ts                  print the section for src/version.ts's version, from the last release to HEAD
//   bun scripts/changelog.ts --write          put that section into CHANGELOG.md (replacing one for the same version)
//   bun scripts/changelog.ts --all --write    rebuild CHANGELOG.md from every release tag
//   bun scripts/changelog.ts --check A..B     fail unless some commit in A..B has a description
//   bun scripts/changelog.ts --notes vX.Y.Z   the release notes for a tag: its CHANGELOG.md section
//                                             (a pre-release with none gets one made from its commits)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareVersions } from "../desktop/src/cli.ts";

const ROOT = resolve(import.meta.dir, "..");
const FILE = resolve(ROOT, "CHANGELOG.md");
const REPO = "https://github.com/ojowwalker77/channels";
const HEADER = `# Changelog\n\nWritten by \`bun scripts/changelog.ts\` from each squash-merged pull request's title and description.\n`;

export type Entry = { title: string; pr: number | null; description: string };

/** A version-bump commit: "kiwi 0.11.0", "kiwi 0.11.0-rc.8 (#97)". Not a change of its own. */
export const isBump = (subject: string) => /^kiwi v?\d+\.\d+\.\d+(?:-[\w.]+)?(?: \(#\d+\))?$/.test(subject.trim());

const isPre = (version: string) => version.replace(/^v/, "").includes("-");

/**
 * One commit as an entry. The description is the body's first paragraph, unwrapped, after dropping
 * trailers and GitHub's "---------" line. A squash of several commits lists them as "* subject" with
 * each body under it: the first commit's body is the description then.
 */
export function entryOf(subject: string, body: string): Entry {
  const m = /^(.*?)\s*\(#(\d+)\)$/.exec(subject.trim());
  const title = m ? m[1]! : subject.trim();
  const lines = body
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !/^(co-authored-by|signed-off-by|reviewed-by|change-id):/i.test(l.trim()) && !/^-{3,}$/.test(l.trim()));
  let paragraphs = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // "* First commit's subject" then its body: skip the subject line, keep the body.
  if (paragraphs[0]?.startsWith("* ")) paragraphs = paragraphs.slice(1).filter((p) => !p.startsWith("* "));
  const first = paragraphs[0] ?? "";
  const list = first.split("\n").every((l) => /^\s*[-*] |^\s{2,}\S/.test(l));
  const description = list ? first.split("\n").map((l) => l.replace(/^\s*\* /, "- ").trimEnd()).join("\n") : first.replace(/\s*\n\s*/g, " ");
  return { title, pr: m ? Number(m[2]) : null, description };
}

/** The changelog section for one release. */
export function section(version: string, date: string, entries: Entry[]): string {
  const items = entries.map((e) => {
    const head = `- **${e.title}**${e.pr ? ` ([#${e.pr}](${REPO}/pull/${e.pr}))` : ""}`;
    if (!e.description) return head;
    return `${head}\n${e.description.split("\n").map((l) => `  ${l}`).join("\n")}`;
  });
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

/**
 * Commits in a range, oldest first. On main, first-parent: the squash merges, not the commits inside
 * a PR. In a PR (firstParent false): its own commits, without the merge commit CI checks out.
 */
function commits(range: string, firstParent = true): { subject: string; body: string }[] {
  const out = git("log", firstParent ? "--first-parent" : "--no-merges", "--reverse", "--format=%s%x1f%b%x1e", range);
  return out
    .split("\x1e")
    .map((c) => c.replace(/^\n/, ""))
    .filter((c) => c.includes("\x1f"))
    .map((c) => {
      const [subject = "", body = ""] = c.split("\x1f");
      return { subject, body };
    });
}

/** The release before this version among tags reachable from `ref`: the last real one, or for a pre-release, the last of any kind. */
function previousTag(version: string, ref: string): string | null {
  const tags = git("tag", "--merged", ref, "--list", "v*")
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+/.test(t) && compareVersions(t, version) < 0 && (isPre(version) || !isPre(t)));
  return tags.sort(compareVersions).pop() ?? null;
}

function sectionFor(version: string, ref: string, date: string): string {
  const prev = previousTag(version, ref);
  const entries = commits(prev ? `${prev}..${ref}` : ref)
    .filter((c) => !isBump(c.subject))
    .map((c) => entryOf(c.subject, c.body));
  return section(version, date, entries);
}

const tagDate = (ref: string) => git("log", "-1", "--format=%cs", ref).trim();

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { write: { type: "boolean" }, all: { type: "boolean" }, check: { type: "string" }, notes: { type: "string" } },
  });
  const { VERSION } = await import("../src/version.ts");
  const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : HEADER;

  if (values.check) {
    const missing = commits(values.check, false).filter((c) => !isBump(c.subject) && !entryOf(c.subject, c.body).description);
    const all = commits(values.check, false).filter((c) => !isBump(c.subject));
    if (all.length && missing.length === all.length) {
      console.error(
        `No commit in ${values.check} has a description, and the squash-merged commit's description is what the changelog prints.\n` +
          `Add one: a blank line after the subject, then a paragraph saying what changed and why (git commit --amend, or a new commit).\n` +
          missing.map((c) => `  ${c.subject}`).join("\n"),
      );
      process.exit(1);
    }
    console.log(`changelog: ok (${all.length - missing.length} of ${all.length} commits described)`);
  } else if (values.notes) {
    const tag = values.notes;
    const sec = sectionIn(current, tag);
    if (sec) console.log(sec.replace(/^## .*\n\n/, ""));
    else if (isPre(tag)) console.log(sectionFor(tag, tag, tagDate(tag)).replace(/^## .*\n\n/, ""));
    else {
      console.error(`CHANGELOG.md has no section for ${tag}. In the release PR, run: bun scripts/changelog.ts --write`);
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
