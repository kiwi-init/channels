import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CASK = "Casks/channels.rb";
export const FORMULA = "Formula/kiwi.rb";

export function releaseVersion(tag: string): string {
  const m = /^v(\d+(?:\.\d+)+)$/.exec(tag.trim());
  if (!m?.[1]) throw new Error(`${tag} isn't a release tag (v and a version, no pre-release suffix): the tap only follows releases`);
  return m[1];
}

export function sumsOf(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (m?.[1] && m[2]) sums.set(m[2], m[1]);
  }
  return sums;
}

function once(text: string, re: RegExp, what: string, file: string): RegExpExecArray {
  const all = [...text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))];
  const [match] = all;
  if (all.length !== 1 || !match) throw new Error(`${file} has ${all.length} ${what} lines, not one: it isn't the shape this bump edits`);
  return match;
}

function shaFor(sums: ReadonlyMap<string, string>, asset: string, file: string): string {
  const sha = sums.get(asset);
  if (!sha) throw new Error(`SHA256SUMS has no ${asset}, which ${file} downloads`);
  return sha;
}

const URL_LINE = /^(\s*url ")([^"]+)(")$/m;
const SHA_LINE = /^(\s*sha256 ")([0-9a-f]{64})(")$/m;

export function bumpCask(text: string, version: string, sums: ReadonlyMap<string, string>): string {
  const url = once(text, URL_LINE, "url", CASK)[2] ?? "";
  if (!url.includes("#{version}")) throw new Error(`${CASK}'s url doesn't name #{version}, so a new version wouldn't change what it downloads`);
  const asset = url.split("/").at(-1)?.replaceAll("#{version}", version) ?? "";
  const sha = shaFor(sums, asset, CASK);
  once(text, /^(\s*version ")([^"]+)(")$/m, "version", CASK);
  once(text, SHA_LINE, "sha256", CASK);
  return text.replace(/^(\s*version ")([^"]+)(")$/m, `$1${version}$3`).replace(SHA_LINE, `$1${sha}$3`);
}

export function bumpFormula(text: string, tag: string, sums: ReadonlyMap<string, string>): string {
  const url = once(text, URL_LINE, "url", FORMULA)[2] ?? "";
  const m = /^(.*\/releases\/download\/)([^/]+)(\/([^/]+))$/.exec(url);
  if (!m?.[1] || !m[3] || !m[4]) throw new Error(`${FORMULA}'s url isn't a release download: ${url}`);
  const sha = shaFor(sums, m[4], FORMULA);
  once(text, SHA_LINE, "sha256", FORMULA);
  return text.replace(URL_LINE, `$1${m[1]}${tag}${m[3]}$3`).replace(SHA_LINE, `$1${sha}$3`);
}

if (import.meta.main) {
  const [tag, sumsFile, tap] = Bun.argv.slice(2);
  if (!tag || !sumsFile || !tap) {
    console.error("usage: bun scripts/brew-bump.ts vYYYY.M.PATCH SHA256SUMS <homebrew-tap checkout>");
    process.exit(2);
  }
  const version = releaseVersion(tag);
  const sums = sumsOf(readFileSync(sumsFile, "utf8"));
  const cask = join(tap, CASK);
  const formula = join(tap, FORMULA);
  writeFileSync(cask, bumpCask(readFileSync(cask, "utf8"), version, sums));
  writeFileSync(formula, bumpFormula(readFileSync(formula, "utf8"), tag, sums));
  console.log(`${CASK} and ${FORMULA} now install ${version}`);
}
