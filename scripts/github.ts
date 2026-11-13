export type Rest = (method: string, path: string, body?: unknown) => Promise<unknown>;

type Credentials = { kind: "single"; token: string } | { kind: "split"; read: string; write: string };

interface Policy {
  contentType: "always" | "body";
  dryRunBody: boolean;
  notFound: "null" | "error";
  errorPath: "route" | "url";
  graphql: "skip" | "read";
  getBody: "omit" | "send";
}

export function record(x: unknown): Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x)) : {};
}

export function text(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export function list(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

export function githubClient(repo: string, options: { credentials: Credentials; dryRun: boolean; policy: Policy }) {
  const root = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const { credentials, dryRun, policy } = options;
  const tokenFor = (read: boolean) => (credentials.kind === "single" ? credentials.token : read ? credentials.read : credentials.write);
  const call = async (method: string, url: string, path: string, token: string, body?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (policy.contentType === "always" || body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (policy.notFound === "null" && res.status === 404 && (method === "GET" || method === "DELETE")) return null;
    if (!res.ok) throw new Error(`${method} ${policy.errorPath === "url" ? url : path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  const rest: Rest = async (method, path, body) => {
    if (dryRun && method !== "GET") {
      console.log(`would ${method} ${path}${policy.dryRunBody && body !== undefined ? ` ${JSON.stringify(body)}` : ""}`);
      return null;
    }
    return call(method, `${root}/repos/${repo}${path}`, path, tokenFor(method === "GET"), method === "GET" && policy.getBody === "omit" ? undefined : body);
  };
  const graphql = async (query: string, variables: Record<string, string>): Promise<unknown> => {
    if (dryRun && policy.graphql === "skip") {
      console.log(`would ${/\{\s*(\w+)\(/.exec(query)?.[1] ?? query} ${JSON.stringify(variables)}`);
      return null;
    }
    const out = record(await call("POST", `${root}/graphql`, "/graphql", tokenFor(true), { query, variables }));
    if (list(out.errors).length > 0) throw new Error(`graphql: ${JSON.stringify(out.errors)}`);
    return out.data;
  };
  return { rest, graphql };
}
