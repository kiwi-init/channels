import * as Context from "effect/Context";

export const REVIEW_CHECK = "kiwi/review";
const MAX_DIFF = 2 << 20;

const MAX_ISSUE_BODY = 8000;

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
}

export class GithubApp extends Context.Service<GithubApp, GithubAppApi | null>()("kiwi/relay/GithubApp") {}

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
  const headers = (auth: string, accept = "application/vnd.github+json") => ({ authorization: `Bearer ${auth}`, accept, "user-agent": "kiwi-channels", "x-github-api-version": "2022-11-28" });
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
