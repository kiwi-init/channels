import { githubClient, record, text, list } from "./github.ts";
import { Glob } from "bun";
import { execFileSync } from "node:child_process";

export interface Size {
  name: string;
  color: string;
  description: string;
  below: number;
}

export interface FileChange {
  path: string;
  lines: number;
}

export interface Measure {
  code: number;
  tests: number;
  lines: number;
  label: string;
}

export type Api = (method: string, path: string, body?: unknown) => Promise<unknown>;

const NOTE = "effective changed lines (test files excluded in mixed PRs).";

export const SIZES: Size[] = [
  { name: "size:XS", color: "0e8a16", description: `0-9 ${NOTE}`, below: 10 },
  { name: "size:S", color: "5ebd3e", description: `10-29 ${NOTE}`, below: 30 },
  { name: "size:M", color: "fbca04", description: `30-99 ${NOTE}`, below: 100 },
  { name: "size:L", color: "fe7d37", description: `100-499 ${NOTE}`, below: 500 },
  { name: "size:XL", color: "d93f0b", description: `500-999 ${NOTE}`, below: 1000 },
  { name: "size:XXL", color: "b60205", description: `1,000+ ${NOTE}`, below: Number.POSITIVE_INFINITY },
];

const TESTS = [
  "test/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "desktop/eb-tests/**",
  "ios/*Tests/**",
  "android/**/src/test/**",
  "android/**/src/androidTest/**",
  "scripts/ui-scroll-fps.ts",
  "scripts/ui-stash-click.ts",
].map((p) => new Glob(p));

export function isTest(path: string): boolean {
  return TESTS.some((g) => g.match(path));
}

export function sizeOf(lines: number): string {
  for (const s of SIZES) if (lines < s.below) return s.name;
  return "size:XXL";
}

function count(raw: string): number {
  return raw === "-" ? 0 : Number.parseInt(raw, 10) || 0;
}

export function parseNumstat(z: string): FileChange[] {
  const parts = z.split("\0");
  const files: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? "";
    const a = entry.indexOf("\t");
    const d = entry.indexOf("\t", a + 1);
    if (a < 0 || d < 0) continue;
    const lines = count(entry.slice(0, a)) + count(entry.slice(a + 1, d));
    let path = entry.slice(d + 1);
    if (path === "") {
      path = parts[i + 2] ?? "";
      i += 2;
    }
    files.push({ path, lines });
  }
  return files;
}

export function measure(files: FileChange[]): Measure {
  const total = files.reduce((n, f) => n + f.lines, 0);
  const tests = files.filter((f) => isTest(f.path)).reduce((n, f) => n + f.lines, 0);
  const code = total - tests;
  const lines = code === 0 ? tests : code;
  return { code, tests, lines, label: sizeOf(lines) };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function fetched(cwd: string, ref: string): string {
  git(cwd, ["fetch", "--quiet", "--no-tags", "origin", ref]);
  return git(cwd, ["rev-parse", "FETCH_HEAD"]).trim();
}

export function diffFiles(cwd: string, base: string, head: string): FileChange[] {
  const args = ["diff", "--numstat", "-z", "-M", "--no-ext-diff", "--no-textconv", "--ignore-all-space", "--ignore-blank-lines", `${base}...${head}`];
  return parseNumstat(git(cwd, args));
}

const enc = (name: string): string => encodeURIComponent(name);

export async function syncLabels(api: Api): Promise<void> {
  for (const s of SIZES) {
    const have = record(await api("GET", `/labels/${enc(s.name)}`));
    const want = { color: s.color, description: s.description };
    if (!have.name) await api("POST", "/labels", { name: s.name, ...want });
    else if (have.color !== s.color || have.description !== s.description) await api("PATCH", `/labels/${enc(s.name)}`, want);
  }
}

export async function labelPr(api: Api, cwd: string, number: number): Promise<Measure> {
  const pr = record(await api("GET", `/pulls/${number}`));
  const baseRef = text(record(pr.base).ref);
  if (!baseRef) throw new Error(`#${number} is not a pull request in this repository`);
  const base = fetched(cwd, `refs/heads/${baseRef}`);
  const head = fetched(cwd, `refs/pull/${number}/head`);
  const m = measure(diffFiles(cwd, base, head));
  const labels = list(pr.labels).map((l) => text(record(l).name));
  const sizes = new Set(SIZES.map((s) => s.name));
  for (const name of labels) if (sizes.has(name) && name !== m.label) await api("DELETE", `/issues/${number}/labels/${enc(name)}`);
  if (!labels.includes(m.label)) await api("POST", `/issues/${number}/labels`, { labels: [m.label] });
  console.log(`#${number}: ${m.code} code lines, ${m.tests} test lines -> ${m.label}`);
  return m;
}

async function openPrs(api: Api): Promise<number[]> {
  const numbers: number[] = [];
  for (let page = 1; ; page++) {
    const batch = list(await api("GET", `/pulls?state=open&per_page=100&page=${page}`));
    for (const pr of batch) {
      const n = record(pr).number;
      if (typeof n === "number") numbers.push(n);
    }
    if (batch.length < 100) return numbers;
  }
}

export function github(repo: string, token: string, dryRun: boolean): Api {
  return githubClient(repo, {
    credentials: { kind: "single", token },
    dryRun,
    policy: { contentType: "body", dryRunBody: true, notFound: "null", errorPath: "route", graphql: "skip", getBody: "send" },
  }).rest;
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const repo = process.env.GITHUB_REPOSITORY ?? "kiwi-init/channels";
  const api = github(repo, process.env.GITHUB_TOKEN ?? "", dryRun);
  const pr = (process.env.PR ?? "").trim();
  if (pr && !/^\d+$/.test(pr)) throw new Error(`PR must be a pull request number, not ${JSON.stringify(pr)}`);
  await syncLabels(api);
  for (const n of pr ? [Number(pr)] : await openPrs(api)) await labelPr(api, process.cwd(), n);
}
