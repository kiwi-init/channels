import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface FeedPromise {
  section: string;
  promise: string;
  check: string;
  words: string;
  line: number;
}

export interface Repo {
  read: (path: string) => string | null;
  ci: string;
}

const CHECK = /^`((?:scripts\/[\w.-]+\.ts|(?:test|ui\/src|packages)\/[\w./-]+\.test\.tsx?))`$/;
const WORDS = /^`(.+)`$/;

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replaceAll("\\|", "|"));

export function promisesIn(md: string): { promises: FeedPromise[]; problems: string[] } {
  const promises: FeedPromise[] = [];
  const problems: string[] = [];
  let section = "";
  let head = true;
  md.split("\n").forEach((text, at) => {
    const line = at + 1;
    const title = /^##\s+(.+)$/.exec(text);
    if (title) {
      section = title[1]?.trim() ?? "";
      head = true;
      return;
    }
    if (!text.trim().startsWith("|")) {
      head = true;
      return;
    }
    const row = cells(text);
    if (row.every((c) => /^:?-+:?$/.test(c))) return;
    if (head) {
      head = false;
      return;
    }
    const [promise = "", check = "", words = ""] = row;
    const path = CHECK.exec(check)?.[1];
    const said = WORDS.exec(words)?.[1];
    if (!promise) problems.push(`line ${line}: a row with no promise`);
    else if (!path) problems.push(`line ${line}: "${promise}" names no check (a script under scripts/ or a unit test, in backticks)`);
    else if (!said) problems.push(`line ${line}: "${promise}" doesn't quote the words its check says`);
    else promises.push({ section, promise, check: path, words: said, line });
  });
  return { promises, problems };
}

export function broken(promises: FeedPromise[], repo: Repo): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const p of promises) {
    const first = seen.get(p.promise);
    if (first !== undefined) problems.push(`line ${p.line}: "${p.promise}" is already on line ${first}`);
    else seen.set(p.promise, p.line);
    const source = repo.read(p.check);
    if (source === null) {
      problems.push(`line ${p.line}: "${p.promise}" names ${p.check}, which is not in the repo`);
      continue;
    }
    if (!source.includes(p.words)) problems.push(`line ${p.line}: ${p.check} no longer says "${p.words}", so nothing proves "${p.promise}"`);
    if (p.check.startsWith("scripts/") && !new RegExp(`\\bbun ${p.check.replaceAll(".", "\\.")}(?:\\s|$)`, "m").test(repo.ci))
      problems.push(`line ${p.line}: CI doesn't run ${p.check}, so "${p.promise}" can break unseen`);
  }
  if (promises.length === 0) problems.push("the list has no promises");
  return problems;
}

export const checksOf = (promises: FeedPromise[]): string[] => [...new Set(promises.map((p) => p.check))].toSorted();

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const list = join(root, "FEED.md");
  if (!existsSync(list)) {
    console.error("no FEED.md at the repo's root");
    process.exit(1);
  }
  const read = (path: string): string | null => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null);
  const { promises, problems } = promisesIn(readFileSync(list, "utf8"));
  if (process.argv.includes("--checks")) {
    console.log(checksOf(promises).join("\n"));
    process.exit(0);
  }
  const found = [...problems, ...broken(promises, { read, ci: read(".github/workflows/ci.yml") ?? "" })];
  const annotate = process.env.GITHUB_ACTIONS === "true";
  for (const what of found) {
    console.log(`FEED.md: ${what}`);
    const at = /^line (\d+): /.exec(what);
    if (annotate) console.log(`::error file=FEED.md${at ? `,line=${at[1]}` : ""}::${what.replace(/^line \d+: /, "")}`);
  }
  if (found.length) {
    console.error(`${found.length} of the feed's promises ${found.length === 1 ? "has" : "have"} no check behind ${found.length === 1 ? "it" : "them"}.`);
    process.exit(1);
  }
  console.log(`the feed's ${promises.length} promises each name a check CI runs (${checksOf(promises).length} checks).`);
}
