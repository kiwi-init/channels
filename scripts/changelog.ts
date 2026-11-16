// The changelog writes itself from main's history. Every PR is squash-merged into one commit whose
// subject is the PR's title (… (#N)), so a release's entries are the commits since the last release,
// grouped by kind from the PR's labels (or the labels of the issues it closes or names). Version bumps
// ("kiwi 0.11.0 (#98)") are left out. A section's hand-written ### Highlights and ### Upgrade blocks
// are kept when it is written again.
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
const SLUG = "kiwi-init/channels";
const REPO = `https://github.com/${SLUG}`;
const HEADER = `# Changelog\n\nWritten by \`bun scripts/changelog.ts\` from each squash-merged pull request's title, grouped by its kind label.\n`;

export type Entry = { title: string; pr: number | null };
export type Commit = Entry & { sha: string };

export const KINDS = ["features", "fixes", "performance", "docs", "tests", "other"] as const;
export type Kind = (typeof KINDS)[number];

const HEADINGS: Record<Kind, string> = { features: "Features", fixes: "Fixes", performance: "Performance", docs: "Docs", tests: "Tests and CI", other: "Other changes" };
const LABELS: Record<string, Exclude<Kind, "other">> = { enhancement: "features", bug: "fixes", performance: "performance", documentation: "docs", tests: "tests" };
const HAND = ["Highlights", "Upgrade"] as const;

export interface Lookup {
  labels(n: number): readonly string[] | null;
  closes(pr: number): readonly number[] | null;
}

export type Head = { tag: string; sha: string; date: string };

/** A version-bump commit: "kiwi 0.11.0", "kiwi 0.11.0-rc.8 (#97)". Not a change of its own. */
export const isBump = (subject: string) => /^kiwi v?\d+\.\d+\.\d+(?:-[\w.]+)?(?: \(#\d+\))?$/.test(subject.trim());

const isPre = (version: string) => version.replace(/^v/, "").includes("-");
const bare = (version: string) => version.replace(/^v/, "");

export function entryOf(subject: string): Entry {
  const m = /^(.*?)\s*\(#(\d+)\)$/.exec(subject.trim());
  return { title: m ? m[1]! : subject.trim(), pr: m ? Number(m[2]) : null };
}

export const namedIssues = (title: string): number[] => [...(/\(([^()]*)\)\s*$/.exec(title)?.[1] ?? "").matchAll(/#(\d+)/g)].map((n) => Number(n[1]));

const kindIn = (labels: readonly string[]): Kind | null => KINDS.find((k) => labels.some((l) => LABELS[l] === k)) ?? null;

export function kindOf(entry: Entry, look: Lookup): { kind: Kind; failed: number[] } {
  const failed: number[] = [];
  if (entry.pr !== null) {
    const own = look.labels(entry.pr);
    if (own === null) return { kind: "other", failed: [entry.pr] };
    const kind = kindIn(own);
    if (kind) return { kind, failed };
  }
  const closes = entry.pr === null ? [] : look.closes(entry.pr);
  if (closes === null && entry.pr !== null) failed.push(entry.pr);
  const issues = [...new Set([...(closes ?? []), ...namedIssues(entry.title)])].filter((n) => n !== entry.pr);
  const labels: string[] = [];
  for (const n of issues) {
    const got = look.labels(n);
    if (got === null) failed.push(n);
    else labels.push(...got);
  }
  return { kind: kindIn(labels) ?? "other", failed };
}

export function line(c: Commit): string {
  const [, area = "", rest = ""] = /^([^:]{1,40}): (.+)$/.exec(c.title) ?? [];
  const text = area && area.trim().split(/\s+/).length <= 3 ? `**${area}:** ${rest}` : c.title;
  const pr = c.pr ? ` ([#${c.pr}](${REPO}/pull/${c.pr}))` : "";
  const sha = c.sha ? ` ([${c.sha.slice(0, 7)}](${REPO}/commit/${c.sha}))` : "";
  return `- ${text}${pr}${sha}`;
}

const headLine = (h: Head) => `Tag [${h.tag}](${REPO}/releases/tag/${h.tag}) · commit [${h.sha.slice(0, 7)}](${REPO}/commit/${h.sha}) · ${h.date}`;

/** The changelog section for one release. */
export function section(version: string, head: Head, commits: readonly (Commit & { kind: Kind })[]): string {
  const groups = KINDS.map((k) => ({ k, items: commits.filter((c) => c.kind === k) }))
    .filter((g) => g.items.length)
    .map((g) => `### ${HEADINGS[g.k]}\n\n${g.items.map(line).join("\n")}\n`);
  return `## ${bare(version)} — ${head.date}\n\n${headLine(head)}\n\n${groups.join("\n") || "- No changes.\n"}`;
}

export function handOf(sec: string | null): string {
  if (!sec) return "";
  const blocks = sec.split(/(?=^### )/m).filter((b) => HAND.some((h) => b.startsWith(`### ${h}\n`)));
  return HAND.map((h) => blocks.find((b) => b.startsWith(`### ${h}\n`)))
    .filter((b): b is string => b !== undefined)
    .map((b) => b.trimEnd() + "\n")
    .join("\n");
}

export function carryHand(old: string | null, sec: string): string {
  const hand = handOf(old);
  if (!hand || handOf(sec)) return sec;
  const lines = sec.split("\n");
  const at = lines.findIndex((l, i) => i > 0 && (l.startsWith("### ") || l.startsWith("- ")));
  if (at < 0) return `${sec.trimEnd()}\n\n${hand}`;
  return `${[...lines.slice(0, at), ...hand.trimEnd().split("\n"), "", ...lines.slice(at)].join("\n")}`;
}

/** Puts a section into the changelog's text: in place of the same version's, else above the newest. */
export function upsert(text: string, version: string, sec: string): string {
  const body = text.startsWith("# ") ? text.slice(text.indexOf("\n## ") + 1 || text.length) : text;
  const sections = body.split(/(?=^## )/m).filter((s) => s.startsWith("## "));
  const v = bare(version);
  const at = sections.findIndex((s) => s.startsWith(`## ${v} `) || s.startsWith(`## ${v}\n`));
  const old = sections[at];
  if (old !== undefined) sections[at] = carryHand(old, sec);
  else sections.unshift(sec);
  return `${HEADER}\n${sections.map((s) => s.trimEnd() + "\n").join("\n")}`;
}

/** The section for one version as CHANGELOG.md has it, or null. */
export function sectionIn(text: string, version: string): string | null {
  const v = bare(version);
  const sec = text.split(/(?=^## )/m).find((s) => s.startsWith(`## ${v} `) || s.startsWith(`## ${v}\n`));
  return sec ? sec.trimEnd() + "\n" : null;
}

export function release(version: string, head: Head, commits: readonly Commit[], look: Lookup, told: (n: Commit, failed: number[]) => void): string {
  const kinded = commits
    .filter((c) => !isBump(c.pr ? `${c.title} (#${c.pr})` : c.title))
    .map((c) => {
      const { kind, failed } = kindOf(c, look);
      if (failed.length) told(c, failed);
      return { ...c, kind };
    });
  return section(version, head, kinded);
}

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

function commits(range: string): Commit[] {
  return git("log", "--first-parent", "--reverse", "--format=%H%x09%s", range)
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const tab = l.indexOf("\t");
      return { sha: l.slice(0, tab), ...entryOf(l.slice(tab + 1)) };
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

export type Gh = { kind: "ok"; out: string } | { kind: "missing" } | { kind: "failed" };
export type GhRun = (args: readonly string[]) => Gh;

const runGh: GhRun = (args) => {
  const r = Bun.spawnSync(["gh", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: process.env });
  if (r.exitCode === 0) return { kind: "ok", out: r.stdout.toString() };
  return /\(HTTP 404\)|Could not resolve to a/.test(r.stderr.toString()) ? { kind: "missing" } : { kind: "failed" };
};

const BULK = 60;

function parsed(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    // gh printed something other than the JSON its --jq asks for: the lookup failed
    return null;
  }
}

const strings = (x: unknown): string[] | null => (Array.isArray(x) && x.every((v) => typeof v === "string") ? x : null);
const numbers = (x: unknown): number[] | null => (Array.isArray(x) && x.every((v) => Number.isSafeInteger(v)) ? x : null);

export function ghLookup(gh: GhRun = runGh): Lookup & { warm(prs: readonly number[]): void } {
  const labels = new Map<number, readonly string[] | null>();
  const closes = new Map<number, readonly number[] | null>();
  let everyIssue = false;
  const pairs = (text: string | null): [number, unknown][] =>
    (text ?? "")
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((l) => {
        const row = parsed(l);
        return Array.isArray(row) && row.length === 2 && Number.isSafeInteger(row[0]) ? [[Number(row[0]), row[1]] satisfies [number, unknown]] : [];
      });
  return {
    warm(prs) {
      if (prs.filter((n) => !closes.has(n)).length < BULK) return;
      const issues = gh(["api", "--paginate", `repos/${SLUG}/issues?state=all&per_page=100`, "--jq", ".[] | [.number, [.labels[].name]]"]);
      if (issues.kind === "ok") for (const [n, l] of pairs(issues.out)) labels.set(n, strings(l));
      everyIssue = issues.kind === "ok";
      const merged = gh([
        "pr",
        "list",
        "--repo",
        SLUG,
        "--state",
        "merged",
        "--limit",
        "100000",
        "--json",
        "number,closingIssuesReferences",
        "--jq",
        ".[] | [.number, [.closingIssuesReferences[].number]]",
      ]);
      if (merged.kind === "ok") for (const [n, c] of pairs(merged.out)) closes.set(n, numbers(c));
    },
    labels(n) {
      if (!labels.has(n)) {
        const got = everyIssue ? ({ kind: "missing" } satisfies Gh) : gh(["api", `repos/${SLUG}/issues/${n}`, "--jq", "[.labels[].name]"]);
        labels.set(n, got.kind === "missing" ? [] : got.kind === "ok" ? strings(parsed(got.out)) : null);
      }
      return labels.get(n) ?? null;
    },
    closes(pr) {
      if (!closes.has(pr)) {
        const got = gh(["pr", "view", String(pr), "--repo", SLUG, "--json", "closingIssuesReferences", "--jq", "[.closingIssuesReferences[].number]"]);
        closes.set(pr, got.kind === "missing" ? [] : got.kind === "ok" ? numbers(parsed(got.out)) : null);
      }
      return closes.get(pr) ?? null;
    },
  };
}

const tellFailed = (c: Commit, failed: number[]) =>
  console.error(`changelog: couldn't read the labels of ${failed.map((n) => `#${n}`).join(", ")} for "${c.title}"${c.pr ? ` (#${c.pr})` : ""}: it goes under Other changes`);

export function sectionFor(version: string, ref: string, date: string, look: Lookup = ghLookup()): string {
  const prev = previousTag(version, ref);
  const list = commits(prev ? `${prev}..${ref}` : ref);
  const head: Head = { tag: `v${bare(version)}`, sha: git("rev-parse", `${ref}^{commit}`).trim(), date };
  return release(version, head, list, look, tellFailed);
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
    const look = ghLookup();
    look.warm(commits("HEAD").flatMap((c) => (c.pr ? [c.pr] : [])));
    let text = HEADER;
    for (const t of tags) text = upsert(text, t, carryHand(sectionIn(current, t), sectionFor(t, t, tagDate(t), look)));
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
