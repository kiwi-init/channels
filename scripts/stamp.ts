import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { sectionFor, sectionIn, upsert } from "./changelog.ts";

const ROOT = resolve(import.meta.dir, "..");
const VERSION_RE = String.raw`\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?`;

export const FILES = ["src/version.ts", "package.json", "desktop/package.json", "site/app.js", "site/README.md"] as const;
export type Stamped = (typeof FILES)[number];

export function versionOf(tag: string): string {
  const m = new RegExp(`^v(${VERSION_RE})$`).exec(tag.trim());
  if (!m?.[1]) throw new Error(`${tag} isn't a release tag: vX.Y.Z, or vX.Y.Z-rc.N for a pre-release`);
  return m[1];
}

export function nextPatch(version: string): string {
  const [core = "", pre] = version.split("-", 2);
  const [major = 0, minor = 0, patch = 0] = core.split(".").map(Number);
  return pre ? core : `${major}.${minor}.${patch + 1}`;
}

const NAMES = new RegExp(`Channels-${VERSION_RE}-`, "g");
const RELEASE = new RegExp(`\\bv${VERSION_RE} release\\b`, "g");

function replaced(file: Stamped, text: string, version: string): string {
  switch (file) {
    case "src/version.ts":
      return text.replace(/export const VERSION = "[^"]*";/, `export const VERSION = "${version}";`);
    case "package.json":
    case "desktop/package.json":
      return text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);
    case "site/app.js":
      return text.replace(NAMES, `Channels-${version}-`);
    case "site/README.md":
      return text.replace(NAMES, `Channels-${version}-`).replace(RELEASE, `v${version} release`);
  }
}

export function stampText(file: Stamped, text: string, version: string): string {
  const out = replaced(file, text, version);
  const mark = file === "src/version.ts" || file.endsWith("package.json") ? `"${version}"` : `Channels-${version}-`;
  if (!out.includes(mark)) throw new Error(`${file}: found no version to stamp; scripts/stamp.ts needs to learn its new shape`);
  return out;
}

export function stampChangelog(text: string, version: string, section: () => string): string {
  if (version.includes("-") || sectionIn(text, version)) return text;
  return upsert(text, version, section());
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { next: { type: "boolean" } } });
  if (values.next) {
    const { VERSION } = await import("../src/version.ts");
    console.log(`v${nextPatch(VERSION)}`);
    process.exit(0);
  }
  const tag = positionals[0];
  if (!tag) {
    console.error("usage: bun scripts/stamp.ts vX.Y.Z   (or --next: the tag after src/version.ts's version)");
    process.exit(2);
  }
  const version = versionOf(tag);
  for (const file of FILES) {
    const path = resolve(ROOT, file);
    writeFileSync(path, stampText(file, readFileSync(path, "utf8"), version));
  }
  const log = resolve(ROOT, "CHANGELOG.md");
  const text = existsSync(log) ? readFileSync(log, "utf8") : "";
  writeFileSync(
    log,
    stampChangelog(text, version, () => sectionFor(version, "HEAD", new Date().toISOString().slice(0, 10))),
  );
  console.log(`stamped ${version} into ${FILES.join(", ")} and CHANGELOG.md`);
}
