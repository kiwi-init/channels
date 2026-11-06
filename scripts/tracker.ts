export type Ci = "success" | "pending" | "failure" | "missing";

export interface Pr {
  number: number;
  title: string;
  author: string;
  draft: boolean;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  ci: Ci;
}

export interface Issue {
  number: number;
  title: string;
  author: string;
  labels: string[];
  comments: number;
  thumbsUp: number;
  reactions: number;
  createdAt: string;
  updatedAt: string;
}

export interface Section<T> {
  title: string;
  items: T[];
}

export interface Api {
  rest(method: string, path: string, body?: unknown): Promise<unknown>;
  graphql(query: string, variables: Record<string, string>): Promise<unknown>;
}

export const TRACKER = 1824;
export const CHECK = "ci-ok";
export const CAP = 25;
export const STALE_DAYS = 14;

const DAY = 86_400_000;
const PAGES = 20;
const BLAST = ["blast:low", "blast:medium", "blast:high", "blast:critical"];
const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const WAITING = new Set(["PENDING", "EXPECTED"]);

const READY = "Ready to merge";
const CAREFUL = "Needs a careful look";
const CI_WAIT = "Waiting on CI";
const CI_RED = "Red CI";
const QUARANTINED = "Quarantined";
const DRAFTS = "Drafts";

function record(x: unknown): Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : {};
}

function text(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function list(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

export function ciOf(contexts: unknown[]): Ci {
  const at = (c: Record<string, unknown>): string => text(c.startedAt) || text(c.createdAt) || "9999";
  const latest = contexts
    .map(record)
    .filter((c) => (text(c.name) || text(c.context)) === CHECK)
    .reduce<Record<string, unknown> | null>((best, c) => (best && at(best) > at(c) ? best : c), null);
  if (!latest) return "missing";
  if (text(latest.name) && text(latest.status) !== "COMPLETED") return "pending";
  const outcome = text(latest.conclusion) || text(latest.state);
  return PASSED.has(outcome) ? "success" : WAITING.has(outcome) ? "pending" : "failure";
}

function blast(pr: Pr): number {
  for (let i = BLAST.length - 1; i >= 0; i--) if (pr.labels.includes(BLAST[i] ?? "")) return i;
  return -1;
}

const careful = (pr: Pr): boolean => blast(pr) >= 2;

const byUpdate = (a: Pr, b: Pr): number => a.updatedAt.localeCompare(b.updatedAt) || a.number - b.number;

const lowestBlast = (pr: Pr): number => (blast(pr) < 0 ? BLAST.length : blast(pr));

export function home(pr: Pr): string {
  if (pr.labels.includes("quarantine")) return QUARANTINED;
  if (pr.draft) return DRAFTS;
  if (pr.ci === "success") return READY;
  return pr.ci === "failure" ? CI_RED : CI_WAIT;
}

export function place(prs: Pr[]): Section<Pr>[] {
  const of = (title: string): Pr[] => prs.filter((pr) => home(pr) === title).sort(byUpdate);
  return [
    { title: READY, items: of(READY).sort((a, b) => lowestBlast(a) - lowestBlast(b) || byUpdate(a, b)) },
    { title: CAREFUL, items: prs.filter(careful).sort(byUpdate) },
    { title: CI_WAIT, items: of(CI_WAIT) },
    { title: CI_RED, items: of(CI_RED) },
    { title: QUARANTINED, items: of(QUARANTINED) },
    { title: DRAFTS, items: of(DRAFTS) },
  ];
}

export function score(issue: Issue): number {
  return 3 * issue.thumbsUp + (issue.reactions - issue.thumbsUp) + issue.comments + (issue.labels.includes("bug") ? 5 : 0);
}

export function rankIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => score(b) - score(a) || b.createdAt.localeCompare(a.createdAt) || b.number - a.number);
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.round((Date.parse(day(now)) - Date.parse(iso.slice(0, 10))) / DAY) || 0);
}

export function plain(title: string): string {
  return title
    .trim()
    .replace(/[\\`*_[\]<>~&|]/g, "\\$&")
    .replace(/(^|\W)@([\w-]+)/g, "$1`@$2`");
}

interface Head {
  number: number;
  title: string;
  author: string;
  updatedAt: string;
}

function item(head: Head, tags: string[], now: Date, fresh: boolean): string {
  const days = daysSince(head.updatedAt, now);
  const parts = [`#${head.number} ${plain(head.title)}`, `\`@${head.author}\``, days === 0 ? "today" : `${days}d`, tags.join(" ")];
  if (days >= STALE_DAYS) parts.push("stale");
  if (fresh) parts.push("new");
  return `- ${parts.filter(Boolean).join(" · ")}`;
}

const prTags = (pr: Pr): string[] => [...pr.labels.filter((l) => l.startsWith("size:")), ...pr.labels.filter((l) => l.startsWith("blast:"))];

const isNew = (issue: Issue, now: Date): boolean => now.getTime() - Date.parse(issue.createdAt) < DAY;

const capped = (lines: string[]): string[] => (lines.length > CAP ? [...lines.slice(0, CAP), `- and ${lines.length - CAP} more`] : lines);

const count = (n: number, what: string): string => `${n} ${what}${n === 1 ? "" : "s"}`;

export function render(prs: Pr[], issues: Issue[], now: Date): string {
  const sections: Section<string>[] = [
    ...place(prs).map((s) => ({ title: s.title, items: s.items.map((pr) => item(pr, prTags(pr), now, false)) })),
    { title: "Issues", items: rankIssues(issues).map((i) => item(i, i.labels.includes("bug") ? ["bug"] : [], now, isNew(i, now))) },
  ];
  const head = `Updated ${day(now)} by kiwi-bus · ${count(prs.length, "open PR")} · ${count(issues.length, "open issue")}`;
  return [head, ...sections.filter((s) => s.items.length > 0).flatMap((s) => ["", `### ${s.title}`, ...capped(s.items)])].join("\n");
}

const PRS = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title isDraft createdAt updatedAt
        author { login }
        labels(first: 50) { nodes { name } }
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
          ... on CheckRun { name status conclusion startedAt }
          ... on StatusContext { context state createdAt }
        } } } } } }
      }
    }
  }
}`;

function readPr(raw: unknown): Pr {
  const n = record(raw);
  const commit = record(record(list(record(n.commits).nodes)[0]).commit);
  return {
    number: num(n.number),
    title: text(n.title),
    author: text(record(n.author).login) || "ghost",
    draft: n.isDraft === true,
    labels: list(record(n.labels).nodes).map((l) => text(record(l).name)),
    createdAt: text(n.createdAt),
    updatedAt: text(n.updatedAt),
    ci: ciOf(list(record(record(commit.statusCheckRollup).contexts).nodes)),
  };
}

export async function loadPrs(api: Api, repo: string): Promise<Pr[]> {
  const [owner = "", name = ""] = repo.split("/");
  const prs: Pr[] = [];
  let after = "";
  for (let page = 0; page < PAGES; page++) {
    const data = record(await api.graphql(PRS, after ? { owner, name, after } : { owner, name }));
    const conn = record(record(data.repository).pullRequests);
    if (!Array.isArray(conn.nodes)) throw new Error(`no pull requests for ${repo} in the GraphQL answer`);
    prs.push(...conn.nodes.map(readPr));
    const info = record(conn.pageInfo);
    after = text(info.endCursor);
    if (info.hasNextPage !== true || !after) break;
  }
  return prs;
}

function readIssue(i: Record<string, unknown>): Issue {
  const reactions = record(i.reactions);
  return {
    number: num(i.number),
    title: text(i.title),
    author: text(record(i.user).login) || "ghost",
    labels: list(i.labels).map((l) => text(record(l).name)),
    comments: num(i.comments),
    thumbsUp: num(reactions["+1"]),
    reactions: num(reactions.total_count),
    createdAt: text(i.created_at),
    updatedAt: text(i.updated_at),
  };
}

export async function loadIssues(api: Api): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const batch = await api.rest("GET", `/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("GET /issues did not answer with a list");
    for (const raw of batch) {
      const i = record(raw);
      if (!i.pull_request && num(i.number) !== TRACKER) issues.push(readIssue(i));
    }
    if (batch.length < 100) break;
  }
  return issues;
}

const same = (a: string, b: string): boolean => a.replace(/\r\n/g, "\n").trimEnd() === b.replace(/\r\n/g, "\n").trimEnd();

export async function publish(api: Api, body: string): Promise<boolean> {
  const issue = record(await api.rest("GET", `/issues/${TRACKER}`));
  if (num(issue.number) !== TRACKER) throw new Error(`#${TRACKER} is not in this repository`);
  if (same(text(issue.body), body)) return false;
  await api.rest("PATCH", `/issues/${TRACKER}`, { body });
  return true;
}

function github(repo: string, read: string, write: string, dryRun: boolean): Api {
  const root = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const call = async (method: string, url: string, token: string, body?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    rest: async (method, path, body) => {
      if (method === "GET") return call(method, `${root}/repos/${repo}${path}`, read);
      if (dryRun) {
        console.log(`would ${method} ${path}`);
        return null;
      }
      return call(method, `${root}/repos/${repo}${path}`, write, body);
    },
    graphql: async (query, variables) => {
      const out = record(await call("POST", `${root}/graphql`, read, { query, variables }));
      if (list(out.errors).length > 0) throw new Error(`graphql: ${JSON.stringify(out.errors)}`);
      return out.data;
    },
  };
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const repo = process.env.GITHUB_REPOSITORY ?? "kiwi-init/channels";
  const write = process.env.GH_TOKEN ?? "";
  const api = github(repo, process.env.GITHUB_TOKEN || write, write, dryRun);
  const body = render(await loadPrs(api, repo), await loadIssues(api), new Date());
  console.log(body);
  const changed = await publish(api, body);
  console.log(changed ? `#${TRACKER} ${dryRun ? "would change" : "updated"}` : `#${TRACKER} already says this`);
}
