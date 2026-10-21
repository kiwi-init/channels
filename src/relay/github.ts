import { GITHUB_EVENTS, REPO_RE, type GithubNote } from "@kiwi/core/protocol.ts";
import { readText } from "./http.ts";
import { withCors } from "./mailbox.ts";

export const GITHUB_WEBHOOK_PATH = "/v1/github/webhook";
export const GITHUB_QUEUE_MAX = 500;
export const GITHUB_QUEUE_TTL_MS = 7 * 24 * 3_600_000;
const MAX_BODY = 1 << 20;

export type GithubItem = GithubNote;

export interface GithubRoutes {
  rooms(repo: string): Promise<string[]>;
  enqueue(room: string, item: GithubItem): Promise<boolean>;
  drop(repo: string, room: string): Promise<void>;
}

export interface GithubLink {
  repo: string;
  room: string;
  on: boolean;
}

const repoKey = (repo: string): string => repo.toLowerCase();

export function githubRepos(x: unknown): string[] | null {
  if (!Array.isArray(x) || x.length > 20) return null;
  const out = new Set<string>();
  for (const r of x) {
    if (typeof r !== "string" || !REPO_RE.test(r)) return null;
    out.add(repoKey(r));
  }
  return [...out];
}

export function githubLinks(room: string, before: readonly string[], after: readonly string[]): GithubLink[] {
  const was = new Set(before);
  const now = new Set(after);
  return [...[...now].filter((r) => !was.has(r)).map((repo) => ({ repo, room, on: true })), ...[...was].filter((r) => !now.has(r)).map((repo) => ({ repo, room, on: false }))];
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function signatureOk(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const got = header.slice(7).toLowerCase();
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const str = (x: unknown, max = 200): string | undefined => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined);
const int = (x: unknown): number | undefined => (typeof x === "number" && Number.isSafeInteger(x) && x > 0 ? x : undefined);
const count = (x: unknown): number | undefined => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : undefined);
const defined = (o: GithubItem): GithubItem => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as GithubItem;

export function githubItem(event: string, payload: unknown, now: number): GithubItem | null {
  const p = obj(payload);
  const repo = str(obj(p.repository).full_name);
  if (!repo || !REPO_RE.test(repo) || !(GITHUB_EVENTS as readonly string[]).includes(event)) return null;
  const by = str(obj(p.sender).login, 100);
  const base = { repo, at: now, ...(by ? { by } : {}) };
  if (event === "pull_request") {
    const pr = obj(p.pull_request);
    return defined({
      ...base,
      event: "pull_request",
      action: str(p.action, 40),
      number: int(pr.number),
      title: str(pr.title),
      url: str(pr.html_url, 300),
      state: str(pr.state, 20),
      merged: typeof pr.merged === "boolean" ? pr.merged : undefined,
      additions: count(pr.additions),
      deletions: count(pr.deletions),
      files: count(pr.changed_files),
      branch: str(obj(pr.head).ref),
      sha: str(obj(pr.head).sha, 40),
    });
  }
  if (event === "issues") {
    const issue = obj(p.issue);
    if (!int(issue.number)) return null;
    return defined({
      ...base,
      event: "issues",
      action: str(p.action, 40),
      number: int(issue.number),
      title: str(issue.title),
      url: str(issue.html_url, 300),
      state: str(issue.state, 20),
      reason: str(issue.state_reason, 20),
    });
  }
  if (event === "check_run") {
    const run = obj(p.check_run);
    return defined({
      ...base,
      event: "check_run",
      action: str(p.action, 40),
      run: int(run.id),
      name: str(run.name),
      url: str(run.html_url, 300),
      status: str(run.status, 20),
      conclusion: str(run.conclusion, 20),
      sha: str(run.head_sha, 40),
      branch: str(obj(run.check_suite).head_branch),
    });
  }
  if (event === "workflow_run") {
    const run = obj(p.workflow_run);
    return defined({
      ...base,
      event: "workflow_run",
      action: str(p.action, 40),
      run: int(run.id),
      attempt: int(run.run_attempt),
      name: str(run.name),
      url: str(run.html_url, 300),
      status: str(run.status, 20),
      conclusion: str(run.conclusion, 20),
      sha: str(run.head_sha, 40),
      branch: str(run.head_branch),
    });
  }
  const ref = str(p.ref);
  return defined({ ...base, event: "push", branch: ref?.startsWith("refs/heads/") ? ref.slice(11) : ref, sha: str(p.after, 40), url: str(p.compare, 300) });
}

const reply = (status: number, data: object) => withCors(Response.json(data, { status }));

export async function onGithubHttp(req: Request, secret: string | null | undefined, routes: GithubRoutes, now: () => number = Date.now): Promise<Response | null> {
  if (new URL(req.url).pathname !== GITHUB_WEBHOOK_PATH) return null;
  if (!secret) return reply(404, { error: "GitHub isn't set up on this relay", tag: "NotFound" });
  if (req.method !== "POST") return reply(405, { error: "POST only", tag: "BadRequest" });
  const body = await readText(req.body, MAX_BODY, req.headers.get("content-length"));
  if (body === null) return reply(413, { error: "payload too large", tag: "TooLarge" });
  if (!(await signatureOk(secret, body, req.headers.get("x-hub-signature-256")))) return reply(401, { error: "bad signature", tag: "Unauthorized" });
  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return reply(200, { ok: true });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return reply(400, { error: "not JSON", tag: "BadRequest" });
  }
  const item = githubItem(event, payload, now());
  if (!item) return reply(202, { ignored: event });
  const rooms = await routes.rooms(repoKey(item.repo));
  let queued = 0;
  for (const room of rooms) {
    if (await routes.enqueue(room, item)) queued++;
    else await routes.drop(repoKey(item.repo), room);
  }
  return reply(202, { queued });
}
