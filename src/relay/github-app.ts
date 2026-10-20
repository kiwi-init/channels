import * as Context from "effect/Context";

export const REVIEW_CHECK = "kiwi/review";
const MAX_DIFF = 2 << 20;

const MAX_ISSUE_BODY = 8000;
const MAX_EXCERPT = 3000;
const EXCERPT_LINES = 25;
const MAX_ANNOTATIONS = 10;

interface CheckLog {
  excerpt: string;
  url: string | null;
  from: "log" | "annotations" | "none";
}

const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
const ANSI = /\u001b\[[0-9;]*m/g;

export function logExcerpt(log: string): string {
  const lines = log
    .split(/\r?\n/)
    .map((l) => l.replace(STAMP, "").replace(ANSI, "").trimEnd())
    .filter((l) => l && !/^##\[(?:group|endgroup)\]/.test(l));
  const at = lines.findIndex((l) => l.startsWith("##[error]"));
  if (at < 0) return "";
  return lines
    .slice(Math.max(0, at - EXCERPT_LINES), at + 1)
    .join("\n")
    .slice(-MAX_EXCERPT);
}

interface GithubIssueInfo {
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  state: "open" | "closed";
}

export type GithubReply<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export interface GithubAppApi {
  diff(repo: string, sha: string): Promise<GithubReply<{ diff: string; base: string; truncated: boolean }>>;
  check(repo: string, sha: string, c: { conclusion: "success" | "failure"; title: string; summary: string }): Promise<GithubReply<{ url: string | null }>>;
  comment(repo: string, number: number, body: string): Promise<GithubReply<{ url: string | null }>>;
  issue(repo: string, number: number): Promise<GithubReply<GithubIssueInfo>>;
  closeIssue(repo: string, number: number, reason: "completed" | "not_planned", body: string): Promise<GithubReply<{ url: string | null }>>;
  checkLog(repo: string, sha: string, name: string): Promise<GithubReply<CheckLog>>;
  canPush(repo: string, userToken: string): Promise<GithubReply<boolean>>;
}

export class GithubApp extends Context.Service<GithubApp, GithubAppApi | null>()("kiwi/relay/GithubApp") {}

export type PushCheck = (repo: string, userToken: string) => Promise<GithubReply<boolean>>;

export class GithubPush extends Context.Service<GithubPush, PushCheck>()("kiwi/relay/GithubPush") {}

const githubHeaders = (auth: string, accept = "application/vnd.github+json") => ({ authorization: `Bearer ${auth}`, accept, "user-agent": "kiwi-channels", "x-github-api-version": "2022-11-28" });

export function githubPushFrom(opts: { api?: string; fetch?: typeof fetch } = {}): PushCheck {
  const api = (opts.api ?? "https://api.github.com").replace(/\/$/, "");
  const get = opts.fetch ?? fetch;
  return async (repo, userToken) => {
    const res = await get(`${api}/repos/${repo}`, { headers: githubHeaders(userToken) });
    if (res.status === 404 || res.status === 403) return { ok: true, value: false };
    if (!res.ok) return { ok: false, status: 502, error: `GitHub refused this repo (${res.status})` };
    const r = (await res.json()) as { permissions?: { push?: boolean; admin?: boolean } };
    return { ok: true, value: !!(r.permissions?.push || r.permissions?.admin) };
  };
}

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let v = n; v > 0; v >>= 8) out.unshift(v & 0xff);
  return [0x80 | out.length, ...out];
}

const der = (tag: number, body: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array([tag, ...derLength(body.length), ...body]);

const RSA_ALGORITHM = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);

export function pkcs8Of(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) return raw;
  return der(0x30, new Uint8Array([0x02, 0x01, 0x00, ...RSA_ALGORITHM, ...der(0x04, raw)]));
}

export async function appJwt(appId: string, pem: string, now: number): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Of(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const secs = Math.floor(now / 1000);
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: secs - 60, exp: secs + 540, iss: appId })}`;
  return `${unsigned}.${b64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned))))}`;
}

export function githubAppFrom(opts: { appId?: string | null; privateKey?: string | null; api?: string; fetch?: typeof fetch; now?: () => number }): GithubAppApi | null {
  const { appId, privateKey } = opts;
  if (!appId?.trim() || !privateKey?.includes("PRIVATE KEY")) return null;
  const api = (opts.api ?? "https://api.github.com").replace(/\/$/, "");
  const get = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const tokens = new Map<string, { token: string; until: number }>();
  const headers = githubHeaders;
  const fail = async <T>(res: Response, what: string): Promise<GithubReply<T>> => ({
    ok: false,
    status: res.status === 404 ? 404 : 502,
    error: res.status === 404 ? `GitHub has no ${what} (is the App installed on the repo?)` : `GitHub refused ${what} (${res.status})`,
  });

  const token = async (repo: string): Promise<GithubReply<string>> => {
    const owner = repo.split("/")[0]!.toLowerCase();
    const held = tokens.get(owner);
    if (held && held.until > now() + 60_000) return { ok: true, value: held.token };
    const jwt = await appJwt(appId.trim(), privateKey, now());
    const inst = await get(`${api}/repos/${repo}/installation`, { headers: headers(jwt) });
    if (!inst.ok) return fail(inst, "installation for this repo");
    const { id } = (await inst.json()) as { id: number };
    const made = await get(`${api}/app/installations/${id}/access_tokens`, { method: "POST", headers: headers(jwt) });
    if (!made.ok) return fail(made, "an installation token");
    const t = (await made.json()) as { token: string; expires_at: string };
    tokens.set(owner, { token: t.token, until: Date.parse(t.expires_at) || now() + 30 * 60_000 });
    return { ok: true, value: t.token };
  };

  return {
    canPush: githubPushFrom({ api, fetch: get }),
    diff: async (repo, sha) => {
      const t = await token(repo);
      if (!t.ok) return t;
      const meta = await get(`${api}/repos/${repo}`, { headers: headers(t.value) });
      if (!meta.ok) return fail(meta, "repo");
      const base = ((await meta.json()) as { default_branch?: string }).default_branch ?? "main";
      const res = await get(`${api}/repos/${repo}/compare/${encodeURIComponent(base)}...${sha}`, { headers: headers(t.value, "application/vnd.github.diff") });
      if (!res.ok) return fail(res, "diff for that commit");
      const text = await res.text();
      return { ok: true, value: { diff: text.slice(0, MAX_DIFF), base, truncated: text.length > MAX_DIFF } };
    },
    check: async (repo, sha, c) => {
      const t = await token(repo);
      if (!t.ok) return t;
      const res = await get(`${api}/repos/${repo}/check-runs`, {
        method: "POST",
        headers: { ...headers(t.value), "content-type": "application/json" },
        body: JSON.stringify({ name: REVIEW_CHECK, head_sha: sha, status: "completed", conclusion: c.conclusion, output: { title: c.title, summary: c.summary } }),
      });
      if (!res.ok) return fail(res, "the check");
      return { ok: true, value: { url: ((await res.json()) as { html_url?: string }).html_url ?? null } };
    },
    comment: async (repo, number, body) => {
      const t = await token(repo);
      if (!t.ok) return t;
      const res = await get(`${api}/repos/${repo}/issues/${number}/comments`, { method: "POST", headers: { ...headers(t.value), "content-type": "application/json" }, body: JSON.stringify({ body }) });
      if (!res.ok) return fail(res, "the comment");
      return { ok: true, value: { url: ((await res.json()) as { html_url?: string }).html_url ?? null } };
    },
    issue: async (repo, number) => {
      const t = await token(repo);
      if (!t.ok) return t;
      const res = await get(`${api}/repos/${repo}/issues/${number}`, { headers: headers(t.value) });
      if (!res.ok) return fail(res, "issue with that number");
      const i = (await res.json()) as { title?: string; body?: string | null; html_url?: string; state?: string; pull_request?: unknown };
      if (i.pull_request) return { ok: false, status: 400, error: `${repo}#${number} is a pull request, not an issue` };
      return {
        ok: true,
        value: {
          repo,
          number,
          title: i.title ?? "",
          body: (i.body ?? "").slice(0, MAX_ISSUE_BODY),
          url: i.html_url ?? `https://github.com/${repo}/issues/${number}`,
          state: i.state === "closed" ? "closed" : "open",
        },
      };
    },
    checkLog: async (repo, sha, name) => {
      const t = await token(repo);
      if (!t.ok) return t;
      const runs = await get(`${api}/repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest`, { headers: headers(t.value) });
      if (!runs.ok) return fail(runs, "check runs for that commit");
      const run = ((await runs.json()) as { check_runs?: { id: number; html_url?: string; output?: { title?: string | null; summary?: string | null } }[] }).check_runs?.[0];
      if (!run) return { ok: false, status: 404, error: `GitHub has no check named ${name} on that commit` };
      const url = run.html_url ?? null;
      const log = await get(`${api}/repos/${repo}/actions/jobs/${run.id}/logs`, { headers: headers(t.value) });
      const fromLog = log.ok ? logExcerpt(await log.text()) : "";
      if (fromLog) return { ok: true, value: { excerpt: fromLog, url, from: "log" } };
      const notes = await get(`${api}/repos/${repo}/check-runs/${run.id}/annotations`, { headers: headers(t.value) });
      const said = notes.ok ? ((await notes.json()) as { path?: string; start_line?: number; message?: string; annotation_level?: string }[]) : [];
      const lines = [
        ...[run.output?.title, run.output?.summary].filter((x): x is string => !!x?.trim()),
        ...said
          .filter((a) => a.annotation_level === "failure" && a.message)
          .slice(0, MAX_ANNOTATIONS)
          .map((a) => (a.path && a.path !== ".github" ? `${a.path}${a.start_line ? `:${a.start_line}` : ""}: ${a.message}` : a.message!)),
      ];
      const excerpt = lines.join("\n").slice(0, MAX_EXCERPT);
      return { ok: true, value: { excerpt, url, from: excerpt ? "annotations" : "none" } };
    },
    closeIssue: async (repo, number, reason, body) => {
      const t = await token(repo);
      if (!t.ok) return t;
      const json = { ...headers(t.value), "content-type": "application/json" };
      const said = await get(`${api}/repos/${repo}/issues/${number}/comments`, { method: "POST", headers: json, body: JSON.stringify({ body }) });
      if (!said.ok) return fail(said, "the comment");
      const res = await get(`${api}/repos/${repo}/issues/${number}`, { method: "PATCH", headers: json, body: JSON.stringify({ state: "closed", state_reason: reason }) });
      if (!res.ok) return fail(res, "closing the issue");
      return { ok: true, value: { url: ((await res.json()) as { html_url?: string }).html_url ?? null } };
    },
  };
}
